import { batteryLife, chargeOf, clearAt, command, freeSlot, hotbarSize, lampSlot, selected, slotsOf, sprintSpeed, walls } from '../room.ts';
import type { Action, Aim, Command, Input, Lamp, Player, Snapshot } from '../room.ts';
import { flightStep, gravity, launchFrom, positionAt, trajectory } from '../flight.ts';
import type { Body, Flight, Path } from '../flight.ts';
import { flareFear, swat } from './gnawers.ts';
import { struggle, swatLurker } from './lurkers.ts';
import { swatStalker } from './stalkers.ts';

import { geometryFor, inPit, nearbyDoor, playerRadius, spawnPoints } from '../layout.ts';
import type { Layout, Geometry, Rect } from '../layout.ts';

import { climbable, footingAt, footingPace, headHeight, mudDepth, obstaclesAt, pitKill, surfaceAt, surfaceHeight, wadeDepth, waterLevel, type Point3, type Solid } from '../room-templates.ts';
import { assignment, batonReach, bellSpan, breathTime, flatOn, heldBy, recoverAfter, revivedHealth, swingTime, catalog, deliverySpot, distance, diverBody, finished, flareTime, gone, nearestPickup, prices, wallet } from '../mission.ts';
import { doorReach, home, insideDoors, outdoors, placeOf, riftOpen, riftReach, riftSpot } from '../places.ts';
import type { Place, Stand } from '../places.ts';
import { bodyOf, expeditionSeed, itemKinds, spawnSalvage } from '../salvage.ts';
import { generateLayout } from './generate-layout.ts';
import { advanceMission, die, newContract, newMission, stun, wake, wipeSeed } from './mission.ts';

// Operator movement shared by the host and by clients predicting their own
// operator, so both agree on walls, stairs and closed bulkheads.
// Operators fall under the same gravity as thrown things, and sink through
// water no faster than this.
export const sinkSpeed = 1.5;
// A jump rises about 0.6 m: onto crates and sills and over short gaps, never
// near a ceiling. Falls do no harm; a pit is what kills (`inPit`).
export const jumpHeight = 0.6;
export const jumpSpeed = Math.sqrt(2*gravity*jumpHeight);
// With nothing beneath (down a bottomless pit), a fall stops this far down.
const abyss = -50;
const bodyHeight = 1.75;
// Going down ground no steeper than this (rise over run, about 48 degrees)
// keeps an operator on their feet; anything steeper, or an edge, and they
// leave the ground and fall.
const footing = 1.1;

// Moves an operator for one tick. Returns how fast they hit the ground if
// they landed this tick, for fall damage.
export function moveOperator(p: Player, input: Input, dt: number, geometry: Geometry | undefined, opened: readonly string[] = []) {
  p.yaw = input.yaw;
  p.pitch = input.pitch;
  // Wading past the knees slows an operator down.
  const level = geometry?.water ? waterLevel(geometry.water,p.x,p.z) : undefined, feet = p.feetY ?? 0;
  const wading = level !== undefined && level-feet > wadeDepth;
  const mired = !wading && !!geometry?.water?.mud && level !== undefined && level-feet > mudDepth && p.vy === undefined;
  // Jump from the ground, but not off a riverbed with the water over the chest.
  if (input.jump === true && p.vy === undefined && geometry && !(level !== undefined && level-feet > wadeDepth+0.5)) p.vy = jumpSpeed;
  // Loose rock or deep snow slows a walker on the ground.
  const footing = !wading && !mired && !!geometry?.scree && p.vy === undefined && !!surfaceAt(geometry,p.x,p.z,feet)?.field ? footingPace[footingAt(geometry,p.x,p.z)] : 1;
  const step = 3.3 * (wading ? 0.6 : mired ? 0.8 : footing) * (input.sprint === true ? sprintSpeed : 1) * dt / Math.max(1, Math.hypot(input.forward, input.right));
  const x = p.x + (Math.cos(p.yaw) * input.right - Math.sin(p.yaw) * input.forward) * step;
  const z = p.z - (Math.cos(p.yaw) * input.forward + Math.sin(p.yaw) * input.right) * step;
  stepTo(p,x,p.z,geometry,opened);
  stepTo(p,p.x,z,geometry,opened);
  return fall(p,dt,geometry);
}

