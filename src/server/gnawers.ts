// The Gnawer, a dog-sized scavenger of the facility's floors (see `Gnawer` in
// mission.ts). Host only: each tick it roams, seeks loose salvage, chases an
// operator carrying salvage, drags what it gets to its nest, bites whoever
// comes close, and flees from a baton, a thrown item or a lit flare. Its
// plans (paths and timers) stay here, off the snapshot. Like `Simulation`, no
// Node-only APIs.
import { anchor, connections, geometryFor, neighbours, type Layout } from '../layout.ts';
import { batonReach, catalog, gone, type Gnawer, type Mission } from '../mission.ts';
import { placeOf } from '../places.ts';
import { slotsOf, type Player, type Snapshot } from '../room.ts';
import { roomTemplates, surfaceAt, surfaceHeight, type Point3 } from '../room-templates.ts';
import { route } from '../route.ts';

// Metres per second in each mode; faster once the bell has rung.
const speeds = {roam:1.8,seek:2.8,chase:3.6,carry:2.6,flee:4.4};
// After a bite that takes nothing, it backs off for `recoil` seconds: it nips
// and runs rather than chewing someone down.
export const biteReach = 1.2, biteEvery = 1.6, recoil = 3, fleeTime = 10, flareFear = 3.5;
// A bite's damage, from the low end to the high end.
export const biteDamage = [10,16] as const;
const notice = 7, enraged = 1.3;

interface Plan { path: Point3[]; until: number; cooldown: number; target?: string | number; replan: number; fails: number }
const plans = new WeakMap<Mission,Map<number,Plan>>();
function planOf(mission: Mission, id: number) {
  let all = plans.get(mission);
  if (!all) plans.set(mission,all = new Map());
  let plan = all.get(id);
  if (!plan) all.set(id,plan = {path:[],until:0,cooldown:0,replan:0,fails:0});
  return plan;
}

// One Gnawer on the first expedition of a contract, two after; each nests in
// a room at least three connections from Intake, never over a pit.
export function spawnGnawers(layout: Layout, mission: Mission, random: () => number): Gnawer[] {
  const hops = connections(layout), intake = layout.rooms.find(r => r.kind === 'intake');
  if (!intake) return [];
  const rooms = layout.rooms.filter(r => r.kind !== 'corridor' && r.kind !== 'stairwell' && r.kind !== 'intake' && !roomTemplates[r.template].depth && hops(intake.id,r.id) >= 3);
  for (let i=rooms.length-1;i>0;i--) { const k = Math.floor(random()*(i+1)); [rooms[i],rooms[k]] = [rooms[k],rooms[i]]; }
  return rooms.slice(0,mission.contract.index >= 1 ? 2 : 1).map((r,i) => {
    const nest = anchor(r);
    return {id:i+1,x:nest.x,y:nest.y,z:nest.z,yaw:0,mode:'roam',nest};
  });
}

const roomAt = (layout: Layout, p: Point3) => surfaceAt(geometryFor(layout),p.x,p.z,p.y)?.room;
const near = (a: Point3, b: Point3, reach: number) => Math.hypot(a.x-b.x,a.z-b.z) <= reach && Math.abs(a.y-b.y) < 1.2;
const feet = (p: Player): Point3 => ({x:p.x,y:p.feetY ?? 0,z:p.z});
// Plan a walk from where it stands, on the planner operators' routes use.
// Should it ever be somewhere no route leads from, after a few tries it is
// back at its nest.
function walkTo(layout: Layout, g: Gnawer, plan: Plan, to: Point3) {
  const path = route(geometryFor(layout),g,to,[0.25,0],0.6);
  plan.path = path ? path.slice(1) : [];
  plan.fails = path ? 0 : plan.fails+1;
  if (plan.fails >= 4) { Object.assign(g,{x:g.nest.x,y:g.nest.y,z:g.nest.z}); plan.fails = 0; }
  return !!path;
}
// Send a roaming Gnawer somewhere (for tests): it walks there and waits.
export function sendTo(layout: Layout, mission: Mission, g: Gnawer, to: Point3) {
  const plan = planOf(mission,g.id);
  g.mode = 'roam'; plan.until = 60;
  return walkTo(layout,g,plan,to);
}
// Salvage an operator carries (not the flashlight, not bought gear).
function loot(layout: Layout, mission: Mission, p: Player) {
  const kinds = new Map(catalog(layout,mission).map(s => [s.id,s]));
  return slotsOf(p).some(item => item && item !== 'lamp' && kinds.has(item) && !mission.haul.find(h => h.id === item)?.kind);
}

