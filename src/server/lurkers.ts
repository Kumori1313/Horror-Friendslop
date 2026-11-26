// The Lurker (see `Lurker` in mission.ts): one in each river's longest deep
// stretch, under the water from the moment the crew arrives. Host only. It
// never leaves the deep water, so the fords stay safe crossings. Its plans
// stay here, off the snapshot. Like `Simulation`, no Node-only APIs.
import type { Layout } from '../layout.ts';
import { batonReach, gone, type Lurker, type Mission } from '../mission.ts';
import { groundAt, outdoors, placeOf, type Outdoors } from '../places.ts';
import type { Player, Snapshot } from '../room.ts';
import type { Point3 } from '../room-templates.ts';

// Metres per second along the river; faster once the bell has rung.
const speeds = {lurk:0.9,hunt:3.0};
// It hears someone moving within `hearMoving` m, someone still within
// `hearStill`; it grabs within `grabReach` m (from under the water, so up to
// `grabHeight` above it: a low bridge is not safe); it drags its victim at
// `dragSpeed`, a quarter of that while they struggle; after letting go it
// stays down `sinkTime` seconds.
// Hunting, it comes up to `edge` metres toward the bank it heard, as long as
// the water there is still deep.
// Holding someone, it backs toward the middle of the channel at `retreat`,
// so a victim has some seconds before the deep water closes over them.
export const hearMoving = 16, hearStill = 6, grabReach = 4.2, grabHeight = 3.5, dragSpeed = 0.9, retreat = 0.5, sinkTime = 15, grabDamage = 10, flareFear = 4, edge = 2.6;
const enraged = 1.4, depthNeeded = 2;

interface Plan { s: number; target: number; offset: number; side: number; until: number; struggle: number; grabbedAt?: Point3; last: Map<number,{x: number; z: number}> }
const plans = new WeakMap<Mission,Map<number,Plan>>();
// Its stretch of river: the indices of the longest run of deep water inside
// the map.
const stretches = new WeakMap<Outdoors,{lo: number; hi: number}>();
function stretch(map: Outdoors) {
  let found = stretches.get(map);
  if (found) return found;
  const p = map.water.points, deep = p.map(q => Math.max(Math.abs(q.x),Math.abs(q.z)) < 62 && q.level-groundAt(map,q.x,q.z) >= depthNeeded);
  let best = {lo:0,hi:-1};
  for (let i=0;i<p.length;i++) {
    if (!deep[i]) continue;
    let j = i;
    while (j+1 < p.length && deep[j+1]) j++;
    if (j-i > best.hi-best.lo) best = {lo:i,hi:j};
    i = j;
  }
  stretches.set(map,found = best);
  return found;
}
// The point `s` (a fractional index) along the centre line, just under the
// surface, and the way across the river there (`nx`, `nz`).
function at(map: Outdoors, s: number) {
  const p = map.water.points, i = Math.max(0,Math.min(p.length-2,Math.floor(s))), f = Math.max(0,Math.min(1,s-i)), a = p[i], b = p[i+1];
  const len = Math.hypot(b.x-a.x,b.z-a.z) || 1;
  return {x:a.x+(b.x-a.x)*f,z:a.z+(b.z-a.z)*f,level:a.level+(b.level-a.level)*f,yaw:Math.atan2(-(b.x-a.x),-(b.z-a.z)),nx:-(b.z-a.z)/len,nz:(b.x-a.x)/len};
}
// The point of its stretch nearest (x, z).
function nearest(map: Outdoors, {lo,hi}: {lo: number; hi: number}, x: number, z: number) {
  let best = lo, d = Infinity;
  for (let s=lo;s<=hi;s+=0.25) { const q = at(map,s), e = (q.x-x)**2+(q.z-z)**2; if (e < d) { d = e; best = s; } }
  return best;
}
function planOf(mission: Mission, id: number, s: number) {
  let all = plans.get(mission);
  if (!all) plans.set(mission,all = new Map());
  let plan = all.get(id);
  if (!plan) all.set(id,plan = {s,target:s,offset:0,side:0,until:0,struggle:0,last:new Map()});
  return plan;
}

