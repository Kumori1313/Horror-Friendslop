import { clearAt, command, freeSlot, hotbarSize, lampSlot, selected, slotsOf, walls } from '../room.ts';
import type { Action, Aim, Command, Input, Lamp, Player, Snapshot } from '../room.ts';
import { flightStep, gravity, launchFrom, trajectory } from '../flight.ts';
import type { Body, Flight } from '../flight.ts';

import { geometryFor, nearbyDoor, playerRadius, spawnPoints } from '../layout.ts';
import type { Layout, Geometry, Rect } from '../layout.ts';

import { obstaclesAt, surfaceAt, surfaceHeight } from '../room-templates.ts';
import { assignment, distance, diverBody, finished, gone, nearestPickup } from '../mission.ts';
import { doorReach, home, intakeDoor, intakeEntry, outdoors, placeOf, riftOpen, riftReach, riftSpot } from '../places.ts';
import type { Place, Stand } from '../places.ts';
import { bodyOf, expeditionSeed, itemKinds, spawnSalvage } from '../salvage.ts';
import { generateLayout } from './generate-layout.ts';
import { advanceMission, newContract, newMission, wake, wipeSeed } from './mission.ts';

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
  if (!g) {
    if (!clearAt(x,z,playerRadius,walls)) return;
    p.x = x; p.z = z;
    return;
  }
  const feet = p.feetY ?? 0, support = surfaceAt(g,x,z,feet);
  if (support) {
    const to = surfaceHeight(support,x,z);
    if (!standable(g,x,z,to,opened)) return;
    Object.assign(p,{x,z,feetY:to});
    return;
  }
  // Off an edge, such as the side of a ramp: drop to the floor below,
  // landing a little way out from the ledge so the body clears its side.
  const dx = Math.sign(x-p.x), dz = Math.sign(z-p.z);
  for (const extra of [0,0.1,0.2,0.3,0.4,0.5]) {
    const cx = x+dx*extra, cz = z+dz*extra, below = floorBelow(g,cx,cz,feet);
    if (below === undefined) return;
    if (standable(g,cx,cz,below,opened)) { Object.assign(p,{x:cx,z:cz,feetY:below}); return; }
  }
}

// Clear of walls, props and closed bulkheads, and of the solid side of any
// ramp, stair flight or raised floor that rises more than a step above the
// feet within the operator's reach. Ramps and stairs are solid underneath.
function standable(g: Geometry, x: number, z: number, feet: number, opened: readonly string[]) {
  if (!clearAt(x,z,playerRadius,obstaclesAt(g,feet,opened))) return false;
  for (const s of g.surfaces) {
    const cx = Math.max(s.x-s.w/2,Math.min(s.x+s.w/2,x)), cz = Math.max(s.z-s.d/2,Math.min(s.z+s.d/2,z));
    if ((cx-x)**2+(cz-z)**2 >= playerRadius*playerRadius) continue;
    if (surfaceHeight(s,cx,cz) > feet+0.32 && Math.min(s.y,s.y+(s.rise ?? 0))-0.13 < feet+1.75) return false;
  }
  return true;
}

// The highest floor below the feet at this point, if any.
function floorBelow(g: Geometry, x: number, z: number, feet: number) {
  let best: number | undefined;
  for (const s of g.surfaces) {
    if (Math.abs(x-s.x) > s.w/2+1e-6 || Math.abs(z-s.z) > s.d/2+1e-6) continue;
    const y = surfaceHeight(s,x,z);
    if (y < feet && (best === undefined || y > best)) best = y;
  }
  return best;
}

// Where a carried flashlight sits: ahead and to the right, slid back toward
// the operator in steps until it and the arm to it are clear of walls.
export function heldLamp(p: Player, solids: readonly Rect[]) {
  const dx = 0.24 * Math.cos(p.yaw) - 0.38 * Math.sin(p.yaw);
  const dz = -0.24 * Math.sin(p.yaw) - 0.38 * Math.cos(p.yaw);
  const reach = [1,0.75,0.5,0.25].find(t => clearAt(p.x+dx*t,p.z+dz*t,0.14,solids) && clearAt(p.x+dx*t/2,p.z+dz*t/2,0.14,solids)) ?? 0;
  return { x: p.x+dx*reach, z: p.z+dz*reach, y: (p.feetY ?? 0)+1.28, yaw: p.yaw, pitch: p.pitch };
}

