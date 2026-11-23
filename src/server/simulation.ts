import { canTake, clearAt, walls } from '../room.ts';
import type { Action, Input, Player, Snapshot } from '../room.ts';

import { geometryFor, lampSpawn, nearbyDoor, playerRadius, spawnPoints } from '../layout.ts';
import type { Layout, Geometry, Rect } from '../layout.ts';

import { obstaclesAt, surfaceAt, surfaceHeight } from '../room-templates.ts';
import { assignment, collectable, finished, onPad, pack } from '../mission.ts';
import { expeditionSeed, liftOf } from '../salvage.ts';
import { generateLayout } from './generate-layout.ts';
import { advanceMission, newMission, settle, wake } from './mission.ts';

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

// Where a carried flashlight sits: ahead and to the right, slid back toward
// the operator in steps until it and the arm to it are clear of walls.
export function heldLamp(p: Player, solids: readonly Rect[]) {
  const dx = 0.24 * Math.cos(p.yaw) - 0.38 * Math.sin(p.yaw);
  const dz = -0.24 * Math.sin(p.yaw) - 0.38 * Math.cos(p.yaw);
  const reach = [1,0.75,0.5,0.25].find(t => clearAt(p.x+dx*t,p.z+dz*t,0.14,solids) && clearAt(p.x+dx*t/2,p.z+dz*t/2,0.14,solids)) ?? 0;
  return { x: p.x+dx*reach, z: p.z+dz*reach, y: (p.feetY ?? 0)+1.28, yaw: p.yaw, pitch: p.pitch };
}

export class Simulation {
  layout?: Layout;
  geometry?: Geometry;

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
    // Leaving never sells anything: the contract simply ends.
    if (mission && !finished(mission.stage)) { mission.stage = 'lost'; mission.outcome = 'left'; }
    this.inputs.delete(id);
    this.state.players = this.state.players.filter(p => p.id !== id);
  }

  tick(dt: number) {
    this.state.update++;
    const mission = this.state.mission;
    if (finished(mission?.stage) || mission?.stage === 'settled') return;
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
    if (!p?.connected || finished(mission?.stage)) return;
    if (mission?.stage === 'settled') {
      if (action === 'next') this.nextExpedition();
      return;
    }
    if (mission?.down.some(d => d.id === id)) return;
    const layout = this.layout;
    if (layout && mission && action === 'operate') {
      const task = assignment(layout,this.state,p,this.solids(p));
      if (task?.kind === 'revive') mission.down = [];
      else if (task?.kind === 'load') {
        const lift = liftOf(layout);
        for (const h of mission.haul) if (h.owner === id) Object.assign(h,{owner:null,loaded:true,...lift});
      } else if (task?.kind === 'extract') {
        settle(layout,this.state,mission,this.state.players.filter(q => onPad(q,liftOf(layout))).map(q => q.id));
      } else if (task?.kind === 'abandon') settle(layout,this.state,mission,[id]);
      return;
    }
    if (layout && mission && action === 'collect') {
      const item = collectable(layout,mission,p,this.solids(p));
      if (!item) return;
      mission.haul = [...mission.haul.filter(h => h.id !== item.id),{id:item.id,owner:id,x:item.x,y:item.y,z:item.z}];
      wake(layout,mission,this.roomOf(p) ?? item.room);
      return;
    }
    if (layout && mission && action === 'drop-item') {
      const last = pack(layout,mission,id).at(-1);
      const h = last && mission.haul.find(h => h.id === last.id);
      if (h) Object.assign(h,{owner:null,x:p.x,y:p.feetY ?? 0,z:p.z});
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

  // Start the contract's next facility with the same crew and round.
  nextExpedition() {
    const mission = this.state.mission;
    if (!mission || mission.stage !== 'settled') return;
    const c = mission.contract;
    c.index++;
    c.layout = expeditionSeed(c.seed,c.index);
    this.layout = generateLayout(c.layout);
    this.geometry = geometryFor(this.layout);
    this.state.opened = [];
    Object.assign(mission,{stage:'explore',haul:[],down:[],awake:false,diver:{mode:'dormant',bay:'',seconds:0}});
    Object.assign(this.state.lamp,{...lampSpawn,y:0.14,yaw:0,pitch:0,owner:null,on:true});
    for (const q of this.state.players) {
      Object.assign(q,{...spawnPoints[q.id-1],feetY:0,yaw:0,pitch:-0.12});
      this.inputs.set(q.id,{forward:0,right:0,yaw:0,pitch:-0.12});
    }
  }
}
