// The Lurker (see `Lurker` in mission.ts): one in each river's longest deep
// stretch, under the water from the moment the crew arrives. Host only. It
// never leaves the deep water, so the fords stay safe crossings. Its plans
// stay here, off the snapshot. Like `Simulation`, no Node-only APIs.
import type { Layout } from '../layout.ts';
import { batonReach, gone, type Lurker, type Mission } from '../mission.ts';
import { groundAt, outdoors, placeOf, type Outdoors } from '../places.ts';
import type { Player, Snapshot } from '../room.ts';
import type { Point3 } from '../room-templates.ts';
import { carrying } from '../map-kinds.ts';

// Metres per second along the river: patrolling, coming for a sound it hears
// now, and going to where it last heard one; faster once the bell has rung.
const speeds = {lurk:0.9,hunt:3.0,search:2.2};
// At the spot it last heard something, it waits `linger` seconds facing the
// sound before patrolling on.
export const linger = 4;
// It hears someone moving within `hearMoving` m, someone still within
// `hearStill`; it grabs within `grabReach` m (from under the water, so up to
// `grabHeight` above it: a low bridge is not safe); it drags its victim at
// `dragSpeed`, a quarter of that while they struggle; after letting go it
// stays down `sinkTime` seconds.
// Hunting, it comes across the river toward where it heard someone, up to
// `edge` metres from the centre line: through water down to `shallowest`
// deep, then up to `ashore` metres out onto a bank no more than `climb` above
// the water. Nobody within `fordSafe` of a ford's middle is grabbed.
// Holding someone, it backs toward the middle of the channel at `retreat`,
// so a victim has some seconds before the deep water closes over them.
export const hearMoving = 16, hearStill = 6, grabReach = 9, grabHeight = 5, dragSpeed = 1.1, retreat = 0.8, sinkTime = 15, grabDamage = 10, flareFear = 4, edge = 10, shallowest = 0.6, ashore = 3, climb = 2, fordSafe = 9;
const enraged = 1.4, depthNeeded = 2;

// `heard`: where it last heard someone, until it has been there and waited;
// `dir`: the way along the river it patrols (+1 or -1); `paused`: waiting
// at the end of a patrol leg.
interface Plan { s: number; target: number; offset: number; across: number; until: number; struggle: number; dir: number; paused: boolean; heard?: {x: number; z: number; wait: number; now: boolean}; at?: {x: number; z: number}; grabbedAt?: Point3; last: Map<number,{x: number; z: number}> }
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
// surface, and the way across the river there (`nx`, `nz`), blended between
// points so a Lurker off the centre line moves smoothly round bends.
function at(map: Outdoors, s: number) {
  const p = map.water.points, i = Math.max(0,Math.min(p.length-2,Math.floor(s))), f = Math.max(0,Math.min(1,s-i)), a = p[i], b = p[i+1];
  const along = (k: number) => { const u = p[Math.max(0,k-1)], v = p[Math.min(p.length-1,k+1)], len = Math.hypot(v.x-u.x,v.z-u.z) || 1; return {x:(v.x-u.x)/len,z:(v.z-u.z)/len}; };
  const ta = along(i), tb = along(i+1), tx = ta.x+(tb.x-ta.x)*f, tz = ta.z+(tb.z-ta.z)*f, len = Math.hypot(tx,tz) || 1;
  return {x:a.x+(b.x-a.x)*f,z:a.z+(b.z-a.z)*f,level:a.level+(b.level-a.level)*f,nx:-tz/len,nz:tx/len};
}
// How far across the river, toward `side`, it can come at the point `q`:
// through water at least `shallowest` deep (out from the deep middle), then
// up to `ashore` metres up a bank no higher than `climb` above the water.
function reach(map: Outdoors, q: ReturnType<typeof at>, side: number) {
  let wet = 0;
  for (let d=0.25;d<=edge;d+=0.25) {
    const x = q.x+q.nx*d*side, z = q.z+q.nz*d*side, depth = q.level-groundAt(map,x,z);
    if (depth >= shallowest) { wet = d; continue; }
    if (d-wet > ashore || -depth > climb) return d-0.25;
  }
  return edge;
}
// The yaw that faces from (x, z) toward (tx, tz).
const facing = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx-x),-(tz-z));
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
  if (!plan) all.set(id,plan = {s,target:s,offset:0,across:0,until:0,struggle:0,dir:1,paused:false,last:new Map()});
  return plan;
}

// The stretch of river a Lurker keeps to (for tests): indices into the
// water's points.
export const lurkerStretch = (seed: number) => stretch(outdoors(seed));

// One Lurker, in the middle of the river's longest deep stretch.
export function spawnLurkers(layout: Layout): Lurker[] {
  const map = outdoors(layout.seed), range = stretch(map);
  if (range.hi-range.lo < 6) return [];
  const s = (range.lo+range.hi)/2, q = at(map,s), r = at(map,s+1);
  return [{id:1,x:q.x,y:q.level-0.7,z:q.z,yaw:Math.round(facing(q.x,q.z,r.x,r.z)*100)/100,mode:'lurk'}];
}

