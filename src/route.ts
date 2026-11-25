import { collisionIndex, geometryFor, playerRadius } from './layout.ts';
import type { Geometry, Layout } from './layout.ts';
import { climbable, planningGrade, surfaceHeight } from './room-templates.ts';
import type { Point3 } from './room-templates.ts';

// Plan a walk between two floor points with bulkheads treated as open. The
// route follows a 0.5 m lattice, so it reduces to axis-aligned legs that
// keyboard tests can walk one axis at a time. It keeps the widest clearance
// that still reaches the goal: 0.85 m holds the centre line of every doorway
// and corridor and absorbs a laggy walker overshooting a corner.
// With `near`, any point on the goal's storey within that distance will do,
// so a tight goal does not force a tight route all the way there.
// It walks a facility layout, or any place's geometry (home, outdoors).
export function route(layout: Layout | Geometry, from: Point3, to: Point3, margins = [0.85,0.65,0.45,0.25,0], near = 0): Point3[] | undefined {
  for (const margin of margins) {
    const legs = plan(layout,from,to,margin,near);
    if (legs) return legs;
  }
}

const directions = [[1,0],[-1,0],[0,1],[0,-1]];

// Dijkstra over lattice points and headings; each turn costs as much as 3 m
// of walking, so routes keep long straight legs.
function plan(layout: Layout | Geometry, from: Point3, to: Point3, margin: number, near: number): Point3[] | undefined {
  const g = 'rooms' in layout ? geometryFor(layout) : layout, step = 0.5, turn = 6;
  const index = collisionIndex(g,g.doors.map(d => d.id),playerRadius+margin+0.05);
  // Keep a margin from floor edges too. Beside the heading the floor must stay
  // within one step, so a walker that drifts sideways off the line cannot end
  // up on the open side of a ramp; ahead and behind, the probes may climb.
  // Rolling ground has no floor edges to drift off, so it needs no probes.
  const edge = playerRadius+margin*0.6;
  const open = (x: number, z: number, feet: number, heading: number, field: boolean) => index.clear(x,z,feet,playerRadius+margin) &&
    (field || directions.every(([dx,dz],side) => index.surface(x+dx*edge,z+dz*edge,feet,(side >> 1) === (heading >> 1) ? 0.32+edge*0.6 : 0.32)));
  const key = (ix: number, iz: number, feet: number) => ((ix+4096)*8192+iz+4096)*128+Math.round(feet*4);
  interface Node { ix: number; iz: number; feet: number; heading: number; cost: number; slope: number; previous?: Node }
  // Ramps and stairs are entered and left along their slope (0 = x, 1 = z).
  const slopeOf = (s: {rise?: number; along?: 'x'}) => s.rise ? (s.along ? 0 : 1) : -1;
  const best = new Map<number,number>();
  const heap: Node[] = [];
  const push = (n: Node) => {
    heap.push(n);
    for (let i=heap.length-1; i>0;) {
      const parent = (i-1) >> 1;
      if (heap[parent].cost <= heap[i].cost) break;
      [heap[parent],heap[i]] = [heap[i],heap[parent]]; i = parent;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i=0;;) {
        const l = 2*i+1, r = l+1;
        let m = i;
        if (l < heap.length && heap[l].cost < heap[m].cost) m = l;
        if (r < heap.length && heap[r].cost < heap[m].cost) m = r;
        if (m === i) break;
        [heap[m],heap[i]] = [heap[i],heap[m]]; i = m;
      }
    }
    return top;
  };
  const goal = key(Math.round(to.x/step),Math.round(to.z/step),to.y);
  push({ix:Math.round(from.x/step),iz:Math.round(from.z/step),feet:from.y,heading:-1,cost:0,slope:-1});
  while (heap.length) {
    const n = pop();
    const here = key(n.ix,n.iz,n.feet);
    if ((best.get(here*4+n.heading+1) ?? Infinity) < n.cost) continue;
    // The goal's own lattice point, within a step of its height (uneven ground
    // may put the lattice a little above or below it).
    if (here === goal || (n.ix === Math.round(to.x/step) && n.iz === Math.round(to.z/step) && Math.abs(n.feet-to.y) < 0.6) || (near > 0 && Math.abs(n.feet-to.y) < 1 && Math.hypot(n.ix*step-to.x,n.iz*step-to.z) <= near)) {
      const path: Point3[] = [];
      for (let at: Node | undefined = n; at; at = at.previous) path.unshift({x:at.ix*step,y:at.feet,z:at.iz*step});
      // Keep only the corners of each straight run.
      return path.filter((p,k) => k === 0 || k === path.length-1 ||
        !((path[k-1].x === p.x && p.x === path[k+1].x) || (path[k-1].z === p.z && p.z === path[k+1].z)));
    }
    directions.forEach(([dx,dz],heading) => {
      const x = (n.ix+dx)*step, z = (n.iz+dz)*step;
      const s = index.surface(x,z,n.feet);
      if (!s) return;
      const feet = surfaceHeight(s,x,z), slope = slopeOf(s);
      if ((slope >= 0 && slope !== heading >> 1) || (n.slope >= 0 && n.slope !== heading >> 1) || !climbable(s,n.feet,feet,x,z,planningGrade) || !climbable(s,n.feet,feet,x-dx*step/2,z-dz*step/2,planningGrade)) return;
      // On rolling ground, keep 0.3 m either side gentle too, for a walker that strays.
      if (s.field && [-0.3,0.3].some(side => !climbable(s,n.feet,feet+1,x+dz*side,z+dx*side,planningGrade))) return;
      const cost = n.cost+1+(n.heading >= 0 && n.heading !== heading ? turn : 0);
      const id = key(n.ix+dx,n.iz+dz,feet)*4+heading+1;
      if (cost >= (best.get(id) ?? Infinity) || !open(x,z,feet,heading,!!s.field)) return;
      best.set(id,cost);
      push({ix:n.ix+dx,iz:n.iz+dz,feet,heading,cost,slope,previous:n});
    });
  }
}
