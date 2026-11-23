import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Events } from './connection.ts';
import { generatorVersion, type Layout } from './layout.ts';
import { generateLayout } from './server/generate-layout.ts';
import { Simulation } from './server/simulation.ts';
import { actions } from './room.ts';
import type { Action, Input, Snapshot } from './room.ts';

export interface Crew {
  client: SupabaseClient;
  host: boolean;
  lobby: string;
  round: number;
  actor: string;
  lastVerified: () => number;
  closeRound: () => void;
}
const grace = 20000;
const idle = (): Input => ({forward:0,right:0,yaw:0,pitch:-0.12});
type Control = {seq:number; action:Action};
type GuestFrame = {type:'hello'|'control'; version:number; peer:string; round:string; input:Input; action?:Control; sent:number};
type HostFrame =
  | {type:'ready'}
  | {type:'welcome'; layout:Layout; state:Snapshot; ack:number; peer:string}
  | {type:'state'; state:Snapshot; ack:number; echo:number};
interface Checkpoint { seed:number; state:Snapshot; time:number; ack:number; peer:string }

function validInput(v: Input) {
  return v && [v.forward,v.right,v.yaw,v.pitch].every(Number.isFinite) && Math.abs(v.forward)<=1 &&
    Math.abs(v.right)<=1 && Math.abs(v.pitch)<=1.4;
}