// Driven off: it drops what it carries where it stands and runs away from
// the operators for `seconds`, to the room within three connections farthest
// from them.
export function scare(layout: Layout, state: Snapshot, mission: Mission, g: Gnawer, seconds = fleeTime) {
  const plan = planOf(mission,g.id);
  if (g.carry) {
    const h = mission.haul.find(e => e.id === g.carry);
    if (h) { delete h.gnawer; Object.assign(h,{x:g.x,y:g.y,z:g.z}); }
    delete g.carry;
  }
  g.mode = 'flee';
  plan.until = seconds;
  const hops = connections(layout), here = roomAt(layout,g) ?? '';
  const people = state.players.filter(p => placeOf(p) === 'inside' && !gone(mission,p.id)).map(p => roomAt(layout,feet(p))).filter((r): r is string => !!r);
  const away = (room: string) => people.length ? Math.min(...people.map(r => hops(r,room))) : 0;
  const choices = layout.rooms.filter(r => hops(here,r.id) <= 3 && !roomTemplates[r.template].depth).sort((a,b) => away(b.id)-away(a.id));
  if (choices[0]) walkTo(layout,g,plan,anchor(choices[0]));
}

// A baton swing: the first Gnawer within reach ahead of the swinger is driven off.
export function swat(layout: Layout, state: Snapshot, mission: Mission, p: Player) {
  const at = feet(p);
  const g = mission.gnawers?.find(g => {
    const dx = g.x-p.x, dz = g.z-p.z, d = Math.hypot(dx,dz);
    return d <= batonReach.ahead && Math.abs(g.y-at.y) < 1.2 && (d < 0.3 || (-Math.sin(p.yaw)*dx-Math.cos(p.yaw)*dz)/d > Math.cos(1.3));
  });
  if (!g) return false;
  scare(layout,state,mission,g);
  return true;
}

// Each tick. `threats`: lit flares, and thrown items in flight, each with how
// near it must come to drive a Gnawer off. `bite` hurts an operator.
export function stepGnawers(layout: Layout, state: Snapshot, mission: Mission, dt: number, random: () => number,
  threats: (Point3 & {reach: number})[], bite: (p: Player, damage: number) => void, drop: (p: Player) => string | undefined) {
  const prey = state.players.filter(p => p.connected && placeOf(p) === 'inside' && !gone(mission,p.id) && !mission.down.some(d => d.id === p.id));
  const fast = mission.enraged ? enraged : 1;
  for (const g of mission.gnawers ?? []) {
    const plan = planOf(mission,g.id);
    plan.until -= dt; plan.cooldown -= dt; plan.replan -= dt;
    if (g.mode !== 'flee' && threats.some(t => near(g,t,t.reach))) scare(layout,state,mission,g);
    const loose = (id: string) => {
      const h = mission.haul.find(e => e.id === id);
      return !h || (h.owner === null && !h.flight && !h.used && !h.banked && h.gnawer === undefined && placeOf(h) === 'inside');
    };
    switch (g.mode) {
      case 'flee':
        if (plan.until <= 0) { g.mode = 'roam'; plan.until = 0; }
        break;
      case 'carry':
        if (!plan.path.length) {
          // Home: the salvage is left at the nest.
          const h = mission.haul.find(e => e.id === g.carry);
          if (h) { delete h.gnawer; Object.assign(h,{x:g.nest.x,y:g.nest.y,z:g.nest.z}); }
          delete g.carry;
          g.mode = 'roam'; plan.until = 5;
        }
        break;
      case 'seek': {
        const id = plan.target as string;
        if (!loose(id) || plan.until <= 0) { g.mode = 'roam'; plan.until = 1; break; }
        const at = itemAt(layout,mission,id);
        if (at && near(g,at,0.7)) take(layout,mission,g,plan,id);
        break;
      }
      case 'chase': {
        const p = prey.find(q => q.id === plan.target);
        if (!p || plan.until <= 0 || !loot(layout,mission,p)) { g.mode = 'roam'; plan.until = 2; break; }
        if (plan.replan <= 0) { walkTo(layout,g,plan,feet(p)); plan.replan = 0.8; }
        break;
      }
      case 'roam':
        if (plan.until > 0 && plan.path.length) break;
        if (plan.until > 0) break;
        decide(layout,mission,g,plan,prey,random);
        break;
    }
    // Bite whoever is within reach, unless fleeing; salvage in hand is knocked
    // loose and taken, and otherwise it backs off.
    if (g.mode !== 'flee' && plan.cooldown <= 0) {
      const victim = prey.find(p => near(g,feet(p),biteReach));
      if (victim) {
        plan.cooldown = biteEvery;
        g.bites = (g.bites ?? 0)+1;
        bite(victim,(biteDamage[0]+random()*(biteDamage[1]-biteDamage[0]))*(mission.enraged ? 1.4 : 1));
        const knocked = drop(victim);
        if (knocked && !g.carry) take(layout,mission,g,plan,knocked);
        else if (!g.carry) scare(layout,state,mission,g,recoil);
      }
    }
    move(layout,g,plan,speeds[g.mode]*fast,dt);
    if (g.carry) {
      const h = mission.haul.find(e => e.id === g.carry);
      if (h) Object.assign(h,{x:g.x,y:g.y+0.1,z:g.z});
    }
  }
}

