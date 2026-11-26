// Stalkers (see `Stalker` in mission.ts): host only, outside only. They walk
// a 1 m grid of the outdoor map (open ground clear of solids and deep water,
// never up ground too steep to climb), found once per map, and plan on it
// with A*; their plans stay here, off the snapshot. Like `Simulation`, no
// Node-only APIs.
import { collisionIndex, deep, type Layout } from '../layout.ts';
import { batonReach, gone, type Mission, type Stalker } from '../mission.ts';
import { groundAt, outdoors, placeOf, type Outdoors } from '../places.ts';
import type { Player, Snapshot } from '../room.ts';
import { climbable, planningGrade, type Point3, type Surface } from '../room-templates.ts';
import { flareFear } from './gnawers.ts';
import { carrying, mapKind, weather } from '../map-kinds.ts';

// The build-up, by the expedition's clock (time inside counts too): the
// first after `firstAfter` seconds, one more every `every` seconds, up to
// `most`; the bell sends one more.
export const firstAfter = 180, every = 120, most = 3;
// It sees an operator within `sight` m (`lampSight` with a flashlight lit in
// hand) along a clear line, and hears anyone moving within `hearing` m. Seen
// within `chargeRange` m along open ground, it winds up for `windup` s, then
// rushes at `chargeSpeed` m/s to where they stood when it set off, a few
// metres past; anyone within `hitReach` m of it takes `chargeDamage` and lies
// flat for `flatTime` s. Running into a solid stuns it for `crashTime` s; a
// baton hit or a thrown item stuns it for `stunTime` s, after which it backs
// off. It will not come within `flareKeep` m of a lit flare. After a hit it
// waits `afterHit` s before charging again. It needs a run-up: closer than
// `tooClose` m it backs off, and while it cannot charge yet it holds about
// `holdOff` m away.
export const sight = 32, lampSight = 48, hearing = 6, chargeRange = 14, windup = 1, chargeSpeed = 12, hitReach = 1.1,
  chargeDamage = 50, flatTime = 2.5, crashTime = 2.5, stunTime = 3, flareKeep = 7, afterHit = 6, tooClose = 5, holdOff = 9;
// Walking speeds (m/s): an operator walks 3.3; faster after the bell.
const speeds = {roam:1.6,stalk:3.0,search:2.2,flee:3.4}, enraged = 1.3, span = 78, body = 0.45;

