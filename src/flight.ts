import type { Geometry } from './layout.ts';
import { surfaceBottom, surfaceContains, surfaceHeight } from './room-templates.ts';
import type { Point3, Solid } from './room-templates.ts';

// Thrown items fly on the same collision geometry the operators walk on. The
// host simulates a throw once, in fixed steps, when it is launched; every
// client replays the same launch through the same steps and draws the same
// arc. Only + − × ÷ and comparisons run inside the loop, never trigonometry,
// so every browser computes identical numbers from identical launches.

// Where a throw starts (the item's centre) and how fast it leaves the hand.
export interface Launch { x: number; y: number; z: number; vx: number; vy: number; vz: number }
// A throw in progress: its launch, seconds flown (`t`), and its length (`d`).
// `cut`: the flight struck something (the Bell Diver) this many seconds in,
// and the item falls from there to its rest spot for the remaining time.
export interface Flight extends Launch { t: number; d: number; cut?: number }
// Half the item's width and half its height.
export interface Body { r: number; h: number }
export interface Path { points: number[]; rest: Point3; duration: number }

export const flightStep = 1/120;
export const gravity = 12;
const maxFlight = 8;
const friction = 6, rolling = 2.5;
const cell = 2;

type Box = Solid & { prop?: boolean };
// Solids and floors bucketed on a 2 m grid, so each step checks only nearby ones.
class Space {
  private solids = new Map<string,Box[]>();
  private floors = new Map<string,Geometry['surfaces']>();
  constructor(g: Geometry, opened: readonly string[]) {
    const boxes: Box[] = [...g.walls,...g.rails,...g.roofs,...g.doors.filter(d => !opened.includes(d.id)),...g.props.map(p => ({...p,prop:true}))];
    for (const b of boxes) this.bucket(this.solids,b,b,0.3);
    for (const s of g.surfaces) this.bucket(this.floors,s,s,0);
  }
  private bucket<V>(map: Map<string,V[]>, value: V, area: {x: number; z: number; w: number; d: number}, margin: number) {
    for (let i=Math.floor((area.x-area.w/2-margin)/cell); i<=Math.floor((area.x+area.w/2+margin)/cell); i++) {
      for (let k=Math.floor((area.z-area.d/2-margin)/cell); k<=Math.floor((area.z+area.d/2+margin)/cell); k++) {
        const key = i+','+k, list = map.get(key);
        if (list) list.push(value); else map.set(key,[value]);
      }
    }
  }
  private near<V>(map: Map<string,V[]>, x: number, z: number) { return map.get(Math.floor(x/cell)+','+Math.floor(z/cell)) ?? []; }
  // The solid the body would overlap at this centre, if any.
  hit(x: number, y: number, z: number, b: Body) {
    for (const s of this.near(this.solids,x,z)) {
      // A micrometre of slack, so an item resting on a prop isn't inside it.
      if (Math.abs(x-s.x) < s.w/2+b.r && Math.abs(z-s.z) < s.d/2+b.r && y-b.h < s.y+s.h-1e-6 && y+b.h > s.y+1e-6) return s;
    }
  }
  // The highest floor or prop top under this point, within a step of `bottom`.
  floor(x: number, z: number, bottom: number) {
    let best: {y: number; prop?: Box; ground?: Geometry['surfaces'][number]} | undefined;
    for (const s of this.near(this.floors,x,z)) {
      if (!surfaceContains(s,x,z)) continue;
      const y = surfaceHeight(s,x,z);
      if (y <= bottom+0.25 && (!best || y > best.y)) best = {y,ground:s.field ? s : undefined};
    }
    for (const s of this.near(this.solids,x,z)) {
      if (!s.prop || Math.abs(x-s.x) > s.w/2 || Math.abs(z-s.z) > s.d/2) continue;
      const y = s.y+s.h;
      if (y <= bottom+0.25 && (!best || y > best.y)) best = {y,prop:s};
    }
    return best;
  }
  // Floors, stairs and ramps are solid from their walking surface down to
  // the slab under their lowest end. Moving into one from the side, more
  // than a step below its surface, is blocked; sliding up a gentle rise is not.
  wedge(x: number, z: number, bottom: number, top: number) {
    for (const s of this.near(this.floors,x,z)) {
      if (!surfaceContains(s,x,z)) continue;
      if (surfaceHeight(s,x,z) > bottom+0.25 && top > surfaceBottom(s,x,z)) return true;
    }
    return false;
  }
  // A floor slab whose underside the body's top crosses while rising.
  ceiling(x: number, z: number, from: number, to: number) {
    return this.near(this.floors,x,z).some(s => {
      if (s.rise || s.field || !surfaceContains(s,x,z)) return false;
      const underside = surfaceBottom(s,x,z);
      return from <= underside && to > underside;
    });
  }
}

