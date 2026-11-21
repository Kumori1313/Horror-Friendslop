import { generatorVersion, type Layout } from './layout.ts';
import { newerSnapshot } from './room.ts';
import type { Action, Admission, ClientMessage, Input, ServerMessage, Snapshot, Ticket } from './room.ts';

export interface Events {
  joined(id: number, ticket: Ticket, layout?: Layout): void;
  snapshot(state: Snapshot, first: boolean): void;
  offline(reason: string, ended: boolean): void;
}

export class RoomConnection {
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private monitor?: ReturnType<typeof setInterval>;
  private seq = 0;
  private latest = -1;
  private lastHeard = 0;
  private attempt = 0;
  private downSince?: number;
  private readonly url: string;
  private readonly events: Events;
  private ticket: Ticket | null;
  private readonly delay: number;
  readonly metrics = { received: 0, sent: 0, rtt: 0, recovery: 0, downRate: 0, upRate: 0 };

  private readonly admission?: () => Promise<Admission>;

  constructor(url: string, ticket: Ticket | null, events: Events, delay = 0, admission?: () => Promise<Admission>) {
    this.url = url;
    this.ticket = ticket;
    this.events = events;
    this.delay = delay;
    this.admission = admission;
  }

  connect() {
    const ws = new WebSocket(this.url);
    this.socket = ws;
    this.latest = -1;
    this.lastHeard = performance.now();
    let previousRx = this.metrics.received, previousTx = this.metrics.sent, sample = this.lastHeard;
    ws.onopen = async () => {
      try {
        const admission = await this.admission?.();
        if (this.socket === ws) this.send({type:'join', ticket:this.ticket, admission, layoutVersion:admission ? generatorVersion : undefined});
      } catch { ws.close(4001,'Guest session unavailable'); }
    };
    ws.onmessage = event => {
      if (this.socket !== ws) return;
      this.metrics.received += event.data.length; // Protocol frames contain ASCII JSON.
      this.deliver(ws, () => {
        const m = JSON.parse(event.data) as ServerMessage;
        if (m.type === 'joined') {
          this.ticket = m.ticket;
          this.seq = m.lastAction;
          this.events.joined(m.id,m.ticket,m.layout);
        } else if (m.type === 'state' && this.ticket && newerSnapshot(m.state,this.ticket.round,this.latest)) {
          const first = this.latest < 0;
          this.latest = m.state.update;
          this.lastHeard = performance.now();
          this.attempt = 0;
          if (this.downSince !== undefined) {
            this.metrics.recovery = this.lastHeard - this.downSince;
            this.downSince = undefined;
          }
          this.events.snapshot(m.state,first);
        } else if (m.type === 'pong') this.metrics.rtt = performance.now() - m.time;
      });
    };
    ws.onclose = e => {
      if (this.socket !== ws) return;
      this.reset();
      const ended = [1008,4001,4002].includes(e.code);
      this.events.offline(e.reason || 'Connection interrupted',ended);
      if (!ended) this.schedule();
    };
    this.monitor = setInterval(() => {
      const now = performance.now();
      if (now - this.lastHeard > 5000) { this.interrupt(); return; }
      this.send({type:'ping',time:now});
      const seconds = (now-sample)/1000;
      this.metrics.downRate = (this.metrics.received-previousRx)/seconds;
      this.metrics.upRate = (this.metrics.sent-previousTx)/seconds;
      previousRx = this.metrics.received;
      previousTx = this.metrics.sent;
      sample = now;
    },1000);
  }

  private deliver(ws: WebSocket, work: () => void) {
    const run = () => { if (this.socket === ws && ws.readyState === WebSocket.OPEN) work(); };
    if (this.delay) setTimeout(run,this.delay);
    else run();
  }
  private send(m: ClientMessage) {
    const ws = this.socket;
    if (ws?.readyState !== WebSocket.OPEN) return;
    this.deliver(ws,() => {
      const data = JSON.stringify(m);
      ws.send(data);
      this.metrics.sent += data.length;
    });
  }
  input(input: Input) {
    if (this.ticket && this.latest >= 0) this.send({type:'input',round:this.ticket.round,input});
  }
  action(action: Action) {
    if (this.ticket && this.latest >= 0) this.send({type:'action',round:this.ticket.round,seq:++this.seq,action});
  }
  private reset() {
    clearInterval(this.monitor);
    clearTimeout(this.retry);
    const ws = this.socket;
    this.socket = undefined;
    this.latest = -1;
    ws?.close();
  }
  private schedule(delay = Math.min(250 * 2 ** this.attempt++,2000)) {
    this.downSince ??= performance.now();
    this.retry = setTimeout(() => this.connect(),delay);
  }
  interrupt(duration?: number) {
    this.reset();
    this.events.offline('Connection interrupted',false);
    this.schedule(duration);
  }
  stop() { this.reset(); }
}
