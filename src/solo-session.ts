import type { Events } from './connection.ts';
import { generatorVersion, stairwellLayout, type Layout } from './layout.ts';
import type { Action, Command, Input, Snapshot } from './room.ts';
import { generateLayout } from './server/generate-layout.ts';
import { Simulation } from './server/simulation.ts';

interface Checkpoint { version: number; seed: number; state: Snapshot }

function resume(checkpointKey:string,stairwell:boolean): Simulation | undefined {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav?.type !== 'reload') return;
    const raw = sessionStorage.getItem(checkpointKey);
    if (!raw) return;
    const {version,seed,state}: Checkpoint = JSON.parse(raw);
    if (version !== generatorVersion || !Number.isInteger(seed) || (stairwell ? !!state.mission : !state.mission?.solo) ||
        state.players.length !== 1 || state.players[0].id !== 1) return;
    const sim = new Simulation(stairwell ? stairwellLayout() : generateLayout(seed),'solo');
    sim.join(1);
    sim.state = state;
    const player = state.players[0];
    sim.inputs.set(1,{forward:0,right:0,yaw:player.yaw,pitch:player.pitch});
    return sim;
  } catch { /* A missing or incompatible checkpoint starts a new shift. */ }
}

export class SoloSession {
  private readonly sim: Simulation;
  private readonly events: Events;
  private savedAt = 0;
  private discarded = false;
  private readonly checkpointKey:string;
  constructor(events: Events, stairwell=false) {
    this.checkpointKey = stairwell ? 'relay-room-stairwell-v1' : 'relay-room-solo-v1';
    const override = import.meta.env.MODE !== 'pages' && import.meta.env.VITE_RELAY_TEST_SEED;
    const seed = override ? Number(override) : crypto.getRandomValues(new Uint32Array(1))[0];
    this.sim = resume(this.checkpointKey,stairwell) ?? new Simulation(stairwell ? stairwellLayout() : generateLayout(seed),'solo');
    if (!this.sim.state.players.length) this.sim.join(1);
    this.events = events;
  }
  private shownLayout?: Layout;
  connect() {
    this.shownLayout = this.sim.layout;
    this.events.joined(1,{round:this.sim.state.round,token:'solo'},this.sim.layout);
    this.events.snapshot(this.sim.state,true);
    this.save();
  }
  input(input: Input) { this.sim.inputs.set(1,input); }
  action(action: Action, extra: Command = {}) {
    this.sim.act(1,action,extra);
    this.announceLayout();
    this.events.snapshot(this.sim.state,false);
    this.save();
  }
  // A contract's next expedition brings a new facility.
  private announceLayout() {
    if (this.sim.layout === this.shownLayout) return;
    this.shownLayout = this.sim.layout;
    this.events.joined(1,{round:this.sim.state.round,token:'solo'},this.sim.layout);
  }
  tick(dt: number) {
    this.sim.tick(dt);
    this.events.snapshot(this.sim.state,false);
    if (performance.now()-this.savedAt >= 1000) this.save();
  }
  private save() {
    this.savedAt = performance.now();
    if (this.discarded) return;
    try {
      const layout = this.sim.layout!;
      sessionStorage.setItem(this.checkpointKey,JSON.stringify({version:layout.version,seed:layout.seed,state:this.sim.state}));
    } catch { /* Play can continue when browser storage is unavailable. */ }
  }
  discard() {
    this.discarded = true;
    try { sessionStorage.removeItem(this.checkpointKey); } catch { /* Storage unavailable */ }
  }
  stop() { this.save(); }
}