// A flashlight clipped to the chest while another slot is selected: inside
// the operator's own radius, so always clear, facing where the body faces.
export function stowedLamp(p: Player) {
  return { x: p.x-0.12*Math.sin(p.yaw), z: p.z-0.12*Math.cos(p.yaw), y: (p.feetY ?? 0)+1.2, yaw: p.yaw, pitch: p.pitch*0.4-0.08 };
}

// Where a carried flashlight is, in the hand or on the chest.
export function carriedLamp(p: Player, solids: readonly Rect[]) {
  return selected(p) === lampSlot ? {...heldLamp(p,solids),stowed:false} : {...stowedLamp(p),stowed:true};
}

// Throw strength: 2.5 to 11.5 m/s, and a third less for heavy items.
export function throwSpeed(power: number, heavy: boolean) {
  return (2.5+9*power)*(heavy ? 0.65 : 1);
}

// Count a thrown item's flight down and end it once it has landed.
function advance<T extends {flight?: Flight}>(thing: T, dt: number) {
  if (!thing.flight) return false;
  thing.flight.t += dt;
  if (thing.flight.t < thing.flight.d) return false;
  delete thing.flight;
  return true;
}

// The exit rift is a column about an operator wide and a little taller.
const riftRadius = 1;
const inRift = (rift: {x: number; z: number}, x: number, y: number, z: number) => (x-rift.x)**2+(z-rift.z)**2 < riftRadius*riftRadius && y > -0.2 && y < 2.6;

// Where an operator stands on arriving somewhere: side by side, by seat.
const beside = (at: Stand, id: number): Stand => ({...at,x:at.x+(id === 1 ? -0.6 : 0.6)*Math.cos(at.yaw),z:at.z-(id === 1 ? -0.6 : 0.6)*Math.sin(at.yaw)});

export class Simulation {
  layout?: Layout;
  // A contract starts in the home dimension. Tests of the facility itself
  // can start the first expedition with everyone already inside Intake.
  private readonly start: 'home' | 'inside';

  constructor(layout?: Layout, mode: 'solo' | 'coop' = 'coop', start: 'home' | 'inside' = 'home') {
    this.layout = layout;
    this.start = layout && !layout.tour ? start : 'inside';
    if (layout) {
      this.state.opened = [];
      if (!layout.tour) this.state.mission = newMission(layout);
      if (this.state.mission && mode === 'solo') this.state.mission.solo = true;
      // Starting inside, the whole crew is already through the arrival rift.
      if (this.state.mission && this.start === 'inside') this.state.mission.arrival = 'closed';
      if (this.state.mission && this.start === 'home') {
        this.state.mission.stage = 'home';
        Object.assign(this.state.lamp,{...home().lamp,y:0.14,place:'home'});
      }
    }
  }

  // The facility's collision geometry, built the first time anyone needs it,
  // so a crew waiting at home never builds the next expedition.
  get geometry(): Geometry | undefined { return this.layout && geometryFor(this.layout); }

  // The geometry of the place an operator, item or the flashlight is in.
  geometryAt(place: Place): Geometry | undefined {
    if (place === 'home') return home().geometry;
    if (place === 'outside') return this.layout && outdoors(this.layout.seed).geometry;
    return this.geometry;
  }
  openedAt(place: Place): readonly string[] { return place === 'inside' ? this.state.opened ?? [] : []; }
  state: Snapshot = { round: crypto.randomUUID(), update: 0, players: [], lamp: { x: 0, y: 0.14, z: 2, yaw: 0, pitch: 0, on: true, owner: null } };
  inputs = new Map<number, Input>();
  // Where the Diver wanders and which chain clip it rattles. Tests replace it.
  random: () => number = Math.random;

