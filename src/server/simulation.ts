import { randomUUID } from 'node:crypto';
import { canTake, clearAt, walls } from '../room.ts';
import type { Action, Input, Player, Snapshot } from '../room.ts';

import { blockers, geometryFor, nearbyDoor, playerRadius } from '../layout.ts';
import type { Layout, Geometry, Rect } from '../layout.ts';

import { assignment, finished, station } from '../mission.ts';
import { advanceMission, newMission, warn } from './mission.ts';

export class Simulation {
  readonly layout?: Layout;
  readonly geometry?: Geometry;
  obstacles: Rect[] = walls;

  constructor(layout?: Layout) {
    this.layout = layout;
    if (layout) {
      this.geometry = geometryFor(layout);
      this.state.opened = [];
      this.state.mission = newMission();
      this.obstacles = blockers(this.geometry,[]);
    }
  }
  state: Snapshot = { round: randomUUID(), update: 0, players: [], lamp: { x: 0, y: 0.14, z: 2, yaw: 0, pitch: 0, on: true, owner: null } };
  inputs = new Map<number, Input>();

  join(assignedSeat?: number) {
    const id = (assignedSeat ? [assignedSeat] : [1, 2]).find(seat => !this.inputs.has(seat));
    if (!id) return;
    this.state.players.push({ id, connected: true, x: id === 1 ? -0.7 : 0.7, z: 3, yaw: 0, pitch: -0.12 });
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
      if (clearAt(x, p.z, playerRadius,this.obstacles)) p.x = x;
      if (clearAt(p.x, z, playerRadius,this.obstacles)) p.z = z;
      if (this.state.lamp.owner === p.id) this.hold(p);
    }
    if (mission && this.layout) advanceMission(this.layout,this.state,mission,dt);
  }

  hold(p: Player) {
    const lamp = this.state.lamp;
    const x = p.x + 0.24 * Math.cos(p.yaw) - 0.38 * Math.sin(p.yaw);
    const z = p.z - 0.24 * Math.sin(p.yaw) - 0.38 * Math.cos(p.yaw);
    const clear = clearAt(x, z, 0.14,this.obstacles) && clearAt((x + p.x) / 2, (z + p.z) / 2, 0.14,this.obstacles);
    Object.assign(lamp, { x: clear ? x : p.x, z: clear ? z : p.z, y: 1.28, yaw: p.yaw, pitch: p.pitch });
  }

  act(id: number, action: Action) {
    const p = this.state.players.find(player => player.id === id);
    const mission = this.state.mission;
    if (!p?.connected || finished(mission?.stage) || mission?.down.some(d => d.id === id)) return;
    if (this.layout && mission && action === 'operate') {
      switch (assignment(this.layout,this.state,p,this.obstacles)) {
        case 'Send test tone': mission.stage = 'answer'; break;
        case 'Answer relay':
          mission.stage = 'extract';
          warn(mission,station(this.layout,'relay').id);
          break;
        case 'Revive partner': mission.down = []; break;
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
    if (action === 'take' && canTake(p, lamp,this.obstacles)) {
      lamp.owner = id;
      this.hold(p);
    } else if (lamp.owner === id && action === 'drop') {
      Object.assign(lamp, { owner: null, y: 0.14, pitch: 0 });
    } else if (lamp.owner === id && action === 'toggle') {
      lamp.on = !lamp.on;
    }
  }
}