export class CreatorSession {
  readonly metrics = {received:0,sent:0,rtt:0,recovery:0,downRate:0,upRate:0};
  private readonly crew: Crew;
  private readonly events: Events;
  private readonly key: string;
  private readonly peer = crypto.randomUUID();
  private channels: RealtimeChannel[] = [];
  private subscribed = new Set<RealtimeChannel>();
  private releaseLock?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private sim?: Simulation;
  private inputState = idle();
  private remotePeer = '';
  private seq = 0;
  private ack = 0;
  private pending: Control[] = [];
  private round = '';
  private latest = -1;
  private lastPeer = performance.now();
  private echo = 0;
  private lastEcho = 0;
  private lastSend = 0;
  private lastSignature = '';
  private lastCheckpoint = 0;
  private pausedUntil = 0;
  private lastTick = 0;
  // The facility each side last announced, to follow a contract's next expedition.
  private shownLayout?: Layout;
  private guestLayout?: number;
  private lastHello = 0;
  private downSince = 0;
  private lastSample = performance.now();
  private bytesIn = 0;
  private bytesOut = 0;
  constructor(crew: Crew, events: Events) {
    this.crew = crew;
    this.events = events;
    this.key = ['relay-host-v1',crew.lobby,crew.round,crew.actor].join('/');
  }
  connect() {
    if (!navigator.locks) {
      this.end('Open this game in a browser with Web Locks over HTTPS or localhost',false);
      return;
    }
    void navigator.locks.request(this.key,{ifAvailable:true},async lock => {
      if (this.stopped) return;
      if (!lock) { this.end('Already playing in another tab',false); return; }
      const held = new Promise<void>(resolve => { this.releaseLock = resolve; });
      try {
        if (this.crew.host) this.prepareHost();
        if (!this.stopped) {
          this.joinChannels();
          this.timer = setInterval(() => this.tick(),1000/30);
        }
        await held;
      } catch { this.end('Could not restore the shift',true); }
    }).catch(() => this.end('Could not reserve this browser seat',false));
  }
  private prepareHost() {
    const raw = sessionStorage.getItem(this.key);
    const saved: Checkpoint | null = raw ? JSON.parse(raw) : null;
    if (localStorage.getItem(this.key) && (!saved || Date.now()-saved.time>grace)) {
      this.end('Host session expired',true);
      return;
    }
    const override = import.meta.env.MODE !== 'pages' && import.meta.env.VITE_RELAY_TEST_SEED;
    const seed = saved?.seed ?? (override ? Number(override) : crypto.getRandomValues(new Uint32Array(1))[0]);
    const sim = new Simulation(generateLayout(seed)); this.sim = sim;
    sim.join(1);
    if (saved) {
      if (saved.state.players.some(p=>p.id===2)) sim.join(2);
      sim.state = saved.state;
      const self = sim.state.players.find(p => p.id === 1)!;
      this.inputState = {...idle(),yaw:self.yaw,pitch:self.pitch};
      this.ack = saved.ack; this.remotePeer = saved.peer;
      for (const p of sim.state.players) sim.inputs.set(p.id,{...idle(),yaw:p.yaw,pitch:p.pitch});
    }
    localStorage.setItem(this.key,'active');
    this.checkpoint();
    this.round = sim.state.round;
    this.shownLayout = sim.layout;
    this.events.joined(1,{round:this.round,token:'creator'},sim.layout);
    this.events.snapshot(sim.state,true);
  }
  private checkpoint() {
    if (!this.sim) return;
    const record: Checkpoint = {time:Date.now(),seed:this.sim.layout!.seed,state:this.sim.state,ack:this.ack,peer:this.remotePeer};
    sessionStorage.setItem(this.key,JSON.stringify(record));
  }
  private joinChannels() {
    for (const lane of ['host','guest']) {
      const topic = 'relay:'+this.crew.lobby+':'+this.crew.round+':'+lane;
      const ch = this.crew.client.channel(topic,{config:{private:true,broadcast:{self:false,ack:false}}});
      this.channels.push(ch);
      ch.on('broadcast',{event:'frame'},({payload}) => {
        if (this.stopped || performance.now()<this.pausedUntil || !payload) return;
        this.metrics.received += JSON.stringify(payload).length;
        if (this.crew.host && lane==='guest') this.receiveGuest(payload);
        if (!this.crew.host && lane==='host') this.receiveHost(payload);
      }).subscribe(status => {
        if (this.stopped) return;
        if (status==='SUBSCRIBED') {
          this.subscribed.add(ch);
          if (this.subscribed.size===2 && this.crew.host) this.send({type:'ready'});
        } else this.subscribed.delete(ch);
      });
    }
  }
  private send(message: GuestFrame | HostFrame) {
    if (this.subscribed.size!==2 || performance.now()<this.pausedUntil) return;
    this.metrics.sent += JSON.stringify(message).length;
    void this.channels[this.crew.host ? 0 : 1].send({type:'broadcast',event:'frame',payload:message}).catch(()=>{});
  }
  private receiveGuest(m: GuestFrame) {
    const sim = this.sim!;
    if (m.version!==generatorVersion || typeof m.peer!=='string' || m.peer.length!==36) return;
    const now = performance.now();
    if (m.type==='hello') {
      if (m.peer!==this.remotePeer) { this.remotePeer=m.peer; this.ack=0; }
      if (!sim.inputs.has(2)) sim.join(2);
      sim.state.players.find(p=>p.id===2)!.connected=true;
      this.lastPeer=now;
      this.send({type:'welcome',layout:sim.layout!,state:sim.state,ack:this.ack,peer:m.peer});
      return;
    }
    if (m.type!=='control' || m.round!==this.round || m.peer!==this.remotePeer || !validInput(m.input)) return;
    this.lastPeer=now; this.echo=m.sent;
    sim.state.players.find(p=>p.id===2)!.connected=true;
    sim.inputs.set(2,m.input);
    if (m.action && Number.isSafeInteger(m.action.seq) && m.action.seq===this.ack+1 && actions.includes(m.action.action)) {
      sim.act(2,m.action.action); this.ack=m.action.seq;
      this.afterAction();
    }
  }
  private receiveHost(m: HostFrame) {
    if (m.type==='ready') { this.hello(); return; }
    if (m.type!=='welcome' && m.type!=='state') return;
    const now=performance.now();
    if (m.type==='welcome') {
      if (m.peer!==this.peer || m.layout.version!==generatorVersion) return;
      if (this.round && m.state.round!==this.round) { this.end('Host session ended',true); return; }
      const first = !this.round || !!this.downSince;
      this.round=m.state.round;
      this.seq=Math.max(this.seq,m.ack);
      this.guestLayout=m.layout.seed;
      this.events.joined(2,{round:this.round,token:'guest'},m.layout);
      this.events.snapshot(m.state,first);
    } else {
      if (!this.round || m.state.round!==this.round || m.state.update<=this.latest) return;
      // The host moved on to the next expedition: ask again for its facility.
      const facility = m.state.mission?.contract.layout;
      if (facility!==undefined && facility!==this.guestLayout && now-this.lastHello>1000) { this.lastHello=now; this.hello(); }
      this.events.snapshot(m.state,!!this.downSince);
      if (m.echo>this.lastEcho) { this.metrics.rtt=now-m.echo; this.lastEcho=m.echo; }
    }
    this.latest=m.state.update;
    this.pending=this.pending.filter(a=>a.seq>m.ack);
    this.lastPeer=now;
    if (this.downSince) { this.metrics.recovery=now-this.downSince; this.downSince=0; }
  }
  private hello() {
    this.send({type:'hello',version:generatorVersion,peer:this.peer,round:this.round,input:this.inputState,sent:performance.now()});
  }
  private tick() {
    const now=performance.now();
    if (now-this.crew.lastVerified()>grace || now-this.lastPeer>grace) {
      this.end('Crew connection expired',true);
      return;
    }
    if (now-this.lastSample>=1000) {
      const seconds=(now-this.lastSample)/1000;
      this.metrics.downRate=(this.metrics.received-this.bytesIn)/seconds;
      this.metrics.upRate=(this.metrics.sent-this.bytesOut)/seconds;
      this.bytesIn=this.metrics.received; this.bytesOut=this.metrics.sent; this.lastSample=now;
    }
    if (now<this.pausedUntil) { this.lastTick=now; return; }
    const sim=this.sim;
    if (sim) {
      if (this.downSince && this.subscribed.size===2) {
        this.events.snapshot(sim.state,true); this.metrics.recovery=now-this.downSince; this.downSince=0;
      }
      const guest=sim.state.players.find(p=>p.id===2);
      if (guest && now-this.lastPeer>1400) guest.connected=false;
      if (guest && now-this.lastPeer>450) {
        const old=sim.inputs.get(2)!; old.forward=old.right=0;
      }
      // Catch up in fixed steps when the page's timers lag behind slow frames,
      // so warnings and rescue timers stay in real seconds.
      const steps=this.lastTick ? Math.max(1,Math.min(4,Math.round((now-this.lastTick)*30/1000))) : 1;
      this.lastTick=now;
      for (let i=0;i<steps;i++) sim.tick(1/30);
      this.announceLayout();
      this.events.snapshot(sim.state,false);
      if (now-this.lastCheckpoint>=500) { this.checkpoint(); this.lastCheckpoint=now; }
      if (guest && now-this.lastSend>=100) {
        // Sleeping rooms send a one-second heartbeat. Active rooms send at most 10 snapshots/s.
        const signature=JSON.stringify([sim.state.players,sim.state.lamp,sim.state.opened,sim.state.mission,this.ack]);
        if (signature!==this.lastSignature || now-this.lastSend>=950) {
          this.send({type:'state',state:sim.state,ack:this.ack,echo:this.echo});
          this.lastSend=now; this.lastSignature=signature;
        }
      }
    } else if (now-this.lastSend>=100) {
      if (!this.round || now-this.lastPeer>2200 || this.downSince) {
        if (now-this.lastSend<500) return;
        if (this.round && !this.downSince) { this.downSince=now; this.events.offline('Host reconnecting',false); }
        this.hello();
      } else {
        const input=this.inputState;
        const signature=JSON.stringify(input);
        if (!this.pending.length && signature===this.lastSignature &&
            now-this.lastSend<(input.forward || input.right ? 240 : 850)) return;
        this.send({type:'control',peer:this.peer,round:this.round,version:generatorVersion,input,action:this.pending[0],sent:now});
        this.lastSignature=signature;
      }
      this.lastSend=now;
    }
  }
  input(input: Input) { this.inputState=input; this.sim?.inputs.set(1,input); }
  action(action: Action) {
    if (performance.now()<this.pausedUntil || !this.round) return;
    if (this.sim) { this.sim.act(1,action); this.afterAction(); }
    else if (this.pending.length<8) this.pending.push({seq:++this.seq,action});
  }
  // Save at once, so a refresh right after a sale cannot undo or repeat it.
  private afterAction() {
    this.announceLayout();
    this.checkpoint();
    this.lastCheckpoint=performance.now();
  }
  private announceLayout() {
    const sim=this.sim;
    if (!sim || sim.layout===this.shownLayout) return;
    this.shownLayout=sim.layout;
    this.events.joined(1,{round:this.round,token:'creator'},sim.layout);
  }
  interrupt(duration=0) {
    if (this.stopped || !duration) return;
    this.downSince=performance.now(); this.pausedUntil=this.downSince+duration;
    this.events.offline('Reconnecting',false);
  }
  private end(reason:string, close:boolean) {
    if (this.stopped) return;
    this.stop(); this.events.offline(reason,true);
    if (close) this.crew.closeRound();
  }
  stop() {
    if (this.stopped) return;
    this.stopped=true;
    if (this.sim) this.checkpoint();
    clearInterval(this.timer);
    for (const channel of this.channels) void this.crew.client.removeChannel(channel);
    this.releaseLock?.();
  }
}