  join(assignedSeat?: number) {
    const seats = this.state.mission?.solo || this.layout?.tour ? [1] : [1,2];
    const id = seats.find(seat => (!assignedSeat || seat === assignedSeat) && !this.inputs.has(seat));
    if (!id) return;
    const athome = this.start === 'home';
    const at = athome ? home().spawns[id-1] : {...spawnPoints[id-1],y:0,yaw:0};
    this.state.players.push({ id, ...(this.layout ? {feetY:0} : {}), connected: true, x: at.x, z: at.z, yaw: 0, pitch: -0.12, slots: Array(hotbarSize).fill(null), hand: 0, ...(athome ? {place:'home' as const} : {}) });
    this.inputs.set(id, { forward: 0, right: 0, yaw: 0, pitch: -0.12 });
    return id;
  }

  leave(id: number) {
    const holder = this.state.players.find(p => p.id === id);
    if (this.state.lamp.owner === id) Object.assign(this.state.lamp,{owner:null,y:(holder?.feetY ?? 0)+0.14,pitch:0,stowed:false,place:holder && placeOf(holder)});
    const mission = this.state.mission;
    // Leaving never sells anything: the contract simply ends.
    if (mission && !finished(mission.stage)) { mission.stage = 'lost'; mission.outcome = 'left'; }
    this.inputs.delete(id);
    this.state.players = this.state.players.filter(p => p.id !== id);
  }

  tick(dt: number) {
    this.state.update++;
    this.fillSlots();
    const mission = this.state.mission;
    if (finished(mission?.stage) || mission?.stage === 'settled') return;
    for (const p of this.state.players) {
      const input = this.inputs.get(p.id)!;
      // A body lies as it fell, however its operator looks around.
      if (mission?.dead?.includes(p.id)) continue;
      if (mission?.down.some(d => d.id === p.id)) {
        p.yaw = input.yaw;
        p.pitch = input.pitch;
        continue;
      }
      const place = placeOf(p);
      moveOperator(p,input,dt,this.geometryAt(place),this.openedAt(place));
      // Walking into the home rift goes through it; walking into the exit rift escapes.
      if (mission && place === 'home' && distance(p,home().rift) <= riftReach) this.depart(p);
      else if (mission?.rift && place === 'outside' && distance(p,mission.rift) <= riftReach) this.escape(p);
      if (this.state.lamp.owner === p.id) this.hold(p);
    }
    // A flashlight thrown into the exit rift turns up at home.
    if (advance(this.state.lamp,dt) && this.state.lamp.homeward) {
      Object.assign(this.state.lamp,{...home().lamp,y:0.14,pitch:0,place:'home'});
      delete this.state.lamp.homeward;
    }
    for (const h of mission?.haul ?? []) advance(h,dt);
    if (mission?.stage === 'explore' && this.layout) {
      advanceMission(this.layout,this.state,mission,dt,p => this.roomOf(p),this.random);
      if (mission.stage !== 'explore') this.returnHome();
    }
  }

  // The facility room an operator stands in; nothing outside the facility.
  roomOf(p: Player) {
    const g = this.geometry;
    return g && placeOf(p) === 'inside' ? surfaceAt(g,p.x,p.z,p.feetY ?? 0)?.room : undefined;
  }

  // Everything an operator at this height can bump into, with open bulkheads removed.
  solids(p: Player): Rect[] {
    const place = placeOf(p), g = this.geometryAt(place);
    return g ? obstaclesAt(g,p.feetY ?? 0,this.openedAt(place)) : walls;
  }

  hold(p: Player) {
    Object.assign(this.state.lamp,carriedLamp(p,this.solids(p)),this.state.mission ? {place:placeOf(p)} : {});
  }

  // Move an operator to another place, facing the arrival heading. Their
  // client turns its view when it sees `transit` change.
  private moveTo(p: Player, place: Place, at: Stand) {
    Object.assign(p,{place,x:at.x,z:at.z,feetY:at.y,yaw:at.yaw});
    p.transit = {n:(p.transit?.n ?? 0)+1,yaw:at.yaw};
    const input = this.inputs.get(p.id);
    if (input) this.inputs.set(p.id,{...input,yaw:at.yaw});
    if (this.state.lamp.owner === p.id) this.hold(p);
  }