// While airborne, gravity pulls the operator down until they land on the
// first floor, or the top of anything solid, beneath them; rising, a ceiling
// stops them. In water they sink slowly. Returns the speed of a landing.
export function fall(p: Player, dt: number, g: Geometry | undefined) {
  if (p.vy === undefined || !g) return;
  // Rolling ground is solid all the way down: never be under it.
  const terrain = terrainAt(g,p.x,p.z);
  if (terrain !== undefined && terrain > (p.feetY ?? 0)) {
    p.feetY = terrain;
    if (p.vy <= 0) { delete p.vy; return 0; }
  }
  const feet = p.feetY ?? 0, floor = groundBelow(g,p.x,p.z,feet);
  let vy = p.vy-gravity*dt;
  const level = g.water ? waterLevel(g.water,p.x,p.z) : undefined;
  if (level !== undefined && level > feet) vy = Math.max(vy,-sinkSpeed);
  let to = feet+vy*dt;
  if (vy > 0) {
    const roof = headroom(g,p.x,p.z,feet);
    if (to+bodyHeight > roof) { to = Math.max(feet,roof-bodyHeight); vy = 0; }
  }
  if (floor === undefined && to <= abyss) { p.feetY = abyss; delete p.vy; return; }
  if (floor !== undefined && to <= floor) { p.feetY = floor; delete p.vy; return Math.max(0,-vy); }
  p.feetY = to; p.vy = vy;
}

// Whether a box overlaps the operator's body circle at (x, z).
const under = (s: {x: number; z: number; w: number; d: number}, x: number, z: number) => {
  const cx = Math.max(s.x-s.w/2,Math.min(s.x+s.w/2,x)), cz = Math.max(s.z-s.d/2,Math.min(s.z+s.d/2,z));
  return (cx-x)**2+(cz-z)**2 < playerRadius*playerRadius;
};
const solidsOf = (g: Geometry): Solid[] => [...g.walls,...g.rails,...g.props,...g.doors];
// The highest floor at the point, or top of something solid under the body,
// at or below the feet.
function groundBelow(g: Geometry, x: number, z: number, feet: number) {
  let best = floorBelow(g,x,z,feet+1e-6);
  for (const s of solidsOf(g)) if (s.y+s.h <= feet+1e-6 && under(s,x,z) && (best === undefined || s.y+s.h > best)) best = s.y+s.h;
  return best;
}
// The top of something solid under the body, level with the feet: walking
// along a crate or a wreck.
function solidTop(g: Geometry, x: number, z: number, feet: number) {
  return solidsOf(g).some(s => Math.abs(s.y+s.h-feet) <= 0.02 && under(s,x,z));
}
// The lowest ceiling, slab underside or overhang above the head here.
function headroom(g: Geometry, x: number, z: number, feet: number) {
  let low = Infinity;
  const head = feet+bodyHeight-0.02;
  for (const s of [...g.roofs,...solidsOf(g)]) if (s.y >= head && under(s,x,z)) low = Math.min(low,s.y);
  for (const s of g.surfaces) {
    if (s.field || !under(s,x,z)) continue;
    const bottom = Math.min(s.y,s.y+(s.rise ?? 0))-0.13;
    if (bottom >= head) low = Math.min(low,bottom);
  }
  return low;
}

