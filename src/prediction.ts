import type { Geometry } from './layout.ts';
import { obstaclesAt, surfaceAt, surfaceHeight } from './room-templates.ts';
import { walls } from './room.ts';
import type { Input, Player, Snapshot } from './room.ts';
import { carriedLamp, moveOperator } from './server/simulation.ts';

interface Sample { t: number; x: number; z: number; feetY: number }

// Moves this client's own operator as soon as a key is pressed, using the
// host's movement rules, instead of waiting a round trip for the host's
// snapshot. Each snapshot reports where the host had the operator about one
// round trip ago, so it is matched against the nearest recent prediction and
// any difference shifts the prediction. Straight walking needs no correction;
// a collision the client did not foresee is corrected within one snapshot.
export class Prediction {
  self?: Player;
  private history: Sample[] = [];

  reset(auth: Player, now: number) {
    this.self = {...auth};
    this.history = [{t:now,x:auth.x,z:auth.z,feetY:auth.feetY ?? 0}];
  }

  step(now: number, dt: number, input: Input, geometry: Geometry | undefined, opened: readonly string[], frozen: boolean) {
    const p = this.self;
    if (!p) return;
    if (frozen) { p.yaw = input.yaw; p.pitch = input.pitch; }
    else moveOperator(p,input,dt,geometry,opened);
    this.history.push({t:now,x:p.x,z:p.z,feetY:p.feetY ?? 0});
    while (this.history.length && this.history[0].t < now-1500) this.history.shift();
  }

  correct(auth: Player, now: number, frozen: boolean, geometry?: Geometry) {
    const p = this.self;
    if (!p || frozen) { this.reset(auth,now); return; }
    let best = this.history[0], gap = Infinity;
    for (const s of this.history) {
      const d = Math.hypot(s.x-auth.x,s.z-auth.z,s.feetY-(auth.feetY ?? 0));
      if (d < gap) { best = s; gap = d; }
    }
    if (!best || gap > 2) { this.reset(auth,now); return; }
    const dx = auth.x-best.x, dz = auth.z-best.z, dy = (auth.feetY ?? 0)-best.feetY;
    if (Math.hypot(dx,dz,dy) < 1e-4) return;
    // Shift the prediction and its history together, so later snapshots still
    // match the samples they correspond to.
    p.x += dx; p.z += dz;
    for (const s of this.history) { s.x += dx; s.z += dz; s.feetY += dy; }
    // Stand on the surface nearest the corrected height: the host may have the
    // operator on a step or landing the prediction had not reached.
    if (geometry) {
      const target = (p.feetY ?? 0)+dy, surface = surfaceAt(geometry,p.x,p.z,target);
      p.feetY = surface ? surfaceHeight(surface,p.x,p.z) : auth.feetY;
    }
  }

  // The snapshot as this client should draw it: its own operator, and the
  // flashlight it carries, in the hand or on the chest, at the predicted position.
  view(state: Snapshot, id: number, geometry: Geometry | undefined): Snapshot {
    const p = this.self;
    if (!p) return state;
    const players = state.players.map(player => player.id === id ? {...player,x:p.x,z:p.z,feetY:p.feetY,yaw:p.yaw,pitch:p.pitch} : player);
    const me = players.find(player => player.id === id);
    const lamp = state.lamp.owner === id && me ?
      {...state.lamp,...carriedLamp(me,geometry ? obstaclesAt(geometry,p.feetY ?? 0,state.opened) : walls)} : state.lamp;
    return {...state,players,lamp};
  }
}