// It lets go: the victim scrambles back to where they were grabbed, and it
// sinks away for `sinkTime` seconds.
function release(mission: Mission, state: Snapshot, l: Lurker) {
  const plan = plans.get(mission)?.get(l.id), victim = state.players.find(p => p.id === l.grab);
  if (victim && plan?.grabbedAt && !gone(mission,victim.id)) { Object.assign(victim,{x:plan.grabbedAt.x,z:plan.grabbedAt.z,feetY:plan.grabbedAt.y,vy:0}); mission.drowning = mission.drowning?.filter(d => d.id !== victim.id); }
  delete l.grab;
  l.mode = 'sunk';
  if (plan) { plan.until = sinkTime; plan.target = plan.s; delete plan.grabbedAt; delete plan.heard; }
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
      if (plan.until <= 0) { l.mode = 'lurk'; plan.paused = false; }
    } else if (threats.some(t => t.reach >= flareFear && near(l,t))) {
      // A lit flare at the water's edge drives it down.
      l.mode = 'sunk'; plan.until = sinkTime/2; plan.target = plan.s; delete plan.heard;
    } else {
      const heard = prey.filter(p => Math.hypot(p.x-l.x,p.z-l.z) <= (moved.get(p.id) ? hearMoving : hearStill)*(mission.enraged ? 1.5 : 1)*carrying(layout.seed,mission.clock))
        .sort((a,b) => Math.hypot(a.x-l.x,a.z-l.z)-Math.hypot(b.x-l.x,b.z-l.z))[0];
      const level = at(map,plan.s).level;
      const caught = heard && Math.hypot(heard.x-l.x,heard.z-l.z) <= grabReach && (heard.feetY ?? 0)-level <= grabHeight
        && !map.water.fords.some(f => Math.hypot(heard.x-f.x,heard.z-f.z) < fordSafe);
      if (caught) {
        l.mode = 'grab'; l.grab = heard.id; l.grabs = (l.grabs ?? 0)+1;
        plan.grabbedAt = {x:heard.x,y:heard.feetY ?? 0,z:heard.z};
        plan.target = plan.s; delete plan.heard;
        delete heard.vy;
        bite(heard,grabDamage);
        continue;
      }
      if (heard) {
        // Off toward the sound, and on toward where it was heard last once it
        // stops; the way it goes becomes the way it patrols on afterwards.
        l.mode = 'hunt';
        plan.heard = {x:heard.x,z:heard.z,wait:linger,now:true};
        plan.target = nearest(map,range,heard.x,heard.z);
        if (Math.abs(plan.target-plan.s) > 0.05) plan.dir = Math.sign(plan.target-plan.s);
        const c = at(map,plan.target);
        plan.across = (heard.x-c.x)*c.nx+(heard.z-c.z)*c.nz;
      } else if (plan.heard) {
        l.mode = 'hunt'; plan.heard.now = false;
        if (Math.abs(plan.target-plan.s) < 0.05 && (plan.heard.wait -= dt) <= 0) { delete plan.heard; l.mode = 'lurk'; plan.paused = true; plan.until = 0; }
      } else {
        // Patrolling: legs of about 6-14 m along the river, the same way as
        // before, a short pause between, turning back at the ends.
        l.mode = 'lurk';
        if (Math.abs(plan.target-plan.s) < 0.05) {
          if (!plan.paused) { plan.paused = true; plan.until = 1+random()*3; }
          else if (plan.until <= 0) {
            plan.paused = false;
            let next = plan.s+plan.dir*(3+random()*4);
            if (next > range.hi || next < range.lo) { plan.dir = -plan.dir; next = plan.s+plan.dir*(3+random()*4); }
            plan.target = Math.max(range.lo,Math.min(range.hi,next));
          }
        }
      }
    }
    // Along the river toward its target, sunk ones deeper and slower.
    const speed = (l.mode === 'hunt' ? (plan.heard?.now ? speeds.hunt : speeds.search) : speeds.lurk)*fast*(l.mode === 'sunk' ? 0.5 : 1);
    const here = at(map,plan.s), ahead = at(map,plan.s+(plan.target >= plan.s ? 0.5 : -0.5)), metres = Math.hypot(ahead.x-here.x,ahead.z-here.z)*2 || 2;
    const ds = Math.sign(plan.target-plan.s)*Math.min(Math.abs(plan.target-plan.s),speed*dt/metres);
    plan.s = Math.max(range.lo,Math.min(range.hi,plan.s+ds));
    const q = at(map,plan.s);
    // Across the river toward where it heard someone while hunting (as far
    // as `reach` lets it), back to the middle otherwise.
    const want = l.mode === 'hunt' ? Math.sign(plan.across)*Math.min(Math.abs(plan.across),reach(map,q,Math.sign(plan.across))) : 0;
    const shift = (l.mode === 'grab' ? retreat : l.mode === 'sunk' ? 4 : 2)*dt;
    plan.offset += Math.max(-shift,Math.min(shift,want-plan.offset));
    const x = q.x+q.nx*plan.offset, z = q.z+q.nz*plan.offset;
    // It faces the way it moves; still, it faces whoever it holds or the
    // sound it came for, and otherwise keeps its heading.
    const victim = l.mode === 'grab' ? state.players.find(p => p.id === l.grab) : undefined;
    const was = plan.at ?? {x:l.x,z:l.z};
    plan.at = {x,z};
    if (victim) l.yaw = facing(x,z,victim.x,victim.z);
    else if (Math.hypot(x-was.x,z-was.z) > 0.004) l.yaw = facing(was.x,was.z,x,z);
    else if (plan.heard) l.yaw = facing(x,z,plan.heard.x,plan.heard.z);
    l.yaw = Math.round(l.yaw*100)/100;
    l.x = Math.round(x*100)/100; l.z = Math.round(z*100)/100;
    // Under the surface, or lying on the bank where it has hauled itself out.
    const ground = groundAt(map,x,z);
    l.y = Math.round((l.mode === 'sunk' ? q.level-1.6 : Math.max(ground+0.25,q.level-(l.mode === 'lurk' ? 0.7 : 0.45)))*100)/100;
  }
}