function stepTo(p: Player, x: number, z: number, g: Geometry | undefined, opened: readonly string[]) {
  if (x === p.x && z === p.z) return;
  if (!g) {
    if (!clearAt(x,z,playerRadius,walls)) return;
    p.x = x; p.z = z;
    return;
  }
  const feet = p.feetY ?? 0, support = surfaceAt(g,x,z,feet), run = Math.hypot(x-p.x,z-p.z);
  if (p.vy !== undefined) {
    // In the air: coming down, land on anything within a step above the
    // feet; otherwise drift on above whatever lies below, never into a wall
    // or rising ground.
    if (!standable(g,x,z,feet,opened) || groundAbove(g,x,z,feet)) return;
    // Into rolling ground a little above the feet: onto it, never into it.
    const terrain = terrainAt(g,x,z);
    if (terrain !== undefined && terrain > feet) { Object.assign(p,{x,z,feetY:terrain}); if (p.vy <= 0) delete p.vy; return; }
    if (p.vy <= 0 && support && surfaceHeight(support,x,z) >= feet) { Object.assign(p,{x,z,feetY:surfaceHeight(support,x,z)}); delete p.vy; return; }
    p.x = x; p.z = z;
    return;
  }
  // Along the top of a crate, a machine or a wreck.
  if (solidTop(g,x,z,feet) && (!support || surfaceHeight(support,x,z) <= feet+0.02) && standable(g,x,z,feet,opened)) { p.x = x; p.z = z; return; }
  if (support) {
    const to = surfaceHeight(support,x,z);
    // Ground steeper than an operator can climb is a wall.
    if (!climbable(support,feet,to,x,z) || !standable(g,x,z,to,opened)) return;
    // Ground falling away faster than footing allows: step out and fall.
    if (feet-to > run*footing+0.02) {
      if (!standable(g,x,z,feet,opened)) return;
      Object.assign(p,{x,z,vy:0});
      return;
    }
    Object.assign(p,{x,z,feetY:to});
    return;
  }
  // Off an edge, such as the side of a ramp or a crate: step out, a little
  // way from the ledge where that clears its side on the way down, and fall.
  const dx = Math.sign(x-p.x), dz = Math.sign(z-p.z);
  for (const extra of [0,0.1,0.2,0.3,0.4,0.5]) {
    const cx = x+dx*extra, cz = z+dz*extra, below = groundBelow(g,cx,cz,feet);
    if (below === undefined || !standable(g,cx,cz,feet,opened)) break;
    if (standable(g,cx,cz,below,opened)) { Object.assign(p,{x:cx,z:cz,vy:0}); return; }
  }
  if (standable(g,x,z,feet,opened)) Object.assign(p,{x,z,vy:0});
}

// The height of rolling ground here, if any.
function terrainAt(g: Geometry, x: number, z: number) {
  let top: number | undefined;
  for (const s of g.surfaces) if (s.field && Math.abs(x-s.x) <= s.w/2 && Math.abs(z-s.z) <= s.d/2) top = Math.max(top ?? -Infinity,surfaceHeight(s,x,z));
  return top;
}
// Rolling ground rising more than a step above the feet here: a slope's
// face, solid to a falling operator.
function groundAbove(g: Geometry, x: number, z: number, feet: number) {
  return g.surfaces.some(s => s.field && Math.abs(x-s.x) <= s.w/2 && Math.abs(z-s.z) <= s.d/2 && surfaceHeight(s,x,z) > feet+0.32);
}