// The stretch of river a Lurker keeps to (for tests): indices into the
// water's points.
export const lurkerStretch = (seed: number) => stretch(outdoors(seed));

// One Lurker, in the middle of the river's longest deep stretch.
export function spawnLurkers(layout: Layout): Lurker[] {
  const map = outdoors(layout.seed), range = stretch(map);
  if (range.hi-range.lo < 6) return [];
  const s = (range.lo+range.hi)/2, q = at(map,s);
  return [{id:1,x:q.x,y:q.level-0.7,z:q.z,yaw:q.yaw,mode:'lurk'}];
}

// It lets go: the victim scrambles back to where they were grabbed, and it
// sinks away for `sinkTime` seconds.
function release(mission: Mission, state: Snapshot, l: Lurker) {
  const plan = plans.get(mission)?.get(l.id), victim = state.players.find(p => p.id === l.grab);
  if (victim && plan?.grabbedAt && !gone(mission,victim.id)) { Object.assign(victim,{x:plan.grabbedAt.x,z:plan.grabbedAt.z,feetY:plan.grabbedAt.y,vy:0}); mission.drowning = mission.drowning?.filter(d => d.id !== victim.id); }
  delete l.grab;
  l.mode = 'sunk';
  if (plan) { plan.until = sinkTime; delete plan.grabbedAt; }
}

// The victim mashes the jump key: the drag slows for a moment.
export function struggle(mission: Mission, id: number) {
  const l = mission.lurkers?.find(n => n.mode === 'grab' && n.grab === id), plan = l && plans.get(mission)?.get(l.id);
  if (plan) plan.struggle = 0.4;
}

// A baton swing: a hit near the Lurker or the one it holds makes it let go;
// one hunting or lurking near the swinger sinks away.
export function swatLurker(mission: Mission, state: Snapshot, p: Player) {
  for (const l of mission.lurkers ?? []) {
    if (l.mode === 'sunk') continue;
    const victim = l.mode === 'grab' ? state.players.find(q => q.id === l.grab) : undefined;
    const close = (q: {x: number; z: number}) => Math.hypot(q.x-p.x,q.z-p.z) <= batonReach.ahead+0.6;
    if (!close(l) && !(victim && close(victim))) continue;
    release(mission,state,l);
    return true;
  }
  return false;
}

