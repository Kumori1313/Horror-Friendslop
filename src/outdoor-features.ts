// Landmarks of the outdoor map, grown from the expedition seed: a dry
// riverbed with a few fords, ruined shells, wrecked machinery, and worn trails
// from the arrival to the building's doors. Pure functions of the seed and
// the ground, so every client builds the same map. Like `places.ts`, no
// Node-only APIs.
import { climbable, fieldGrade, fieldHeight, planningGrade, type Heightfield, type Surface } from './room-templates.ts';

const smooth = (t: number) => { const c = Math.max(0,Math.min(1,t)); return c*c*(3-2*c); };
type Rng = () => number;
type Area = {x: number; z: number; r: number};

// The riverbed: a meandering centre line across the map. `t` runs along it.
export interface River { points: {x: number; z: number; t: number}[]; fords: {x: number; z: number; t: number}[] }
export const riverDepth = 2.6, riverFloor = 3.2;

export function riverCourse(next: Rng, half: number, keep: Area[]): River | undefined {
  for (let tries=0;tries<12;tries++) {
    const angle = next()*Math.PI, dx = Math.cos(angle), dz = Math.sin(angle), nx = -dz, nz = dx;
    const offset = (next() < 0.5 ? -1 : 1)*(36+next()*14), amp = 6+next()*6, wave = 50+next()*30, phase = next()*Math.PI*2, phase2 = next()*Math.PI*2;
    const points: River['points'] = [];
    for (let t=-half-12;t<=half+12;t+=2) {
      const side = offset+amp*Math.sin(t/wave*Math.PI*2+phase)+amp*0.4*Math.sin(t/(wave*0.43)*Math.PI*2+phase2);
      points.push({x:dx*t+nx*side,z:dz*t+nz*side,t});
    }
    if (keep.some(k => points.some(p => Math.hypot(p.x-k.x,p.z-k.z) < k.r))) continue;
    // Two or three fords, spread along the stretch well inside the map.
    const inner = points.filter(p => Math.max(Math.abs(p.x),Math.abs(p.z)) < half-26);
    if (inner.length < 12) continue;
    const count = next() < 0.5 ? 2 : 3, lo = inner[0].t, hi = inner.at(-1)!.t, fords: River['fords'] = [];
    for (let i=0;i<count;i++) {
      const t = lo+(i+0.5)*(hi-lo)/count+(next()-0.5)*(hi-lo)/count*0.6;
      const p = inner.reduce((a,b) => Math.abs(b.t-t) < Math.abs(a.t-t) ? b : a);
      fords.push({x:p.x,z:p.z,t:p.t});
    }
    return {points,fords};
  }
}

// How far below the ground the riverbed cuts at (x, z): a level floor
// between banks too steep to climb, which widen into gentle slopes at a ford.
export function riverCut(river: River, x: number, z: number) {
  let best = Infinity, along = 0;
  const p = river.points;
  for (let i=1;i<p.length;i++) {
    const ax = p[i-1].x, az = p[i-1].z, sx = p[i].x-ax, sz = p[i].z-az, len = sx*sx+sz*sz;
    const u = Math.max(0,Math.min(1,((x-ax)*sx+(z-az)*sz)/len)), qx = ax+sx*u-x, qz = az+sz*u-z, d = qx*qx+qz*qz;
    if (d < best) { best = d; along = p[i-1].t+(p[i].t-p[i-1].t)*u; }
  }
  const d = Math.sqrt(best);
  if (d > riverFloor+9) return 0;
  const ford = Math.max(0,...river.fords.map(f => smooth(1-Math.abs(along-f.t)/9)));
  // Banks 2.5 m wide: far too steep to climb, but wide enough for the 1 m
  // height map to draw without a sawtooth edge.
  const bank = 2.5+6*ford;
  return riverDepth*(d <= riverFloor ? 1 : smooth(1-(d-riverFloor)/bank));
}

// Ground gentle enough to build on, a margin clear of anything steep.
function gentle(f: Heightfield, x: number, z: number, w: number, d: number, margin: number, limit: number) {
  for (let px=x-w/2-margin;px<=x+w/2+margin;px+=0.5) for (let pz=z-d/2-margin;pz<=z+d/2+margin;pz+=0.5) if (fieldGrade(f,px,pz) > limit*limit) return false;
  return true;
}
const lowest = (f: Heightfield, x: number, z: number, w: number, d: number) =>
  Math.min(fieldHeight(f,x-w/2,z-d/2),fieldHeight(f,x+w/2,z-d/2),fieldHeight(f,x-w/2,z+d/2),fieldHeight(f,x+w/2,z+d/2),fieldHeight(f,x,z));
const highest = (f: Heightfield, x: number, z: number, w: number, d: number) =>
  Math.max(fieldHeight(f,x-w/2,z-d/2),fieldHeight(f,x+w/2,z-d/2),fieldHeight(f,x-w/2,z+d/2),fieldHeight(f,x+w/2,z+d/2),fieldHeight(f,x,z));