const spaces = new WeakMap<Geometry,{key: string; space: Space}>();
function spaceFor(g: Geometry, opened: readonly string[]) {
  const key = [...opened].sort().join('|'), cached = spaces.get(g);
  if (cached?.key === key) return cached.space;
  const space = new Space(g,opened);
  spaces.set(g,{key,space});
  return space;
}

// Where a throw starts: ahead of the chest, pulled back toward the operator
// until the item is clear of walls. `fx`, `fz` and `up` are the aim direction.
export function launchFrom(g: Geometry, opened: readonly string[], p: {x: number; z: number; feetY?: number}, aim: {fx: number; fz: number; up: number; speed: number}, b: Body): Launch {
  const space = spaceFor(g,opened), y = (p.feetY ?? 0)+1.3;
  let x = p.x, z = p.z;
  for (const reach of [0.35,0.25,0.15,0.05]) {
    if (!space.hit(p.x+aim.fx*reach,y,p.z+aim.fz*reach,b)) { x = p.x+aim.fx*reach; z = p.z+aim.fz*reach; break; }
  }
  const level = Math.sqrt(Math.max(0,1-aim.up*aim.up));
  // A little lift makes a level throw carry instead of dropping at once.
  return {x,y,z,vx:aim.fx*level*aim.speed,vy:aim.up*aim.speed+1.2,vz:aim.fz*level*aim.speed};
}