  // Through the home rift to the outdoor map. The first operator through
  // starts the expedition; the arrival rift closes once everyone is out.
  private depart(p: Player) {
    const mission = this.state.mission;
    if (!mission || !this.layout || (mission.stage !== 'home' && mission.arrival !== 'open')) return;
    if (mission.stage === 'home') { mission.stage = 'explore'; mission.arrival = 'open'; }
    this.moveTo(p,'outside',outdoors(this.layout.seed).spawns[p.id-1] ?? outdoors(this.layout.seed).spawns[0]);
    if (this.state.players.every(q => placeOf(q) !== 'home')) mission.arrival = 'closed';
  }

  // Into the exit rift: the operator escapes home, and everything they carry
  // is banked. They wait at home for the rift to close.
  private escape(p: Player) {
    const mission = this.state.mission, rift = mission?.rift;
    if (!mission || !rift || gone(mission,p.id)) return;
    for (const h of mission.haul) if (h.owner === p.id) Object.assign(h,{owner:null,banked:true,x:rift.x,y:0,z:rift.z,place:'outside'});
    (mission.escaped ??= []).push(p.id);
    this.moveTo(p,'home',home().spawns[p.id-1] ?? home().spawns[0]);
  }

  // Ring the bell: the exit rift opens at this expedition's spot, and every
  // creature is enraged for the rest of the expedition.
  private ring(p: Player) {
    const mission = this.state.mission;
    if (!mission || !this.layout || mission.bell !== undefined) return;
    mission.bell = p.id;
    mission.enraged = true;
    const spot = riftSpot(this.layout.seed);
    mission.rift = {x:spot.x,z:spot.z,seconds:riftOpen};
  }

  // The façade door and Intake's door to the outside, within reach.
  passage(p: Player): 'enter' | 'leave' | undefined {
    if (!this.state.mission || !this.layout || this.state.mission.stage !== 'explore') return;
    return passageFor(p,this.layout.seed,this.state.mission.arrival === 'closed');
  }

  // After a sale everyone is back home, with the flashlight in its place.
  private returnHome() {
    for (const q of this.state.players) this.moveTo(q,'home',home().spawns[q.id-1] ?? home().spawns[0]);
    Object.assign(this.state.lamp,{...home().lamp,y:0.14,yaw:0,pitch:0,owner:null,on:true,stowed:false,place:'home'});
    delete this.state.lamp.flight;
  }

  // Keep every hotbar in step with what its operator actually carries. A
  // strike or a sale takes things away without asking the hotbar, and
  // checkpoints from before the hotbar have no slots at all.
  private fillSlots() {
    const lamp = this.state.lamp, haul = this.state.mission?.haul ?? [];
    for (const p of this.state.players) {
      const owns = (item: string) => item === lampSlot ? lamp.owner === p.id : haul.some(h => h.id === item && h.owner === p.id);
      if (!p.slots) {
        const carried = [...(lamp.owner === p.id ? [lampSlot] : []),...haul.filter(h => h.owner === p.id).map(h => h.id)];
        p.slots = Array.from({length:hotbarSize},(_,i) => carried[i] ?? null);
        p.hand = 0;
      } else if (p.slots.some(item => item !== null && !owns(item))) {
        p.slots = p.slots.map(item => item !== null && owns(item) ? item : null);
      }
    }
  }

  private release(p: Player, item: string) {
    p.slots = slotsOf(p).map(s => s === item ? null : s);
  }