// The grid: one point per metre from -span to span on each axis.
// `linked`: the grid points reachable from the main door, where stalkers
// arrive and roam, so none starts in a hollow it cannot climb out of.
interface Grid { n: number; ground: Float32Array; open: Uint8Array; linked: Uint8Array; field: Surface; index: ReturnType<typeof collisionIndex> }
const grids = new WeakMap<Outdoors,Grid>();
function grid(map: Outdoors) {
  let found = grids.get(map);
  if (found) return found;
  const g = map.geometry, index = collisionIndex(g), n = span*2+1, ground = new Float32Array(n*n), open = new Uint8Array(n*n);
  const field = g.surfaces.find(s => s.field)!;
  for (let ix=0;ix<n;ix++) for (let iz=0;iz<n;iz++) {
    const x = ix-span, z = iz-span, y = groundAt(map,x,z), i = ix*n+iz;
    ground[i] = y;
    open[i] = !deep(g,x,z,y) && index.clear(x,z,y,body) ? 1 : 0;
  }
  const linked = new Uint8Array(n*n);
  grids.set(map,found = {n,ground,open,linked,field,index});
  const start = node(found,map.exit.x,map.exit.z), queue = start >= 0 ? [start] : [];
  if (start >= 0) linked[start] = 1;
  for (let k=0;k<queue.length;k++) {
    const i = queue[k], ix = Math.floor(i/n), iz = i%n;
    for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const jx = ix+dx, jz = iz+dz, j = jx*n+jz;
      if (jx < 0 || jz < 0 || jx >= n || jz >= n || linked[j] || !passable(found,i,j)) continue;
      linked[j] = 1; queue.push(j);
    }
  }
  return found;
}
const node = (nav: Grid, x: number, z: number) => {
  const ix = Math.round(x)+span, iz = Math.round(z)+span;
  return ix < 0 || iz < 0 || ix >= nav.n || iz >= nav.n ? -1 : ix*nav.n+iz;
};
const openAt = (nav: Grid, x: number, z: number) => { const i = node(nav,x,z); return i >= 0 && nav.open[i] === 1; };
// Can it step between these neighbouring grid points?
function passable(nav: Grid, a: number, b: number) {
  if (!nav.open[b]) return false;
  const ax = Math.floor(a/nav.n)-span, az = a%nav.n-span, bx = Math.floor(b/nav.n)-span, bz = b%nav.n-span;
  if (ax !== bx && az !== bz && (!nav.open[a+(bx-ax)*nav.n] || !nav.open[a+(bz-az)])) return false;
  return climbable(nav.field,nav.ground[a],nav.ground[b],(ax+bx)/2,(az+bz)/2,planningGrade);
}
// Open ground all along a straight line, never up too steep a slope, sampled
// every half metre: for cutting corners and for a charge's run.
function straight(map: Outdoors, nav: Grid, from: {x: number; z: number}, to: {x: number; z: number}) {
  const d = Math.hypot(to.x-from.x,to.z-from.z), steps = Math.ceil(d/0.5);
  let last = groundAt(map,from.x,from.z);
  for (let k=1;k<=steps;k++) {
    const x = from.x+(to.x-from.x)*k/steps, z = from.z+(to.z-from.z)*k/steps, y = groundAt(map,x,z);
    if (!openAt(nav,x,z) || !nav.index.clear(x,z,y,body) || !climbable(nav.field,last,y,x,z,planningGrade)) return false;
    last = y;
  }
  return true;
}
// A* from the grid point nearest `from` toward `to`; if `to` cannot be
// reached, toward the reachable point nearest it.
function findPath(map: Outdoors, nav: Grid, from: Point3, to: {x: number; z: number}): Point3[] {
  const start = node(nav,from.x,from.z), goal = node(nav,to.x,to.z);
  if (start < 0 || goal < 0) return [];
  const n = nav.n, cost = new Float32Array(n*n).fill(Infinity), came = new Int32Array(n*n).fill(-1), heap: [number,number][] = [];
  const gx = Math.floor(goal/n), gz = goal%n, h = (i: number) => Math.hypot(Math.floor(i/n)-gx,i%n-gz);
  const push = (f: number, i: number) => {
    heap.push([f,i]);
    for (let k=heap.length-1;k>0;) { const up = (k-1) >> 1; if (heap[up][0] <= heap[k][0]) break; [heap[up],heap[k]] = [heap[k],heap[up]]; k = up; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let k=0;;) { const l = 2*k+1, r = l+1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m],heap[k]] = [heap[k],heap[m]]; k = m; }
    }
    return top;
  };
  cost[start] = 0; push(h(start),start);
  let best = start, bestH = h(start), expanded = 0;
  while (heap.length && expanded < 40000) {
    const [f,i] = pop();
    if (f > cost[i]+h(i)+1e-6) continue;
    expanded++;
    if (h(i) < bestH) { best = i; bestH = h(i); }
    if (i === goal) break;
    const ix = Math.floor(i/n), iz = i%n;
    for (let dx=-1;dx<=1;dx++) for (let dz=-1;dz<=1;dz++) {
      if (!dx && !dz) continue;
      const jx = ix+dx, jz = iz+dz;
      if (jx < 0 || jz < 0 || jx >= n || jz >= n) continue;
      const j = jx*n+jz, c = cost[i]+(dx && dz ? Math.SQRT2 : 1);
      if (c >= cost[j] || !passable(nav,i,j)) continue;
      cost[j] = c; came[j] = i; push(c+h(j),j);
    }
  }
  const path: Point3[] = [];
  for (let i = best; i !== start && i >= 0; i = came[i]) path.push({x:Math.floor(i/n)-span,y:nav.ground[i],z:i%n-span});
  return path.reverse();
}
// For tests: open ground on its grid, and an open straight run.
export const openGround = (layout: Layout, x: number, z: number) => openAt(grid(outdoors(layout.seed)),x,z);
export const clearRun = (layout: Layout, from: {x: number; z: number}, to: {x: number; z: number}) => { const map = outdoors(layout.seed); return straight(map,grid(map),from,to); };
// Can it see from its eyes to an operator's chest? Blocked by the ground and
// by solids crossing the line (walls, ruins, wrecks, boulders, the building).
export function inSight(layout: Layout, from: Point3, to: Point3) {
  const map = outdoors(layout.seed), nav = grid(map), a = {x:from.x,y:from.y+2.1,z:from.z}, b = {x:to.x,y:to.y+1.2,z:to.z};
  const d = Math.hypot(b.x-a.x,b.z-a.z), steps = Math.ceil(d/0.5);
  for (let k=1;k<steps;k++) {
    const f = k/steps, x = a.x+(b.x-a.x)*f, z = a.z+(b.z-a.z)*f, y = a.y+(b.y-a.y)*f;
    if (d*f < 0.7 || d*(1-f) < 0.5) continue;
    if (groundAt(map,x,z) > y || !nav.index.clear(x,z,y-0.1,0.05)) return false;
  }
  return true;
}