// A box standing on the ground: `y` is its foot, sunk a little below the
// lowest ground under it, and `h` reaches `tall` above the highest.
export interface Block { x: number; z: number; w: number; d: number; y: number; h: number }
const block = (f: Heightfield, x: number, z: number, w: number, d: number, tall: number): Block => {
  const y = lowest(f,x,z,w,d)-0.3;
  return {x,z,w,d,y,h:highest(f,x,z,w,d)+tall-y};
};

// Ruins: the broken walls of a roofless shell, gaps and a doorway in them,
// at heights from knee to over the head, with rubble about.
export interface Ruin { x: number; z: number; w: number; d: number; pieces: Block[]; rubble: Block[] }
export function placeRuins(next: Rng, f: Heightfield, half: number, clear: (x: number, z: number, r: number) => boolean, claim: (x: number, z: number, r: number) => void): Ruin[] {
  const ruins: Ruin[] = [], want = 4+Math.floor(next()*3);
  for (let tries=0;tries<500 && ruins.length < want;tries++) {
    const w = 8+Math.round(next()*3), d = 6+Math.round(next()*2), x = (next()-0.5)*(2*half-36), z = (next()-0.5)*(2*half-36);
    if (!clear(x,z,Math.hypot(w,d)/2+2.5) || !gentle(f,x,z,w,d,2,0.45)) continue;
    const pieces: Block[] = [], door = Math.floor(next()*4);
    const sides = [[x-w/2,z-d/2,x+w/2,z-d/2],[x+w/2,z-d/2,x+w/2,z+d/2],[x+w/2,z+d/2,x-w/2,z+d/2],[x-w/2,z+d/2,x-w/2,z-d/2]];
    sides.forEach(([x0,z0,x1,z1],side) => {
      const len = Math.hypot(x1-x0,z1-z0), segments = Math.round(len/2);
      for (let s=0;s<segments;s++) {
        if ((side === door && s === Math.floor(segments/2)) || next() > 0.68) continue;
        const a = s/segments, b = (s+1)/segments, cx = x0+(x1-x0)*(a+b)/2, cz = z0+(z1-z0)*(a+b)/2;
        const along = Math.abs(x1-x0) > Math.abs(z1-z0), corner = s === 0 || s === segments-1;
        pieces.push(block(f,cx,cz,along ? len/segments : 0.45,along ? 0.45 : len/segments,(corner ? 1.8 : 0.9)+next()*(corner ? 1.6 : 1.8)));
      }
    });
    const rubble: Block[] = [];
    for (let r=0;r<4;r++) {
      const rx = x+(next()-0.5)*(w+4), rz = z+(next()-0.5)*(d+4), s = 0.5+next()*0.5;
      if (pieces.some(p => Math.abs(p.x-rx) < p.w/2+s && Math.abs(p.z-rz) < p.d/2+s)) continue;
      rubble.push(block(f,rx,rz,s,s*0.8,0.3+next()*0.4));
    }
    ruins.push({x,z,w,d,pieces,rubble});
    claim(x,z,Math.hypot(w,d)/2+2.5);
  }
  return ruins;
}

// Wrecked machinery and debris, square to the map so it collides as boxes:
// a toppled crane, a tank on its side, a derelict truck, a stack of pipes, a
// shipping container, a fallen pylon, a standing silo, a cluster of barrels,
// a collapsed shed, a car. Containers, barrels and cars may repeat.
export type WreckKind = 'crane' | 'tank' | 'truck' | 'pipes' | 'container' | 'pylon' | 'silo' | 'barrels' | 'shed' | 'car';
export interface Wreck { kind: WreckKind; x: number; z: number; y: number; along: 'x' | 'z'; boxes: Block[] }
// Parts along the wreck's length (u) and across it (v): centre, length, width, height.
export const wreckParts: Record<WreckKind,[number,number,number,number,number][]> = {
  crane:[[0,0,13,0.9,0.9],[7.8,0,3,2.8,2.6],[-6.8,0,1.6,2.2,1.4]],
  tank:[[0,0,7,3,3]],
  truck:[[0.8,0,6,2.4,2.6],[-3.4,0,2.2,2.4,2.3]],
  pipes:[[0,0,6,2.2,1.6]],
  container:[[0,0,6,2.4,2.6]],
  pylon:[[0,0,14,1.5,1.5],[-7.6,0,2.4,2.4,0.7]],
  silo:[[0,0,3.8,3.8,6.5]],
  barrels:[[0,0,2.6,2.6,1]],
  shed:[[0,1.4,4.4,0.25,2.4],[-2.1,0,0.25,3,2],[0.6,-0.4,3.4,2.4,0.35]],
  car:[[0,0,4.2,1.9,1.4]],
};
export function placeWrecks(next: Rng, f: Heightfield, half: number, clear: (x: number, z: number, r: number) => boolean, claim: (x: number, z: number, r: number) => void): Wreck[] {
  const unique: WreckKind[] = ['crane','tank','truck','pipes','pylon','silo','shed'], common: WreckKind[] = ['container','barrels','car'];
  for (let i=unique.length-1;i>0;i--) { const k = Math.floor(next()*(i+1)); [unique[i],unique[k]] = [unique[k],unique[i]]; }
  // Four or five of the big ones, and three to five common pieces.
  const chosen = [...unique.slice(0,4+Math.floor(next()*2)),...Array.from({length:3+Math.floor(next()*3)},() => common[Math.floor(next()*common.length)])];
  const wrecks: Wreck[] = [];
  for (const kind of chosen) {
    for (let tries=0;tries<400;tries++) {
      const along = next() < 0.5 ? 'x' : 'z', x = (next()-0.5)*(2*half-36), z = (next()-0.5)*(2*half-36);
      const parts = wreckParts[kind], length = Math.max(...parts.map(([u,,l]) => Math.abs(u)+l/2))*2, width = Math.max(...parts.map(([,v,,w]) => Math.abs(v)+w/2))*2;
      if (!clear(x,z,length/2+2.5) || !gentle(f,x,z,along === 'x' ? length : width,along === 'x' ? width : length,1.5,0.45)) continue;
      const boxes = parts.map(([u,v,l,w,h]) => along === 'x' ? block(f,x+u,z+v,l,w,h) : block(f,x+v,z+u,w,l,h));
      wrecks.push({kind,x,z,y:lowest(f,x,z,3,3),along,boxes});
      claim(x,z,length/2+2.5);
      break;
    }
  }
  return wrecks;
}

