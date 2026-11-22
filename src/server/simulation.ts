import { canTake, clearAt, walls } from '../room.ts';
import type { Action, Input, Player, Snapshot } from '../room.ts';

import { geometryFor, nearbyDoor, playerRadius, spawnPoints } from '../layout.ts';
import type { Layout, Geometry, Rect } from '../layout.ts';

import { obstaclesAt, surfaceAt, surfaceHeight } from '../room-templates.ts';
import { assignment, finished, station } from '../mission.ts';
import { advanceMission, newMission, warn } from './mission.ts';

// Operator movement shared by the host and by clients predicting their own
// operator, so both agree on walls, stairs and closed bulkheads.
export function moveOperator(p: Player, input: Input, dt: number, geometry: Geometry | undefined, opened: readonly string[] = []) {
  p.yaw = input.yaw;
  p.pitch = input.pitch;
  const step = 3.3 * dt / Math.max(1, Math.hypot(input.forward, input.right));
  const x = p.x + (Math.cos(p.yaw) * input.right - Math.sin(p.yaw) * input.forward) * step;
  const z = p.z - (Math.cos(p.yaw) * input.forward + Math.sin(p.yaw) * input.right) * step;
  stepTo(p,x,p.z,geometry,opened);
  stepTo(p,p.x,z,geometry,opened);
}

function stepTo(p: Player, x: number, z: number, g: Geometry | undefined, opened: readonly string[]) {
  if (x === p.x && z === p.z) return;
  if (g) {
    const support = surfaceAt(g,x,z,p.feetY ?? 0);
    if (!support) return;
    const feet = surfaceHeight(support,x,z);
    if (!clearAt(x,z,playerRadius,obstaclesAt(g,feet,opened))) return;
    p.feetY = feet;
  } else if (!clearAt(x,z,playerRadius,walls)) return;
  p.x = x;
  p.z = z;
}

// Where a carried flashlight sits: ahead and to the right, pulled back to the
// operator if a wall is in the way.
export function heldLamp(p: Player, solids: readonly Rect[]) {
  const x = p.x + 0.24 * Math.cos(p.yaw) - 0.38 * Math.sin(p.yaw);
  const z = p.z - 0.24 * Math.sin(p.yaw) - 0.38 * Math.cos(p.yaw);
  const clear = clearAt(x, z, 0.14,solids) && clearAt((x + p.x) / 2, (z + p.z) / 2, 0.14,solids);
  return { x: clear ? x : p.x, z: clear ? z : p.z, y: (p.feetY ?? 0)+1.28, yaw: p.yaw, pitch: p.pitch };
}

export class Simulation {
  readonly layout?: Layout;
  readonly geometry?: Geometry;

  constructor(layout?: Layout, mode: 'solo' | 'coop' = 'coop') {
    this.layout = layout;
    if (layout) {
      this.geometry = geometryFor(layout);
      this.state.opened = [];
      if (!layout.tour) this.state.mission = newMission(layout);
      if (this.state.mission && mode === 'solo') this.state.mission.solo = true;
    }
  }
  state: Snapshot = { round: crypto.randomUUID(), update: 0, players: [], lamp: { x: 0, y: 0.14, z: 2, yaw: 0, pitch: 0, on: true, owner: null } };
  inputs = new Map<number, Input>();

  join(assignedSeat?: number) {
    const seats = this.state.mission?.solo || this.layout?.tour ? [1] : [1,2];
    const id = seats.find(seat => (!assignedSeat || seat === assignedSeat) && !this.inputs.has(seat));
    if (!id) return;
    this.state.players.push({ id, ...(this.geometry ? {feetY:0} : {}), connected: true, ...spawnPoints[id-1], yaw: 0, pitch: -0.12 });
    this.inputs.set(id, { forward: 0, right: 0, yaw: 0, pitch: -0.12 });
    return id;
  }

  leave(id: number) {
    const holder = this.state.players.find(p => p.id === id);
    if (this.state.lamp.owner === id) Object.assign(this.state.lamp,{owner:null,y:(holder?.feetY ?? 0)+0.14,pitch:0});
    const mission = this.state.mission;
    if (mission && !finished(mission.stage)) mission.stage = 'lost';
    this.inputs.delete(id);
    this.state.players = this.state.players.filter(p => p.id !== id);
  }

  tick(dt: number) {
    this.state.update++;
    const mission = this.state.mission;
    if (finished(mission?.stage)) return;
    for (const p of this.state.players) {
      const input = this.inputs.get(p.id)!;
      if (mission?.down.some(d => d.id === p.id)) {
        p.yaw = input.yaw;
        p.pitch = input.pitch;
        continue;
      }
      moveOperator(p,input,dt,this.geometry,this.state.opened);
      if (this.state.lamp.owner === p.id) this.hold(p);
    }
    if (mission && this.layout) advanceMission(this.layout,this.state,mission,dt,p => this.roomOf(p));
  }

  roomOf(p: Player) {
    return this.geometry && surfaceAt(this.geometry,p.x,p.z,p.feetY ?? 0)?.room;
  }

  // Everything an operator at this height can bump into, with open bulkheads removed.
  solids(p: Player): Rect[] {
    return this.geometry ? obstaclesAt(this.geometry,p.feetY ?? 0,this.state.opened) : walls;
  }

  hold(p: Player) {
    Object.assign(this.state.lamp,heldLamp(p,this.solids(p)));
  }

  act(id: number, action: Action) {
    const p = this.state.players.find(player => player.id === id);
    const mission = this.state.mission;
    if (!p?.connected || finished(mission?.stage) || mission?.down.some(d => d.id === id)) return;
    if (this.layout && mission && action === 'operate') {
      switch (assignment(this.layout,this.state,p,this.solids(p))) {
        case 'Charge switchboard': mission.stage = 'trace'; break;
        case 'Send test tone': mission.stage = 'answer'; break;
        case 'Power exit circuit':
        case 'Answer relay':
          mission.stage = 'extract';
          warn(mission,station(this.layout,'relay').id);
          break;
        case 'Revive partner': mission.down = []; break;
        case 'Extract':
        case 'Extract crew': mission.stage = 'won'; break;
      }
      return;
    }
    const lamp = this.state.lamp;
    if (action === 'open-door' && this.geometry && this.state.opened) {
      const door = nearbyDoor(p,this.geometry,this.state.opened);
      if (door) this.state.opened.push(door.id);
      return;
    }
    if (action === 'take' && canTake(p, lamp,this.solids(p))) {
      lamp.owner = id;
      this.hold(p);
    } else if (lamp.owner === id && action === 'drop') {
      // Drop at the operator's feet so a lamp beside a gallery edge keeps its support.
      if (this.geometry) Object.assign(lamp,{x:p.x,z:p.z});
      Object.assign(lamp, { owner: null, y: (p.feetY ?? 0)+0.14, pitch: 0 });
    } else if (lamp.owner === id && action === 'toggle') {
      lamp.on = !lamp.on;
    }
  }
}