interface Plan { path: Point3[]; goal?: {x: number; z: number}; replan: number; timer: number; cooldown: number; target?: number; seen?: {x: number; z: number}; aim?: {x: number; z: number}; left: number; hit: Set<number>; away?: {x: number; z: number}; last: Map<number,{x: number; z: number}> }
const plans = new WeakMap<Mission,Map<number,Plan>>();
function planOf(mission: Mission, id: number) {
  let all = plans.get(mission);
  if (!all) plans.set(mission,all = new Map());
  let plan = all.get(id);
  if (!plan) all.set(id,plan = {path:[],replan:0,timer:0,cooldown:0,left:0,hit:new Set(),last:new Map()});
  return plan;
}
const round = (v: number) => Math.round(v*100)/100;
const facing = (from: {x: number; z: number}, to: {x: number; z: number}) => Math.atan2(-(to.x-from.x),-(to.z-from.z));
const toward = (s: Stalker, yaw: number, rate: number) => { s.yaw = round(s.yaw+Math.max(-rate,Math.min(rate,Math.atan2(Math.sin(yaw-s.yaw),Math.cos(yaw-s.yaw))))); };

// Somewhere at least 50 m from everyone outside (or from the main door when
// nobody is), on open ground.
function spawnPoint(map: Outdoors, nav: Grid, away: {x: number; z: number}[], random: () => number) {
  let best: Point3 | undefined, far = -1;
  for (let t=0;t<120;t++) {
    const x = Math.round((random()*2-1)*(span-6)), z = Math.round((random()*2-1)*(span-6)), i = node(nav,x,z);
    if (i < 0 || !nav.linked[i]) continue;
    const d = Math.min(...away.map(p => Math.hypot(p.x-x,p.z-z)));
    if (d > far) { far = d; best = {x,y:nav.ground[i],z}; }
    if (d >= 50) break;
  }
  return best;
}

function stun(s: Stalker, plan: Plan, seconds: number, from?: {x: number; z: number}) {
  s.mode = 'stunned'; plan.timer = seconds; plan.path = []; plan.away = from;
}

// A baton swing: one within reach ahead is stunned, then backs off.
export function swatStalker(mission: Mission, p: Player) {
  for (const s of mission.stalkers ?? []) {
    const dx = s.x-p.x, dz = s.z-p.z, d = Math.hypot(dx,dz);
    if (d > batonReach.ahead+0.8 || (d > 0.5 && (-Math.sin(p.yaw)*dx-Math.cos(p.yaw)*dz)/d < 0.3)) continue;
    stun(s,planOf(mission,s.id),stunTime,p);
    return true;
  }
  return false;
}

