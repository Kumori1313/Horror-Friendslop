import { randomUUID } from 'node:crypto';
import { canTake, clearAt } from '../room.ts';
import type { Action, Input, Player, Snapshot } from '../room.ts';

export class Simulation {
  state: Snapshot = { round: randomUUID(), update: 0, players: [], lamp: { x: 0, y: 0.14, z: 2, yaw: 0, pitch: 0, on: true, owner: null } };
  inputs = new Map<number, Input>();

  join() {
    const id = [1, 2].find(seat => !this.inputs.has(seat));
    if (!id) return;
    this.state.players.push({ id, x: id === 1 ? -0.7 : 0.7, z: 3, yaw: 0, pitch: -0.12 });
    this.inputs.set(id, { forward: 0, right: 0, yaw: 0, pitch: -0.12 });
    return id;
  }

  leave(id: number) {
    this.act(id, 'drop');
    this.inputs.delete(id);
    this.state.players = this.state.players.filter(p => p.id !== id);
  }

  tick(dt: number) {
    for (const p of this.state.players) {
      const input = this.inputs.get(p.id)!;
      p.yaw = input.yaw;
      p.pitch = input.pitch;
      const step = 3.3 * dt / Math.max(1, Math.hypot(input.forward, input.right));
      const x = p.x + (Math.cos(p.yaw) * input.right - Math.sin(p.yaw) * input.forward) * step;
      const z = p.z - (Math.cos(p.yaw) * input.forward + Math.sin(p.yaw) * input.right) * step;
      if (clearAt(x, p.z, 0.25)) p.x = x;
      if (clearAt(p.x, z, 0.25)) p.z = z;
      if (this.state.lamp.owner === p.id) this.hold(p);
    }
    this.state.update++;
  }

  hold(p: Player) {
    const lamp = this.state.lamp;
    const x = p.x + 0.24 * Math.cos(p.yaw) - 0.38 * Math.sin(p.yaw);
    const z = p.z - 0.24 * Math.sin(p.yaw) - 0.38 * Math.cos(p.yaw);
    const clear = clearAt(x, z, 0.14) && clearAt((x + p.x) / 2, (z + p.z) / 2, 0.14);
    Object.assign(lamp, { x: clear ? x : p.x, z: clear ? z : p.z, y: 1.28, yaw: p.yaw, pitch: p.pitch });
  }

  act(id: number, action: Action) {
    const p = this.state.players.find(player => player.id === id);
    if (!p) return;
    const lamp = this.state.lamp;
    if (action === 'take' && canTake(p, lamp)) {
      lamp.owner = id;
      this.hold(p);
    } else if (lamp.owner === id && action === 'drop') {
      Object.assign(lamp, { owner: null, y: 0.14, pitch: 0 });
    } else if (lamp.owner === id && action === 'toggle') {
      lamp.on = !lamp.on;
    }
  }
}