const paths = new WeakMap<Geometry,Map<string,Path>>();
// The whole flight, sampled every step, and where the item comes to rest.
// `fallback` is used if the item never settles on a floor.
export function trajectory(g: Geometry, opened: readonly string[], start: Launch, b: Body, fallback: Point3): Path {
  const memo = [start.x,start.y,start.z,start.vx,start.vy,start.vz,b.r,b.h,opened.length].join();
  let known = paths.get(g);
  if (!known) paths.set(g,known = new Map());
  const found = known.get(memo);
  if (found) return found;
  const space = spaceFor(g,opened), dt = flightStep;
  let {x,y,z,vx,vy,vz} = start;
  const points = [x,y,z];
  // The last floor the item passed over, in case it never settles.
  let rest: Point3 | undefined, pushes = 0, last: Point3 | undefined, aloft = true;
  // Outdoors the wind pushes it while it flies (not once it is down).
  const wind = g.wind;
  for (let n=0; n*dt<maxFlight; n++) {
    vy -= gravity*dt;
    if (wind && aloft) { vx += wind.x*dt; vz += wind.z*dt; }
    // Walls, props, rails and closed bulkheads: bounce back, losing speed.
    const nx = x+vx*dt;
    if (space.hit(nx,y,z,b) || space.wedge(nx,z,y-b.h,y+b.h)) { vx = -vx*0.3; vz *= 0.8; } else x = nx;
    const nz = z+vz*dt;
    if (space.hit(x,y,nz,b) || space.wedge(x,nz,y-b.h,y+b.h)) { vz = -vz*0.3; vx *= 0.8; } else z = nz;
    const ny = y+vy*dt;
    let grounded = false, support: ReturnType<Space['floor']>;
    if (vy > 0) {
      if (space.hit(x,ny,z,b) || space.ceiling(x,z,y+b.h,ny+b.h)) vy = -vy*0.2; else y = ny;
    } else {
      support = space.floor(x,z,y-b.h);
      if (support && !support.prop && !space.hit(x,support.y+b.h,z,b)) last = {x,y:support.y,z};
      const blocker = space.hit(x,ny,z,b);
      if (support && ny-b.h <= support.y) {
        y = support.y+b.h;
        vy = vy < -2.5 ? -vy*0.25 : 0;
        grounded = vy === 0;
      } else if (blocker && !blocker.prop) {
        // Landing on a wall top or a rail: tip off its nearer side.
        const ax = (x-blocker.x)/(blocker.w/2+b.r), az = (z-blocker.z)/(blocker.d/2+b.r);
        if (Math.abs(ax) >= Math.abs(az)) vx = ax < 0 ? -1.2 : 1.2; else vz = az < 0 ? -1.2 : 1.2;
        vy = 0;
      } else if (blocker) {
        // Clipping a prop's edge: slide off it, away from its middle.
        const ax = (x-blocker.x)/(blocker.w/2), az = (z-blocker.z)/(blocker.d/2);
        if (Math.abs(ax) >= Math.abs(az)) vx = ax < 0 ? -1.2 : 1.2; else vz = az < 0 ? -1.2 : 1.2;
        vy = 0;
      } else y = ny;
    }
    // On rolling ground, an item rolls downhill and rolls on further than it
    // would slide on a floor; it rests only where the ground is near level.
    const hill = grounded ? support?.ground : undefined;
    let level = true;
    if (hill) {
      const gx = (surfaceHeight(hill,x+0.25,z)-surfaceHeight(hill,x-0.25,z))*2, gz = (surfaceHeight(hill,x,z+0.25)-surfaceHeight(hill,x,z-0.25))*2;
      const k = gravity/(1+gx*gx+gz*gz);
      vx -= gx*k*dt; vz -= gz*k*dt;
      // Where the pull downhill is weaker than rolling friction, it stops.
      level = gx*gx+gz*gz < 0.045;
    }
    if (grounded) {
      const speed = Math.sqrt(vx*vx+vz*vz), slowed = Math.max(0,speed-(hill ? rolling : friction)*dt);
      if (speed > 0) { vx *= slowed/speed; vz *= slowed/speed; }
      if (slowed < 0.05 && level) {
        // Items never stay on a prop: they slide off its nearest edge, so
        // they always end up on a floor within reach.
        // Each push is just strong enough to clear the edge; if a wall
        // blocks that side, the next push tries the next-nearest edge.
        if (support?.prop && pushes < 8) {
          const s = support.prop, dx = x-s.x, dz = z-s.z;
          const edges = [
            {d:s.w/2-dx,x:1,z:0},{d:s.w/2+dx,x:-1,z:0},{d:s.d/2-dz,x:0,z:1},{d:s.d/2+dz,x:0,z:-1},
          ].sort((a,b) => a.d-b.d);
          const edge = edges[pushes % 4], speed = Math.sqrt(2*friction*(edge.d+b.r+0.1));
          vx = edge.x*speed; vz = edge.z*speed;
          pushes++;
        } else if (support && !support.prop) { rest = {x,y:support.y,z}; points.push(x,y,z); break; }
      }
    }
    aloft = !grounded;
    points.push(x,y,z);
    // Down a bottomless pit: it ends out of sight, where it fell.
    if (y < -20) { rest = {x,y,z}; break; }
  }
  if (!rest) {
    const under = space.floor(x,z,y-b.h);
    rest = under && !under.prop && !space.hit(x,under.y+b.h,z,b) ? {x,y:under.y,z} : last ?? fallback;
  }
  const path = {points,rest,duration:(points.length/3-1)*dt};
  if (known.size > 64) known.clear();
  known.set(memo,path);
  return path;
}

// The item's centre `t` seconds into its flight.
export function positionAt(path: Path, t: number): Point3 {
  const n = path.points.length/3-1, f = Math.max(0,Math.min(n,t/flightStep)), i = Math.min(n-1,Math.floor(f)), a = f-i;
  if (n <= 0) return {x:path.points[0],y:path.points[1],z:path.points[2]};
  const p = path.points;
  return {x:p[i*3]+(p[i*3+3]-p[i*3])*a,y:p[i*3+1]+(p[i*3+4]-p[i*3+1])*a,z:p[i*3+2]+(p[i*3+5]-p[i*3+2])*a};
}