// Walk along its path at `speed`, cutting corners where the way is clear.
function walk(map: Outdoors, nav: Grid, s: Stalker, plan: Plan, speed: number, dt: number) {
  while (plan.path.length > 1 && straight(map,nav,s,plan.path[1])) plan.path.shift();
  let left = speed*dt;
  const from = {x:s.x,z:s.z};
  while (left > 1e-6 && plan.path.length) {
    const to = plan.path[0], dx = to.x-s.x, dz = to.z-s.z, d = Math.hypot(dx,dz);
    if (d < 1e-3) { plan.path.shift(); continue; }
    const step = Math.min(left,d);
    s.x += dx/d*step; s.z += dz/d*step; left -= step;
    if (step >= d-1e-9) plan.path.shift();
  }
  s.y = groundAt(map,s.x,s.z);
  if (Math.hypot(s.x-from.x,s.z-from.z) > 1e-3) toward(s,facing(from,s),Math.PI*4*dt);
}

// Each tick. `threats`: lit flares (reach `flareFear`) and thrown things in
// flight, outside; `harm` hurts an operator.
export function stepStalkers(layout: Layout, state: Snapshot, mission: Mission, dt: number, random: () => number,
  threats: (Point3 & {reach: number})[], harm: (p: Player, damage: number) => void) {
  // Those knocked flat get up.
  if (mission.flat) {
    for (const f of mission.flat) f.seconds -= dt;
    mission.flat = mission.flat.filter(f => f.seconds > 0 && !gone(mission,f.id));
    if (!mission.flat.length) delete mission.flat;
  }
  const outside = state.players.filter(p => p.connected && placeOf(p) === 'outside' && !gone(mission,p.id));
  // The build-up.
  const clock = mission.clock ?? 0, wanted = Math.min(most,clock >= firstAfter ? 1+Math.floor((clock-firstAfter)/every) : 0)+(mission.enraged ? 1 : 0);
  const map = outdoors(layout.seed);
  if ((mission.stalkers?.length ?? 0) < wanted) {
    const nav = grid(map);
    while ((mission.stalkers?.length ?? 0) < wanted) {
      const at = spawnPoint(map,nav,outside.length ? outside : [map.exit],random);
      if (!at) break;
      (mission.stalkers ??= []).push({id:mission.stalkers.length+1,x:at.x,y:round(at.y),z:at.z,yaw:round(random()*Math.PI*2-Math.PI),mode:'roam'});
    }
  }
  if (!mission.stalkers?.length) return;
  const nav = grid(map), fast = mission.enraged ? enraged : 1;
  const flares = threats.filter(t => t.reach >= flareFear), flights = threats.filter(t => t.reach < flareFear);
  // Whom it watches (outside, up, not held by the Lurker) and whom it can
  // hit (not lying flat either).
  const watched = outside.filter(p => !mission.down.some(d => d.id === p.id) && !mission.lurkers?.some(l => l.grab === p.id));
  const prey = watched.filter(p => !mission.flat?.some(f => f.id === p.id));
  const lit = (p: Player) => state.lamp.owner === p.id && state.lamp.on && !state.lamp.stowed && !state.lamp.lost;
  for (const s of mission.stalkers) {
    const plan = planOf(mission,s.id);
    plan.timer -= dt; plan.cooldown -= dt; plan.replan -= dt;
    const moved = new Map(watched.map(p => { const last = plan.last.get(p.id); return [p.id,!!last && Math.hypot(last.x-p.x,last.z-p.z) > 0.01]; }));
    for (const p of state.players) plan.last.set(p.id,{x:p.x,z:p.z});
    const feet = (p: Player) => ({x:p.x,y:p.feetY ?? 0,z:p.z});
    // A thrown thing hitting it.
    const struck = flights.find(t => Math.hypot(t.x-s.x,t.z-s.z) < 1.2 && t.y > s.y-0.3 && t.y < s.y+2.8);
    if (struck && s.mode !== 'stunned') stun(s,plan,stunTime,struck);
    const flare = flares.find(f => Math.hypot(f.x-s.x,f.z-s.z) < flareKeep);
    const target = watched.find(p => p.id === plan.target), hittable = !!target && prey.includes(target);
    if (s.mode === 'stunned') {
      if (plan.timer <= 0) { s.mode = plan.away ? 'flee' : 'search'; plan.timer = plan.away ? 4 : 5; }
    } else if (s.mode === 'flee') {
      const from = plan.away ?? s, dx = s.x-from.x, dz = s.z-from.z, d = Math.hypot(dx,dz) || 1;
      plan.path = [{x:s.x+dx/d*3,y:0,z:s.z+dz/d*3}];
      if (openAt(nav,s.x+dx/d,s.z+dz/d)) walk(map,nav,s,plan,speeds.flee*fast,dt);
      if (plan.timer <= 0) { s.mode = 'roam'; plan.path = []; delete plan.away; }
    } else if (s.mode === 'windup') {
      if (!target || !hittable) { s.mode = 'stalk'; }
      else {
        toward(s,facing(s,target),Math.PI*3*dt);
        if (plan.timer <= 0) {
          // Off toward where they stand now, a few metres past.
          plan.aim = {x:target.x,z:target.z};
          plan.left = Math.min(Math.hypot(target.x-s.x,target.z-s.z)+5,chargeRange+6);
          plan.hit.clear();
          s.mode = 'charge'; s.yaw = round(facing(s,target));
        }
      }
    } else if (s.mode === 'charge') {
      const dx = -Math.sin(s.yaw), dz = -Math.cos(s.yaw);
      let left = Math.min(plan.left,chargeSpeed*fast*dt), ended = false;
      while (left > 1e-6 && !ended) {
        const step = Math.min(0.25,left), x = s.x+dx*step, z = s.z+dz*step, y = groundAt(map,x,z);
        if (!nav.index.clear(x,z,y,body)) { stun(s,plan,crashTime); ended = true; break; }
        if (!openAt(nav,x,z) || y-s.y > 0.6*step/0.25) { s.mode = 'recover'; plan.timer = 1.4; ended = true; break; }
        s.x = x; s.z = z; s.y = y; left -= step; plan.left -= step;
        for (const p of prey) {
          if (plan.hit.has(p.id) || Math.hypot(p.x-s.x,p.z-s.z) > hitReach || Math.abs((p.feetY ?? 0)-s.y) > 1.6) continue;
          plan.hit.add(p.id);
          harm(p,chargeDamage);
          if (!mission.down.some(d => d.id === p.id)) (mission.flat ??= []).push({id:p.id,seconds:flatTime});
          delete p.vy;
        }
      }
      if (!ended && plan.left <= 1e-6) { s.mode = 'recover'; plan.timer = 1.4; }
      // After a hit it gives its victim time to get up and run for cover.
      if (s.mode !== 'charge') { plan.cooldown = plan.hit.size ? afterHit : 2; plan.path = []; }
    } else if (s.mode === 'recover') {
      // It stumbles to a halt and wheels round toward whoever it was after.
      if (target) toward(s,facing(s,target),Math.PI*1.2*dt);
      if (plan.timer <= 0) { s.mode = target ? 'stalk' : 'search'; plan.timer = 5; }
    } else {
      // Roaming, stalking or searching: looking and listening.
      // The weather: fog shortens its sight, still air carries sound further.
      const air = weather[mapKind(layout.seed)];
      const range = (p: Player) => (lit(p) ? lampSight : sight)*(mission.enraged ? 1.25 : 1)*air.sight;
      const noticed = watched.filter(p => {
        const d = Math.hypot(p.x-s.x,p.z-s.z);
        return (d <= hearing*fast*carrying(layout.seed,mission.clock) && moved.get(p.id)) || (d <= range(p) && inSight(layout,s,feet(p)));
      }).sort((a,b) => Math.hypot(a.x-s.x,a.z-s.z)-Math.hypot(b.x-s.x,b.z-s.z));
      const seen = noticed.find(p => p.id === plan.target) ?? noticed[0];
      if (flare) { s.mode = 'flee'; plan.timer = 3; plan.away = flare; plan.path = []; }
      else if (seen) {
        if (s.mode !== 'stalk' || plan.target !== seen.id) plan.replan = 0;
        s.mode = 'stalk'; plan.target = seen.id; plan.seen = {x:seen.x,z:seen.z};
        const d = Math.hypot(seen.x-s.x,seen.z-s.z), ready = plan.cooldown <= 0 && prey.includes(seen);
        const guarded = flares.some(f => Math.hypot(f.x-seen.x,f.z-seen.z) < flareKeep);
        if (d < tooClose) {
          // Too close for a run-up: it backs off, watching them.
          const dx = s.x-seen.x, dz = s.z-seen.z, len = Math.hypot(dx,dz) || 1, yaw = s.yaw;
          plan.path = openAt(nav,s.x+dx/len*2,s.z+dz/len*2) ? [{x:s.x+dx/len*2,y:0,z:s.z+dz/len*2}] : [];
          walk(map,nav,s,plan,speeds.search*fast,dt);
          s.yaw = yaw; toward(s,facing(s,seen),Math.PI*3*dt); plan.path = [];
        } else if (d <= chargeRange && ready && !guarded && straight(map,nav,s,seen)) {
          s.mode = 'windup'; plan.timer = windup/fast; s.charges = (s.charges ?? 0)+1; plan.path = [];
        } else if ((guarded && d < flareKeep+2) || (!ready && d < holdOff)) {
          // Held off by a flare, or not ready to charge again: it waits, watching.
          plan.path = []; toward(s,facing(s,seen),Math.PI*2*dt);
        } else {
          if (plan.replan <= 0 || !plan.goal || Math.hypot(plan.goal.x-seen.x,plan.goal.z-seen.z) > 2) { plan.path = findPath(map,nav,s,seen); plan.goal = {x:seen.x,z:seen.z}; plan.replan = 1; }
          walk(map,nav,s,plan,speeds.stalk*fast,dt);
        }
      } else if (s.mode === 'stalk' && plan.seen) {
        // Lost sight: on to where it last saw them, then a look round.
        if (!plan.goal || plan.goal.x !== plan.seen.x || plan.goal.z !== plan.seen.z) { plan.path = findPath(map,nav,s,plan.seen); plan.goal = {...plan.seen}; }
        walk(map,nav,s,plan,speeds.stalk*fast,dt);
        if (!plan.path.length || Math.hypot(plan.seen.x-s.x,plan.seen.z-s.z) < 4) { s.mode = 'search'; plan.timer = 5; plan.path = []; }
      } else if (s.mode === 'search') {
        toward(s,s.yaw+1,Math.PI*0.6*dt);
        if (plan.timer <= 0) { s.mode = 'roam'; plan.path = []; delete plan.target; }
      } else {
        // Roaming, drifting toward whoever is outside.
        if (!plan.path.length && plan.replan <= 0) {
          plan.replan = 1.5;
          const near = outside.slice().sort((a,b) => Math.hypot(a.x-s.x,a.z-s.z)-Math.hypot(b.x-s.x,b.z-s.z))[0];
          for (let t=0;t<20;t++) {
            const base = near && random() < 0.6 ? {x:(near.x+s.x)/2,z:(near.z+s.z)/2} : s;
            const x = base.x+(random()*2-1)*20, z = base.z+(random()*2-1)*20, i = node(nav,x,z);
            if (i < 0 || !nav.linked[i]) continue;
            plan.path = findPath(map,nav,s,{x,z});
            break;
          }
        }
        walk(map,nav,s,plan,speeds.roam*fast,dt);
      }
    }
    s.x = round(s.x); s.z = round(s.z); s.y = round(s.y);
  }
}