function itemAt(layout: Layout, mission: Mission, id: string): Point3 | undefined {
  const h = mission.haul.find(e => e.id === id);
  if (h) return h;
  return catalog(layout,mission).find(s => s.id === id);
}

// Pick it up and head for the nest.
function take(layout: Layout, mission: Mission, g: Gnawer, plan: Plan, id: string) {
  let h = mission.haul.find(e => e.id === id);
  if (!h) {
    const s = catalog(layout,mission).find(e => e.id === id);
    if (!s) return;
    h = {id,owner:null,x:s.x,y:s.y,z:s.z,place:'inside'};
    mission.haul.push(h);
  }
  h.gnawer = g.id;
  g.carry = id;
  g.mode = 'carry';
  if (!walkTo(layout,g,plan,g.nest)) plan.path = [];
}

// What next: chase an operator carrying salvage nearby, else go for loose
// salvage within two rooms (not what already lies at a nest), else wander to
// a neighbouring room.
function decide(layout: Layout, mission: Mission, g: Gnawer, plan: Plan, prey: Player[], random: () => number) {
  const carrier = prey.filter(p => near(g,feet(p),notice) && loot(layout,mission,p)).sort((a,b) => Math.hypot(a.x-g.x,a.z-g.z)-Math.hypot(b.x-g.x,b.z-g.z))[0];
  if (carrier && walkTo(layout,g,plan,feet(carrier))) { g.mode = 'chase'; plan.target = carrier.id; plan.until = 6; plan.replan = 0.8; return; }
  const hops = connections(layout), here = roomAt(layout,g) ?? '';
  const nests = (mission.gnawers ?? []).map(n => n.nest);
  const moved = new Map(mission.haul.map(h => [h.id,h]));
  const lying = catalog(layout,mission).filter(s => {
    const h = moved.get(s.id), at = h ?? s;
    if (h && (h.owner !== null || h.flight || h.used || h.banked || h.gnawer !== undefined || placeOf(h) !== 'inside')) return false;
    if (nests.some(n => Math.hypot(n.x-at.x,n.z-at.z) < 2.5 && Math.abs(n.y-at.y) < 1)) return false;
    const room = roomAt(layout,at);
    return !!room && hops(here,room) <= 2;
  }).map(s => moved.get(s.id) ?? s).sort((a,b) => Math.hypot(a.x-g.x,a.z-g.z)-Math.hypot(b.x-g.x,b.z-g.z));
  for (const item of lying.slice(0,3)) {
    if (walkTo(layout,g,plan,item)) { g.mode = 'seek'; plan.target = item.id; plan.until = 20; return; }
  }
  const next = neighbours(layout,here).filter(id => !roomTemplates[layout.rooms.find(r => r.id === id)!.template].depth);
  const room = layout.rooms.find(r => r.id === next[Math.floor(random()*next.length)]);
  g.mode = 'roam';
  plan.until = 3+random()*4;
  if (!room || !walkTo(layout,g,plan,anchor(room))) plan.until = 1;
}

// Along its path at `speed`, turning to face the way it goes. Its height
// follows the floor beneath it, a little at a time, as an operator's does: a
// path keeps only its corners, and one leg can run along a landing and then
// down a flight, so easing from one corner's height to the next would sink
// it into the landing.
function move(layout: Layout, g: Gnawer, plan: Plan, speed: number, dt: number) {
  const geometry = geometryFor(layout);
  let left = speed*dt;
  while (left > 0 && plan.path.length) {
    const to = plan.path[0], dx = to.x-g.x, dz = to.z-g.z, d = Math.hypot(dx,dz);
    if (d < 1e-6) { plan.path.shift(); continue; }
    const step = Math.min(left,d,0.25), f = step/d;
    g.x += dx*f; g.z += dz*f;
    const floor = surfaceAt(geometry,g.x,g.z,g.y);
    g.y = floor ? surfaceHeight(floor,g.x,g.z) : g.y+(to.y-g.y)*f;
    g.yaw = Math.atan2(-dx,-dz);
    left -= step;
    if (step >= d-1e-9) plan.path.shift();
  }
  g.x = Math.round(g.x*100)/100; g.z = Math.round(g.z*100)/100; g.y = Math.round(g.y*100)/100; g.yaw = Math.round(g.yaw*100)/100;
}