  // Throw or drop the selected item. A throw is simulated to the end here;
  // its flight lets every client draw the same arc on the way.
  private letGo(p: Player, aim?: Aim) {
    const item = selected(p), mission = this.state.mission, layout = this.layout;
    if (!item) return;
    const feet = {x:p.x,y:p.feetY ?? 0,z:p.z};
    const kind = item === lampSlot ? 'lamp' : layout && spawnSalvage(layout).find(s => s.id === item)?.kind;
    if (!kind) return;
    let rest = feet, flight: Flight | undefined, banked = false;
    const body: Body = bodyOf(kind), place = placeOf(p), g = this.geometryAt(place);
    if (aim && g) {
      // The aim travels with the command, so the throw goes where the thrower
      // was looking even if their latest view hasn't reached the host yet.
      const opened = this.openedAt(place);
      const speed = throwSpeed(aim.power,kind !== 'lamp' && !!itemKinds[kind].heavy);
      const start = launchFrom(g,opened,p,{fx:-Math.sin(aim.yaw),fz:-Math.cos(aim.yaw),up:Math.sin(aim.pitch),speed},body);
      const path = trajectory(g,opened,start,body,feet);
      rest = path.rest;
      if (path.duration > 0) flight = {...start,t:0,d:path.duration};
      // A throw whose arc passes through the exit rift ends there, banked.
      const rift = mission?.rift;
      if (rift && place === 'outside' && flight) {
        for (let i=0;i<path.points.length/3;i++) {
          if (!inRift(rift,path.points[i*3],path.points[i*3+1],path.points[i*3+2])) continue;
          flight.d = Math.max(flightStep,i*flightStep);
          rest = {x:rift.x,y:0,z:rift.z};
          banked = true;
          break;
        }
      }
      // A throw that reaches the Bell Diver stops there, drops to the floor
      // beneath it, and stuns it when it lands on it.
      const diver = mission?.diver, hit = diver && layout && place === 'inside' && flight ? diverBody(layout,diver) : undefined;
      if (hit && diver) {
        for (let i=1;i<path.points.length/3;i++) {
          const x = path.points[i*3], y = path.points[i*3+1], z = path.points[i*3+2];
          if ((x-hit.x)**2+(z-hit.z)**2 > hit.r**2 || y+body.h < hit.bottom || y-body.h > hit.top) continue;
          // The walking surface under it nearest its storey, ramps included.
          const cut = i*flightStep;
          let floor = diver.y ?? 0, best = Infinity;
          for (const s of g.surfaces) {
            if (Math.abs(hit.x-s.x) > s.w/2 || Math.abs(hit.z-s.z) > s.d/2) continue;
            const h = surfaceHeight(s,hit.x,hit.z);
            if (h <= y && Math.abs(h-(diver.y ?? 0)) < best) { best = Math.abs(h-(diver.y ?? 0)); floor = h; }
          }
          rest = {x:hit.x,y:floor,z:hit.z};
          flight!.cut = cut;
          flight!.d = cut+Math.sqrt(2*Math.max(0,y-body.h-floor)/gravity);
          diver.incoming = diver.incoming === undefined ? cut : Math.min(diver.incoming,cut);
          break;
        }
      }
    }
    this.release(p,item);
    if (item === lampSlot) {
      const lamp: Lamp = this.state.lamp;
      Object.assign(lamp,{owner:null,x:rest.x,y:rest.y+body.h,z:rest.z,pitch:0,stowed:false},mission ? {place} : {});
      if (flight) lamp.flight = flight; else delete lamp.flight;
      if (banked) lamp.homeward = true;
    } else if (mission) {
      const h = mission.haul.find(entry => entry.id === item);
      if (!h) return;
      Object.assign(h,{owner:null,x:rest.x,y:rest.y,z:rest.z,place});
      if (flight) h.flight = flight; else delete h.flight;
      if (banked) h.banked = true;
    }
  }

