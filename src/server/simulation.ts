import { canTake, clearAt, walls } from '../room.ts';
import type { Action, Input, Player, Snapshot } from '../room.ts';

import { blockers, geometryFor, nearbyDoor, playerRadius } from '../layout.ts';
import type { Layout, Geometry, Rect } from '../layout.ts';

import { obstaclesAt, surfaceAt, surfaceHeight } from '../room-templates.ts';
import { assignment, finished, station } from '../mission.ts';
import { advanceMission, newMission, warn } from './mission.ts';

export class Simulation {
  readonly layout?: Layout;
  readonly geometry?: Geometry;
  obstacles: Rect[] = walls;

  constructor(layout?: Layout, mode: 'solo' | 'coop' = 'coop') {
    this.layout = layout;
    if (layout) {
      this.geometry = geometryFor(layout);
      this.state.opened = [];
      if (!layout.templatePlan) this.state.mission = newMission(layout);
      if (this.state.mission && mode === 'solo') this.state.mission.solo = true;
      this.obstacles = blockers(this.geometry,[]);
    }
  }
  state: Snapshot = { round: crypto.randomUUID(), update: 0, players: [], lamp: { x: 0, y: 0.14, z: 2, yaw: 0, pitch: 0, on: true, owner: null } };
  inputs = new Map<number, Input>();

  join(assignedSeat?: number) {
    const seats = this.state.mission?.solo || this.layout?.templatePlan ? [1] : [1,2];
    const id = seats.find(seat => (!assignedSeat || seat === assignedSeat) && !this.inputs.has(seat));
    if (!id) return;
    this.state.players.push({ id, ...(this.geometry?.templates ? {feetY:0} : {}), connected: true, x: id === 1 ? -0.7 : 0.7, z: 3, yaw: 0, pitch: -0.12 });
    this.inputs.set(id, { forward: 0, right: 0, yaw: 0, pitch: -0.12 });
    return id;
  }

  leave(id: number) {
    if (this.state.lamp.owner === id) Object.assign(this.state.lamp,{owner:null,y:0.14,pitch:0});
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
      p.yaw = input.yaw;
      p.pitch = input.pitch;
      if (mission?.down.some(d => d.id === p.id)) continue;
      const step = 3.3 * dt / Math.max(1, Math.hypot(input.forward, input.right));
      const x = p.x + (Math.cos(p.yaw) * input.right - Math.sin(p.yaw) * input.forward) * step;
      const z = p.z - (Math.cos(p.yaw) * input.forward + Math.sin(p.yaw) * input.right) * step;
      this.step(p,x,p.z);
      this.step(p,p.x,z);
      if (this.state.lamp.owner === p.id) this.hold(p);
    }
    if (mission && this.layout) advanceMission(this.layout,this.state,mission,dt);
  }

  private step(p:Player,x:number,z:number) {
    if (x===p.x && z===p.z) return;
    const g=this.geometry?.templates;
    if (g) {
      const support=surfaceAt(g,x,z,p.feetY??0);
      if (!support) return;
      const feet=surfaceHeight(support,z);
      if (!clearAt(x,z,playerRadius,obstaclesAt(g,feet))) return;
      p.feetY=feet;
    } else if (!clearAt(x,z,playerRadius,this.obstacles)) return;
    p.x=x;
    p.z=z;
  }

  private nearbySolids(p:Player) {
    const g=this.geometry?.templates;
    return g ? obstaclesAt(g,p.feetY??0) : this.obstacles;
  }

  hold(p: Player) {
    const lamp = this.state.lamp;
    const x = p.x + 0.24 * Math.cos(p.yaw) - 0.38 * Math.sin(p.yaw);
    const z = p.z - 0.24 * Math.sin(p.yaw) - 0.38 * Math.cos(p.yaw);
    const nearby=this.nearbySolids(p);
    const clear = clearAt(x, z, 0.14,nearby) && clearAt((x + p.x) / 2, (z + p.z) / 2, 0.14,nearby);
    Object.assign(lamp, { x: clear ? x : p.x, z: clear ? z : p.z, y: (p.feetY??0)+1.28, yaw: p.yaw, pitch: p.pitch });
  }

  act(id: number, action: Action) {
    const p = this.state.players.find(player => player.id === id);
    const mission = this.state.mission;
    if (!p?.connected || finished(mission?.stage) || mission?.down.some(d => d.id === id)) return;
    if (this.layout && mission && action === 'operate') {
      switch (assignment(this.layout,this.state,p,this.obstacles)) {
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
      if (door) {
        this.state.opened.push(door.id);
        this.obstacles = blockers(this.geometry,this.state.opened);
      }
      return;
    }
    if (action === 'take' && canTake(p, lamp,this.nearbySolids(p))) {
      lamp.owner = id;
      this.hold(p);
    } else if (lamp.owner === id && action === 'drop') {
      const g=this.geometry?.templates;
      if (g) {
        // Drop at the operator's feet so a lamp beside a catwalk edge has support.
        Object.assign(lamp,{x:p.x,z:p.z});
      }
      Object.assign(lamp, { owner: null, y: (p.feetY??0)+0.14, pitch: 0 });
    } else if (lamp.owner === id && action === 'toggle') {
      lamp.on = !lamp.on;
    }
  }
}