// Clear of walls, props and closed bulkheads, and of the solid side of any
// ramp, stair flight or raised floor that rises more than a step above the
// feet within the operator's reach. Ramps and stairs are solid underneath.
function standable(g: Geometry, x: number, z: number, feet: number, opened: readonly string[]) {
  if (!clearAt(x,z,playerRadius,obstaclesAt(g,feet,opened))) return false;
  for (const s of g.surfaces) {
    // Rolling ground is the floor itself, not something to bump into.
    if (s.field) continue;
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
const inRift = (rift: {x: number; y?: number; z: number}, x: number, y: number, z: number) => (x-rift.x)**2+(z-rift.z)**2 < riftRadius*riftRadius && y > (rift.y ?? 0)-0.2 && y < (rift.y ?? 0)+2.6;

// Where an operator stands on arriving somewhere: side by side, by seat.
const beside = (at: Stand, id: number): Stand => ({...at,x:at.x+(id === 1 ? -0.6 : 0.6)*Math.cos(at.yaw),z:at.z-(id === 1 ? -0.6 : 0.6)*Math.sin(at.yaw)});

export class Simulation {
  layout?: Layout;
  // A contract starts in the home dimension. Tests of the facility itself
  // can start the first expedition with everyone already inside Intake.
  private readonly start: 'home' | 'inside';

  constructor(layout?: Layout, mode: 'solo' | 'coop' = 'coop', start: 'home' | 'inside' = 'home') {
    this.layout = layout;
    if (layout) {
      let s = (layout.seed ^ 0x5bd1e995) >>> 0;
      this.random = () => { s = (Math.imul(s ^ (s >>> 15),0x2c1b3c6d)+0x6d2b79f5) >>> 0; return ((s ^ (s >>> 13)) >>> 0)/2**32; };
    }
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
  // Chance for creatures (the Diver's chain clips, the Gnawers' wandering),
  // seeded from the layout so a run repeats from its seed. Tests replace it.
  random: () => number = Math.random;
  // False keeps stalkers out (`VITE_RELAY_NO_STALKERS` in a test build).
  stalkers = true;
  // Battery drained since the flashlight's charge last dropped a whole
  // second. The charge itself moves in whole seconds so a lit flashlight
  // changes the snapshot only once a second.
  private spent = 0;
  // Likewise the expedition clock, which advances in whole seconds.
  private elapsed = 0;
  // Simulated seconds, and when each operator last swung a baton.
  private time = 0;
  private swungAt = new Map<number,number>();
  // The arc of each thrown thing still in flight, by id (host only), so the
  // Gnawers can tell when one comes close.
  private arcs = new Map<string,Path>();
  // Whether each operator's jump key was down last tick, so a held victim's
  // struggle counts each fresh press.
  private jumping = new Map<number,boolean>();

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
      // A body lies as it fell, however its operator looks around, but
      // still comes down to the floor if it fell in the air.
      if (mission?.dead?.includes(p.id)) { fall(p,dt,this.geometryAt(placeOf(p))); continue; }
      if (mission?.down.some(d => d.id === p.id)) {
        p.yaw = input.yaw;
        p.pitch = input.pitch;
        fall(p,dt,this.geometryAt(placeOf(p)));
        continue;
      }
      const place = placeOf(p);
      // Held by the Lurker or knocked flat by a stalker: no walking, only
      // looking about and (held) struggling, each fresh press of the jump key.
      if (mission && (heldBy(mission,p.id) || flatOn(mission,p.id))) {
        p.yaw = input.yaw; p.pitch = input.pitch;
        if (input.jump && !this.jumping.get(p.id)) struggle(mission,p.id);
        this.jumping.set(p.id,!!input.jump);
        fall(p,dt,this.geometryAt(place));
        if (this.state.lamp.owner === p.id) this.hold(p);
        continue;
      }
      moveOperator(p,input,dt,this.geometryAt(place),this.openedAt(place));
      // Fallen into a pit during an expedition: dead, and what they carried
      // is gone with them.
      if (place === 'inside' && this.layout && mission?.stage === 'explore' && !mission.escaped?.includes(p.id) && inPit(this.layout,p)) { die(this.state,mission,p.id,true); continue; }
      // Walking into the home rift goes through it; walking into the exit rift escapes.
      if (mission && place === 'home' && distance(p,home().rift) <= riftReach) this.depart(p);
      else if (mission?.rift && place === 'outside' && distance(p,mission.rift) <= riftReach) this.escape(p);
      if (this.state.lamp.owner === p.id) this.hold(p);
    }
    // A flashlight thrown into the exit rift turns up at home.
    const landed = advance(this.state.lamp,dt);
    if (landed && this.state.lamp.homeward) {
      Object.assign(this.state.lamp,{...home().lamp,y:0.14,pitch:0,place:'home'});
      delete this.state.lamp.homeward;
    }
    // Into deep water: lost once it lands.
    if (this.state.lamp.sinks && !this.state.lamp.flight) { Object.assign(this.state.lamp,{lost:true,on:false}); delete this.state.lamp.sinks; }
    this.time += dt;
    for (const h of mission?.haul ?? []) {
      // Bought gear thrown into the exit rift turns up at home.
      if (advance(h,dt) && h.homeward) { Object.assign(h,deliverySpot(mission!),{place:'home'}); delete h.homeward; }
      if (h.sinks && !h.flight) { h.used = true; delete h.sinks; }
      // A lit flare burns down wherever it is, then it's gone.
      if (h.burn !== undefined) {
        h.burn -= dt;
        if (h.burn <= 0) { delete h.burn; Object.assign(h,{used:true,owner:null}); }
      }
    }
    // The battery drains while the flashlight is on away from home, at half
    // rate while it is clipped on. Flat, it switches off.
    const lamp = this.state.lamp;
    if (mission?.stage === 'explore' && lamp.on && placeOf(lamp) !== 'home') {
      this.spent += dt*(lamp.stowed ? 0.5 : 1);
      // A hair of tolerance: thirty 1/30 s ticks should make a whole second.
      if (this.spent >= 1-1e-9) {
        const whole = Math.floor(this.spent+1e-9);
        this.spent -= whole;
        lamp.charge = Math.max(0,chargeOf(lamp)-whole);
      }
      if (chargeOf(lamp) <= 0) lamp.on = false;
    }
    // Head under water: breath runs out after `breathTime`, and they drown.
    if (mission?.stage === 'explore' && this.layout) {
      const water = outdoors(this.layout.seed).geometry.water;
      for (const p of this.state.players) {
        if (placeOf(p) !== 'outside' || mission.dead?.includes(p.id) || mission.escaped?.includes(p.id) || !water) continue;
        const level = waterLevel(water,p.x,p.z), under = level !== undefined && level-(p.feetY ?? 0) > headHeight;
        const held = mission.drowning?.find(d => d.id === p.id);
        if (!under) { if (held) mission.drowning = mission.drowning!.filter(d => d !== held); continue; }
        if (!held) (mission.drowning ??= []).push({id:p.id,seconds:breathTime-dt});
        else if ((held.seconds -= dt) <= 0) die(this.state,mission,p.id,true);
      }
    }
    if (mission?.stage === 'explore') {
      this.elapsed += dt;
      if (this.elapsed >= 1-1e-9) { const whole = Math.floor(this.elapsed+1e-9); this.elapsed -= whole; mission.clock = (mission.clock ?? 0)+whole; }
    }
    if (mission?.stage === 'explore' && this.layout) {
      advanceMission(this.layout,this.state,mission,dt,p => this.roomOf(p),this.random,{threats:this.threats(),drop:p => this.knock(p),stalkers:this.stalkers});
      if (mission.stage !== 'explore') this.returnHome();
    }
  }

  // What drives a Gnawer off: a lit flare within `flareFear`, wherever it is,
  // and a thrown thing in flight passing close.
  private threats() {
    const mission = this.state.mission, out: (Point3 & {reach: number; place: Place})[] = [];
    if (!mission) return out;
    const lamp = this.state.lamp;
    for (const e of [...mission.haul,{...lamp,id:lampSlot}]) {
      const place = placeOf(e);
      if (place === 'home') continue;
      const path = e.flight && this.arcs.get(e.id);
      if (e.flight && path) out.push({...positionAt(path,e.flight.t),reach:0.8,place});
      else if (!e.flight) this.arcs.delete(e.id);
      if ('burn' in e && e.burn !== undefined && e.burn > 0 && !('used' in e && e.used)) {
        const holder = e.owner !== null ? this.state.players.find(q => q.id === e.owner) : undefined;
        out.push(holder ? {x:holder.x,y:holder.feetY ?? 0,z:holder.z,reach:flareFear,place} : {x:e.x,y:e.y,z:e.z,reach:flareFear,place});
      }
    }
    return out;
  }

  // A Gnawer's bite tears salvage (not the flashlight, not bought gear) from
  // the victim, to their feet: what is in hand if it is salvage, otherwise
  // the first piece carried.
  private knock(p: Player) {
    const haul = this.state.mission?.haul ?? [];
    const loot = (item: string | null) => !!item && item !== lampSlot && haul.some(e => e.id === item && e.owner === p.id && !e.kind);
    const held = selected(p), item = loot(held ?? null) ? held! : slotsOf(p).find(loot);
    const h = item && haul.find(e => e.id === item);
    if (!item || !h) return;
    Object.assign(h,{owner:null,x:p.x,y:p.feetY ?? 0,z:p.z,place:placeOf(p)});
    this.release(p,item);
    return item;
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
    delete p.vy;
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
    // Salvage carried in is banked; bought gear stays in hand.
    for (const h of mission.haul) if (h.owner === p.id && !h.kind) Object.assign(h,{owner:null,banked:true,x:rift.x,y:rift.y ?? 0,z:rift.z,place:'outside'});
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
    mission.rift = {x:spot.x,y:spot.y,z:spot.z,seconds:riftOpen};
  }

  // A door of the building within reach, from outside or within.
  passage(p: Player) {
    if (!this.state.mission || !this.layout || this.state.mission.stage !== 'explore') return;
    return passageFor(p,this.layout,this.state.mission.arrival === 'closed');
  }

  // After a sale everyone is back home, with the flashlight in its place.
  private returnHome() {
    // Home restores everyone's health.
    for (const q of this.state.players) { this.moveTo(q,'home',home().spawns[q.id-1] ?? home().spawns[0]); delete q.hp; delete q.calm; }
    // A flashlight left behind stays lost until the crew buys another.
    if (!this.state.lamp.lost) Object.assign(this.state.lamp,{...home().lamp,y:0.14,yaw:0,pitch:0,owner:null,on:chargeOf(this.state.lamp) > 0,stowed:false,place:'home'});
    else Object.assign(this.state.lamp,{owner:null,on:false,stowed:false});
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
    const kind = item === lampSlot ? 'lamp' : layout && catalog(layout,mission).find(s => s.id === item)?.kind;
    if (!kind) return;
    let rest = feet, flight: Flight | undefined, banked = false;
    const body: Body = bodyOf(kind), place = placeOf(p), g = this.geometryAt(place);
    // Dropped in mid-air (jumping, falling), it falls too, like a throw
    // with no speed.
    const dropped = !aim && !!g && (p.vy !== undefined || !surfaceAt(g,p.x,p.z,feet.y));
    if (dropped) aim = {yaw:p.yaw,pitch:0,power:0};
    if (aim && g) {
      // The aim travels with the command, so the throw goes where the thrower
      // was looking even if their latest view hasn't reached the host yet.
      const opened = this.openedAt(place);
      const speed = dropped ? 0 : throwSpeed(aim.power,kind !== 'lamp' && !!itemKinds[kind].heavy);
      const start = launchFrom(g,opened,p,{fx:-Math.sin(aim.yaw),fz:-Math.cos(aim.yaw),up:Math.sin(aim.pitch),speed},body);
      const path = trajectory(g,opened,start,body,feet);
      this.arcs.set(item,path);
      rest = path.rest;
      if (path.duration > 0) flight = {...start,t:0,d:path.duration};
      // A throw whose arc passes through the exit rift ends there, banked.
      const rift = mission?.rift;
      if (rift && place === 'outside' && flight) {
        for (let i=0;i<path.points.length/3;i++) {
          if (!inRift(rift,path.points[i*3],path.points[i*3+1],path.points[i*3+2])) continue;
          flight.d = Math.max(flightStep,i*flightStep);
          rest = {x:rift.x,y:rift.y ?? 0,z:rift.z};
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
    // Ending up in deep water, it sinks once it lands; down a pit, it is gone.
    const water = place === 'outside' && layout ? outdoors(layout.seed).geometry.water : undefined, level = water ? waterLevel(water,rest.x,rest.z) : undefined;
    const sinks = (level !== undefined && level-rest.y > wadeDepth+0.5) || (place === 'inside' && rest.y < -pitKill);
    this.release(p,item);
    if (item === lampSlot) {
      const lamp: Lamp = this.state.lamp;
      Object.assign(lamp,{owner:null,x:rest.x,y:rest.y+body.h,z:rest.z,pitch:0,stowed:false},mission ? {place} : {});
      if (flight) lamp.flight = flight; else delete lamp.flight;
      if (banked) lamp.homeward = true;
      else if (sinks) lamp.sinks = true;
    } else if (mission) {
      const h = mission.haul.find(entry => entry.id === item);
      if (!h) return;
      Object.assign(h,{owner:null,x:rest.x,y:rest.y,z:rest.z,place});
      if (flight) h.flight = flight; else delete h.flight;
      // Salvage in the rift is banked; bought gear goes home like the flashlight.
      if (banked) { if (h.kind) h.homeward = true; else h.banked = true; }
      // A flare lights as it leaves the hand.
      if (h.kind === 'flare' && h.burn === undefined) h.burn = flareTime;
      if (sinks && !h.banked && !h.homeward) h.sinks = true;
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
    if (mission?.stage === 'home' && action !== 'select' && action !== 'take' && action !== 'drop' && action !== 'throw' && action !== 'toggle' && action !== 'load' && action !== 'buy') return;
    if (action === 'buy') { this.buy(p,extra.buy); return; }
    if (mission?.down.some(d => d.id === id) || (mission && gone(mission,id))) return;
    const layout = this.layout;
    if (layout && mission && action === 'operate') {
      const task = assignment(layout,this.state,p,this.solids(p));
      if (task?.kind === 'revive') {
        // Back on their feet, with a little health.
        const revived = this.state.players.filter(q => q.id !== id && distance(q,p) <= 1.7 && mission.down.some(d => d.id === q.id));
        mission.down = mission.down.filter(d => !revived.some(q => q.id === d.id));
        for (const q of revived) Object.assign(q,{hp:revivedHealth,calm:recoverAfter});
      }
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
        // A bought item keeps its kind, and a lit flare keeps burning; only
        // the facility's own salvage wakes the Diver.
        const prev = mission.haul.find(h => h.id === item.id), bought = prev?.kind;
        mission.haul = [...mission.haul.filter(h => h.id !== item.id),{id:item.id,owner:id,x:item.x,y:item.y,z:item.z,...(bought ? {kind:bought} : {}),...(prev?.burn !== undefined ? {burn:prev.burn} : {})}];
        if (!bought) wake(layout,mission,this.roomOf(p) ?? item.room);
        if (lamp.owner === id) this.hold(p);
      }
      return;
    }
    if (action === 'open-door') {
      // R uses the nearest door: the façade, Intake's outer door, or a bulkhead.
      const way = this.passage(p), layout = this.layout;
      if (way?.way === 'enter' && layout) this.moveTo(p,'inside',beside(insideDoors(layout).find(d => d.id === way.id)!.entry,p.id));
      else if (way?.way === 'leave' && layout) this.moveTo(p,'outside',beside(outdoors(layout.seed).doors.find(d => d.id === way.id)!.exit,p.id));
      else if (placeOf(p) === 'inside' && this.geometry && this.state.opened) {
        const door = nearbyDoor(p,this.geometry,this.state.opened);
        if (door) this.state.opened.push(door.id);
      }
      return;
    }
    if (action === 'swing') { this.swing(p); return; }
    // A flat battery won't switch on.
    if (lamp.owner === id && action === 'toggle' && (lamp.on || chargeOf(lamp) > 0)) {
      lamp.on = !lamp.on;
    }
    // A spare cell in hand goes into the flashlight its holder carries.
    if (action === 'load' && lamp.owner === id && layout && mission) {
      const item = selected(p), h = mission.haul.find(e => e.id === item && e.owner === id);
      if (!h || catalog(layout,mission).find(s => s.id === h.id)?.kind !== 'cell') return;
      Object.assign(h,{owner:null,used:true});
      this.release(p,h.id);
      lamp.charge = batteryLife; this.spent = 0;
    }
  }

  // Diagnostics only, and only where this simulation runs in the player's own
  // browser (solo or the hub host): add to the wallet without counting toward
  // the quota, to try the shop without an expedition first.
  grant(amount: number) {
    const c = this.state.mission?.contract;
    if (c && Number.isFinite(amount) && amount > 0) c.spent = (c.spent ?? 0)-amount;
  }

  // The home terminal, between expeditions: a ware for its price from the
  // crew's wallet, laid out in front of the terminal. A replacement
  // flashlight is sold only when the flashlight was left behind.
  private buy(p: Player, ware: Command['buy']) {
    const mission = this.state.mission, lamp = this.state.lamp;
    if (!ware || mission?.stage !== 'home' || placeOf(p) !== 'home' || distance(p,home().terminal) > 2.1) return;
    const c = mission.contract, price = prices[ware];
    if (wallet(c) < price || (ware === 'lamp' && !lamp.lost)) return;
    if (ware === 'lamp') {
      Object.assign(lamp,{...home().lamp,y:0.14,yaw:0,pitch:0,owner:null,on:true,stowed:false,place:'home',lost:false});
      delete lamp.charge; delete lamp.flight; this.spent = 0;
    } else {
      c.bought = (c.bought ?? 0)+1;
      mission.haul.push({id:'bought-'+c.bought,kind:ware,owner:null,...deliverySpot(mission),place:'home'});
    }
    c.spent = (c.spent ?? 0)+price;
  }

  // A swing of the stun baton in hand stuns the Bell Diver if its bell is in
  // the swinger's room, within reach ahead and overhead. The next swing waits
  // for this one to finish (less a little, for presses bunched by the network).
  private swing(p: Player) {
    const mission = this.state.mission, layout = this.layout, item = selected(p);
    if (!mission || !layout || mission.stage !== 'explore' || !item || catalog(layout,mission).find(s => s.id === item)?.kind !== 'baton') return;
    if (this.time-(this.swungAt.get(p.id) ?? -Infinity) < swingTime*0.8) return;
    this.swungAt.set(p.id,this.time);
    p.swings = (p.swings ?? 0)+1;
    // A Gnawer within reach ahead takes the hit first; outside, the Lurker.
    if (placeOf(p) === 'inside' && swat(layout,this.state,mission,p)) return;
    if (placeOf(p) === 'outside') { if (!swatStalker(mission,p)) swatLurker(mission,this.state,p); return; }
    const bell = bellSpan(layout,mission.diver,mission), feet = p.feetY ?? 0;
    if (!bell || placeOf(p) !== 'inside' || this.roomOf(p) !== mission.diver.bay) return;
    const dx = bell.x-p.x, dz = bell.z-p.z, d = Math.hypot(dx,dz);
    const ahead = d < 0.3 || (-Math.sin(p.yaw)*dx-Math.cos(p.yaw)*dz)/d > Math.cos(1.3);
    if (d <= batonReach.ahead && ahead && bell.bottom <= feet+batonReach.up && bell.top >= feet+0.2) stun(mission);
  }

  // After the receipt, plan the contract's next facility, or after a wipe a
  // fresh contract. The crew stays home until someone steps into the rift;
  // nothing of the facility is built yet.
  nextExpedition() {
    const mission = this.state.mission;
    if (!mission || mission.stage !== 'settled') return;
    const wipe = mission.outcome === 'wipe';
    if (wipe) {
      mission.contract = newContract(wipeSeed(mission.contract.seed));
      delete mission.outcome;
      // A fresh contract starts from nothing but a new flashlight, fully charged.
      const lamp = this.state.lamp;
      Object.assign(lamp,{...home().lamp,y:0.14,yaw:0,pitch:0,owner:null,on:true,stowed:false,place:'home',lost:false});
      delete lamp.charge; delete lamp.flight;
    } else {
      mission.contract.index++;
      mission.contract.layout = expeditionSeed(mission.contract.seed,mission.contract.index);
    }
    this.layout = generateLayout(mission.contract.layout);
    this.state.opened = [];
    // Bought gear that came home stays; everything else went with the facility.
    Object.assign(mission,{stage:'home',haul:wipe ? [] : mission.haul.filter(h => h.kind),down:[],awake:false,diver:{mode:'dormant',bay:'',seconds:0}});
    for (const key of ['arrival','bell','rift','enraged','escaped','dead','clock','drowning','gnawers','lurkers','stalkers','flat'] as const) delete mission[key];
    this.fillSlots();
  }
}

// Which door an operator can use from where they stand: the façade door
// from outside, or Intake's outer door from inside. The façade stays shut
// until the whole crew has come through the arrival rift.
// Which door an operator can use from where they stand: one of the
// building's doors from outside, or its inside end from within. `id` names
// the door: 'main' (the façade and Intake) or a fire exit.
export function passageFor(p: Player, layout: Layout, crewOut: boolean): {way: 'enter' | 'leave'; id: string} | undefined {
  const place = placeOf(p);
  if (place === 'outside' && crewOut) {
    const d = outdoors(layout.seed).doors.find(d => distance(p,d.door) <= doorReach && insideDoors(layout).some(e => e.id === d.id));
    if (d) return {way:'enter',id:d.id};
  }
  if (place === 'inside') {
    const d = insideDoors(layout).find(d => Math.abs((p.feetY ?? 0)-d.door.y) < 1 && distance(p,d.door) <= doorReach);
    if (d) return {way:'leave',id:d.id};
  }
}