  act(id: number, action: Action, extra: Command = {}) {
    const p = this.state.players.find(player => player.id === id);
    const mission = this.state.mission;
    if (!p?.connected || finished(mission?.stage)) return;
    extra = command(extra);
    this.fillSlots();
    if (mission?.stage === 'settled') {
      if (action === 'next') this.nextExpedition();
      return;
    }
    // The receipt is read at home; the rift there starts the next expedition.
    if (mission?.stage === 'home' && action !== 'select' && action !== 'take' && action !== 'drop' && action !== 'throw' && action !== 'toggle') return;
    if (mission?.down.some(d => d.id === id) || (mission && gone(mission,id))) return;
    const layout = this.layout;
    if (layout && mission && action === 'operate') {
      const task = assignment(layout,this.state,p,this.solids(p));
      if (task?.kind === 'revive') mission.down = mission.down.filter(d => !this.state.players.some(q => q.id === d.id && q.id !== id && distance(q,p) <= 1.7));
      else if (task?.kind === 'ring') this.ring(p);
      return;
    }
    const lamp = this.state.lamp;
    if (action === 'select' && extra.slot !== undefined) {
      p.hand = extra.slot;
      if (lamp.owner === id) this.hold(p);
      return;
    }
    if (action === 'drop' || action === 'throw') {
      const holding = lamp.owner === id;
      this.letGo(p,action === 'throw' ? extra.aim ?? {yaw:p.yaw,pitch:p.pitch,power:0.5} : undefined);
      if (holding && lamp.owner !== id) return;
      if (lamp.owner === id) this.hold(p);
      return;
    }
    if (action === 'take') {
      // Pick up whichever is nearer: the flashlight or a piece of salvage.
      const slot = freeSlot(p), choice = nearestPickup(layout,this.state,p,this.solids(p));
      if (slot < 0 || !choice) return;
      if ('lamp' in choice) {
        p.slots = slotsOf(p).map((s,i) => i === slot ? lampSlot : s);
        p.hand = slot;
        lamp.owner = id;
        this.hold(p);
      } else if (layout && mission) {
        const item = choice.item;
        p.slots = slotsOf(p).map((s,i) => i === slot ? item.id : s);
        p.hand = slot;
        mission.haul = [...mission.haul.filter(h => h.id !== item.id),{id:item.id,owner:id,x:item.x,y:item.y,z:item.z}];
        wake(layout,mission,this.roomOf(p) ?? item.room);
        if (lamp.owner === id) this.hold(p);
      }
      return;
    }
    if (action === 'open-door') {
      // R uses the nearest door: the façade, Intake's outer door, or a bulkhead.
      const way = this.passage(p);
      if (way === 'enter') this.moveTo(p,'inside',beside(intakeEntry,p.id));
      else if (way === 'leave' && this.layout) this.moveTo(p,'outside',beside(outdoors(this.layout.seed).exit,p.id));
      else if (placeOf(p) === 'inside' && this.geometry && this.state.opened) {
        const door = nearbyDoor(p,this.geometry,this.state.opened);
        if (door) this.state.opened.push(door.id);
      }
      return;
    }
    if (lamp.owner === id && action === 'toggle') {
      lamp.on = !lamp.on;
    }
  }

  // After the receipt, plan the contract's next facility, or after a wipe a
  // fresh contract. The crew stays home until someone steps into the rift;
  // nothing of the facility is built yet.
  nextExpedition() {
    const mission = this.state.mission;
    if (!mission || mission.stage !== 'settled') return;
    if (mission.outcome === 'wipe') {
      mission.contract = newContract(wipeSeed(mission.contract.seed));
      delete mission.outcome;
    } else {
      mission.contract.index++;
      mission.contract.layout = expeditionSeed(mission.contract.seed,mission.contract.index);
    }
    this.layout = generateLayout(mission.contract.layout);
    this.state.opened = [];
    Object.assign(mission,{stage:'home',haul:[],down:[],awake:false,diver:{mode:'dormant',bay:'',seconds:0}});
    for (const key of ['arrival','bell','rift','enraged','escaped','dead'] as const) delete mission[key];
    for (const q of this.state.players) Object.assign(q,{slots:Array(hotbarSize).fill(null),hand:0});
  }
}

// Which door an operator can use from where they stand: the façade door
// from outside, or Intake's outer door from inside. The façade stays shut
// until the whole crew has come through the arrival rift.
export function passageFor(p: Player, seed: number, crewOut: boolean): 'enter' | 'leave' | undefined {
  const place = placeOf(p);
  if (place === 'outside' && crewOut && distance(p,outdoors(seed).door) <= doorReach) return 'enter';
  if (place === 'inside' && Math.abs(p.feetY ?? 0) < 1 && distance(p,intakeDoor) <= doorReach) return 'leave';
}