// Each tick. `threats`: lit flares and thrown things in flight, outside;
// `bite` hurts an operator.
export function stepLurkers(layout: Layout, state: Snapshot, mission: Mission, dt: number, random: () => number,
  threats: (Point3 & {reach: number})[], bite: (p: Player, damage: number) => void) {
  const map = outdoors(layout.seed), range = stretch(map), fast = mission.enraged ? enraged : 1;
  for (const l of mission.lurkers ?? []) {
    const plan = planOf(mission,l.id,nearest(map,range,l.x,l.z));
    plan.until -= dt; plan.struggle -= dt;
    // Who is outside and could be heard, and who has moved since last tick.
    const prey = state.players.filter(p => p.connected && placeOf(p) === 'outside' && !gone(mission,p.id) && !mission.down.some(d => d.id === p.id) && !mission.lurkers!.some(n => n.grab === p.id));
    const moved = new Map(prey.map(p => { const last = plan.last.get(p.id); return [p.id,!!last && Math.hypot(last.x-p.x,last.z-p.z) > 0.01]; }));
    for (const p of state.players) plan.last.set(p.id,{x:p.x,z:p.z});
    const near = (q: Point3, t: Point3 & {reach: number}) => Math.hypot(q.x-t.x,q.z-t.z) <= t.reach && Math.abs(q.y-t.y) < 4;
    if (l.mode === 'grab') {
      const victim = state.players.find(p => p.id === l.grab);
      if (!victim || gone(mission,victim.id) || placeOf(victim) !== 'outside') { release(mission,state,l); continue; }
      if (threats.some(t => near(l,t) || near({x:victim.x,y:victim.feetY ?? 0,z:victim.z},t))) { release(mission,state,l); continue; }
      // Dragged toward it, into the deep water, where the breath runs out.
      const dx = l.x-victim.x, dz = l.z-victim.z, d = Math.hypot(dx,dz);
      if (d > 0.6) {
        const step = Math.min(d-0.6,dragSpeed*fast*(plan.struggle > 0 ? 0.25 : 1)*dt);
        victim.x = Math.round((victim.x+dx/d*step)*100)/100; victim.z = Math.round((victim.z+dz/d*step)*100)/100;
        victim.vy ??= 0;
      }
      plan.target = plan.s;
    }
    if (l.mode === 'grab') { /* holding: only backing away, below */ }
    else if (l.mode === 'sunk') {
      if (plan.until <= 0) l.mode = 'lurk';
    } else if (threats.some(t => t.reach >= flareFear && near(l,t))) {
      // A lit flare at the water's edge drives it down.
      l.mode = 'sunk'; plan.until = sinkTime/2;
    } else {
      const heard = prey.filter(p => Math.hypot(p.x-l.x,p.z-l.z) <= (moved.get(p.id) ? hearMoving : hearStill)*(mission.enraged ? 1.5 : 1))
        .sort((a,b) => Math.hypot(a.x-l.x,a.z-l.z)-Math.hypot(b.x-l.x,b.z-l.z))[0];
      const level = at(map,plan.s).level;
      const caught = heard && Math.hypot(heard.x-l.x,heard.z-l.z) <= grabReach && (heard.feetY ?? 0)-level <= grabHeight;
      if (caught) {
        l.mode = 'grab'; l.grab = heard.id; l.grabs = (l.grabs ?? 0)+1;
        plan.grabbedAt = {x:heard.x,y:heard.feetY ?? 0,z:heard.z};
        delete heard.vy;
        bite(heard,grabDamage);
        continue;
      }
      if (heard) {
        l.mode = 'hunt'; plan.target = nearest(map,range,heard.x,heard.z);
        const c = at(map,plan.target);
        plan.side = Math.sign((heard.x-c.x)*c.nx+(heard.z-c.z)*c.nz);
      }
      else {
        if (l.mode === 'hunt' || plan.until <= 0 || Math.abs(plan.target-plan.s) < 0.05) {
          l.mode = 'lurk';
          plan.target = Math.max(range.lo,Math.min(range.hi,plan.s+(random()-0.5)*16));
          plan.until = 4+random()*6;
        }
      }
    }
    // Along the river toward its target, sunk ones deeper and slower.
    const speed = (l.mode === 'hunt' ? speeds.hunt : speeds.lurk)*fast*(l.mode === 'sunk' ? 0.5 : 1), metres = Math.hypot(at(map,Math.floor(plan.s)+1).x-at(map,Math.floor(plan.s)).x,at(map,Math.floor(plan.s)+1).z-at(map,Math.floor(plan.s)).z) || 2;
    const ds = Math.max(-1,Math.min(1,plan.target-plan.s))*Math.min(Math.abs(plan.target-plan.s),speed*dt/metres);
    plan.s = Math.max(range.lo,Math.min(range.hi,plan.s+ds));
    const q = at(map,plan.s);
    // Toward the bank it heard while hunting, back to the middle otherwise;
    // never into water shallower than it needs.
    const want = l.mode === 'hunt' ? plan.side*edge : 0;
    const shift = (l.mode === 'grab' ? retreat : 1.5)*dt;
    plan.offset += Math.max(-shift,Math.min(shift,want-plan.offset));
    while (Math.abs(plan.offset) > 0.05) {
      const x = q.x+q.nx*plan.offset, z = q.z+q.nz*plan.offset;
      if (q.level-groundAt(map,x,z) >= depthNeeded) break;
      plan.offset *= 0.8;
    }
    l.x = Math.round((q.x+q.nx*plan.offset)*100)/100; l.z = Math.round((q.z+q.nz*plan.offset)*100)/100;
    l.y = Math.round((q.level-(l.mode === 'sunk' ? 1.6 : l.mode === 'hunt' || l.mode === 'grab' ? 0.45 : 0.7))*100)/100;
    l.yaw = Math.round((ds < 0 ? q.yaw+Math.PI : q.yaw)*100)/100;
  }
}