// A worn trail between two points: the cheapest walk over the height map's
// points, both ways walkable, kept a little away from anything in the way,
// winding where a noise makes some ground costlier, then smoothed.
export function trail(f: Heightfield, ground: Surface, open: (x: number, z: number, y: number) => boolean, wobble: (x: number, z: number) => number, from: {x: number; z: number}, to: {x: number; z: number}) {
  const n = f.n, index = (x: number, z: number) => Math.round((z-f.z0)/f.step)*n+Math.round((x-f.x0)/f.step);
  const pos = (j: number) => ({x:f.x0+(j % n)*f.step,z:f.z0+Math.floor(j/n)*f.step});
  const start = index(from.x,from.z), goal = index(to.x,to.z), cost = new Float64Array(n*n).fill(Infinity), previous = new Int32Array(n*n).fill(-1);
  const heap: [number,number][] = [];
  const push = (j: number, c: number) => { heap.push([c,j]); for (let i=heap.length-1;i>0;) { const p = (i-1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p],heap[i]] = [heap[i],heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; for (let i=0;;) { const l = 2*i+1, r = l+1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m],heap[i]] = [heap[i],heap[m]]; i = m; } } return top; };
  cost[start] = 0; push(start,0);
  const g = pos(goal);
  while (heap.length) {
    const [c,j] = pop();
    if (j === goal) break;
    if (c > cost[j]+Math.hypot(pos(j).x-g.x,pos(j).z-g.z)+1e-9) continue;
    const here = pos(j), i = j % n, k = Math.floor(j/n), hj = f.h[j];
    for (const [di,dk] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
      if (i+di < 0 || i+di >= n || k+dk < 0 || k+dk >= n) continue;
      const b = j+dk*n+di, p = pos(b), hb = f.h[b];
      // Walkable both ways, at the trail's point and halfway.
      const mx = (here.x+p.x)/2, mz = (here.z+p.z)/2;
      if (!climbable(ground,hj,hb,p.x,p.z,planningGrade) || !climbable(ground,hb,hj,here.x,here.z,planningGrade) ||
          fieldGrade(f,mx,mz) > planningGrade*planningGrade || !open(p.x,p.z,hb)) continue;
      const real = cost[j]+Math.hypot(di,dk)*(1+2*Math.sqrt(fieldGrade(f,p.x,p.z))+2.5*wobble(p.x,p.z));
      if (real >= cost[b]) continue;
      cost[b] = real; previous[b] = j;
      push(b,real+Math.hypot(p.x-g.x,p.z-g.z));
    }
  }
  if (previous[goal] < 0 && goal !== start) return;
  const raw: {x: number; z: number}[] = [];
  for (let j = goal; j >= 0; j = previous[j]) { raw.unshift(pos(j)); if (j === start) break; }
  // Two rounds of corner cutting, keeping the ends.
  let line = raw;
  for (let r=0;r<2;r++) {
    const out = [line[0]];
    for (let i=0;i+1<line.length;i++) { const a = line[i], b = line[i+1]; out.push({x:a.x*0.75+b.x*0.25,z:a.z*0.75+b.z*0.25},{x:a.x*0.25+b.x*0.75,z:a.z*0.25+b.z*0.75}); }
    out.push(line.at(-1)!); line = out;
  }
  return line.map(p => ({x:p.x,y:fieldHeight(f,p.x,p.z),z:p.z}));
}
