// Landmarks of the outdoor map, grown from the expedition seed: a dry
// riverbed with a few fords, ruined shells, wrecked machinery, and worn trails
// from the arrival to the building's doors. Pure functions of the seed and
// the ground, so every client builds the same map. Like `places.ts`, no
// Node-only APIs.
import { climbable, deepWater, fieldGrade, fieldHeight, planningGrade, riverFloor, waterLevel, type Heightfield, type Surface, type Water } from './room-templates.ts';
export { deepWater, fordWater, riverFloor } from './room-templates.ts';

const smooth = (t: number) => { const c = Math.max(0,Math.min(1,t)); return c*c*(3-2*c); };
type Rng = () => number;
type Area = {x: number; z: number; r: number};

// The river: a meandering centre line across the map. `t` runs along it.
export interface River { points: {x: number; z: number; t: number}[]; fords: {x: number; z: number; t: number}[] }
// Where the ground lets it, the water stands this far below the ground along
// the centre line, so the bank tops are this far above the water.
export const freeboard = 1.9;

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

// The water's surface along the river: `freeboard` below the ground on its
// centre line and 0.4 m below the lowest ground across it within 15 m, so the
// banks hold it in, but never rising downstream, smoothed. It flows whichever
// way cuts less deep into the hills, and where the ground rises downstream
// the river cuts a gorge. Where it leaves the map through the cliffs it runs
// level, through a gorge.
export function riverSurface(river: River, height: (x: number, z: number) => number, half: number) {
  const p = river.points, inside = (i: number) => Math.max(Math.abs(p[i].x),Math.abs(p[i].z)) < half-12;
  const raw = p.map((q,i) => {
    const a = p[Math.max(0,i-1)], c = p[Math.min(p.length-1,i+1)], len = Math.hypot(c.x-a.x,c.z-a.z) || 1, nx = -(c.z-a.z)/len, nz = (c.x-a.x)/len;
    let low = height(q.x,q.z)-freeboard;
    for (let s=-15;s<=15;s+=1) low = Math.min(low,height(q.x+nx*s,q.z+nz*s)-0.4);
    return low;
  });
  const first = p.findIndex((_,i) => inside(i)), last = p.length-1-[...p].reverse().findIndex((_,i) => inside(p.length-1-i));
  if (first >= 0) for (let i=0;i<p.length;i++) if (i < first) raw[i] = raw[first]; else if (i > last) raw[i] = raw[last];
  const run = (order: number[]) => { const out = raw.slice(); let low = Infinity; for (const i of order) out[i] = low = Math.min(low,raw[i]); return out; };
  const ahead = raw.map((_,i) => i), forward = run(ahead), backward = run(ahead.slice().reverse());
  const cut = (m: number[]) => m.reduce((sum,v,i) => sum+raw[i]-v,0);
  const low = cut(forward) <= cut(backward) ? forward : backward;
  // Averaging a sequence that never rises gives one that never rises; never
  // above the running low, so never above the ground.
  return gentleFall(p,low.map((v,i) => { const near = low.slice(Math.max(0,i-5),i+6); return Math.min(v,near.reduce((a,b) => a+b,0)/near.length); }));
}

// A river falls at most `riverGradient` per metre: working up from its mouth,
// any stretch standing higher than that above the stretch below is lowered.
// Lowering never lets the water spill, and with no sudden drops one stretch's
// wide ford banks never cut under another stretch's water.
export const riverGradient = 0.06;
function gentleFall(p: River['points'], surface: number[]) {
  const out = surface.slice(), last = out.length-1;
  if (last < 1) return out;
  const forward = out[0] >= out[last];
  if (forward) for (let i=last-1;i>=0;i--) out[i] = Math.min(out[i],out[i+1]+riverGradient*Math.abs(p[i].t-p[i+1].t));
  else for (let i=1;i<=last;i++) out[i] = Math.min(out[i],out[i-1]+riverGradient*Math.abs(p[i].t-p[i-1].t));
  return out;
}

// Two or three fords spread along the stretch well inside the map, each in
// its band where the river cuts least deep below the ground and the ground
// rises least across it, so its gentle banks lead out onto the land around
// rather than up against a hollow's rim.
export function placeFords(river: River, surface: number[], height: (x: number, z: number) => number, half: number, count: number, keep: Area[]) {
  // Clear of `keep` where the river allows, so a ford's wide banks stay away
  // from level plots.
  // Not on a tight meander, where crossing would lead straight into another
  // stretch of the river.
  const p = river.points, within = p.map((_,i) => i).filter(i => Math.max(Math.abs(p[i].x),Math.abs(p[i].z)) < half-26 &&
    p.every(q => Math.abs(q.t-p[i].t) < 40 || Math.hypot(q.x-p[i].x,q.z-p[i].z) >= 30));
  const clear = within.filter(i => keep.every(k => Math.hypot(p[i].x-k.x,p[i].z-k.z) >= k.r)), inner = clear.length >= count*8 ? clear : within;
  if (inner.length < 12) return [];
  // Bands of equal length along what is left, a margin kept between them.
  const fords: River['fords'] = [], per = inner.length/count;
  for (let k=0;k<count;k++) {
    const band = inner.slice(Math.round(k*per+per*0.15),Math.round((k+1)*per-per*0.15)).filter(i => fords.every(f => Math.hypot(f.x-p[i].x,f.z-p[i].z) >= 30)), mid = band.length ? p[band[Math.floor(band.length/2)]].t : 0;
    if (!band.length) continue;
    const score = (i: number) => {
      const a = p[i-1] ?? p[i], c = p[i+1] ?? p[i], len = Math.hypot(c.x-a.x,c.z-a.z) || 1, nx = -(c.z-a.z)/len, nz = (c.x-a.x)/len, here = height(p[i].x,p[i].z);
      let rise = 0;
      for (const side of [-1,1]) for (let s=6;s<=24;s+=2) rise = Math.max(rise,height(p[i].x+nx*s*side,p[i].z+nz*s*side)-here-0.15*s);
      return here-freeboard-surface[i]+2*rise+0.02*Math.abs(p[i].t-mid);
    };
    const best = band.reduce((a,b) => score(b) < score(a) ? b : a);
    fords.push({x:p[best].x,z:p[best].z,t:p[best].t});
  }
  return fords;
}

// Around each ford the water lies level, a pool at the lowest surface within
// reach of its wide banks, so no stretch of the river there stands higher
// than the bank another stretch's ford banks cut down to. Lowering never
// lets the water spill, and the surface still never rises downstream.
export function poolFords(river: River, surface: number[]) {
  const out = surface.slice(), p = river.points;
  for (const f of river.fords) {
    const near = p.map((_,i) => i).filter(i => Math.hypot(p[i].x-f.x,p[i].z-f.z) <= 42 && Math.abs(p[i].t-f.t) <= 60);
    const low = Math.min(...near.map(i => out[i]));
    for (const i of near) out[i] = low;
  }
  // Then ease the water down into each pool rather than stepping it.
  return gentleFall(p,out);
}

// The water in the riverbed (see `Water`).
export function riverWater(river: River, surface: number[]): Water {
  return {points:river.points.map((p,i) => ({x:p.x,z:p.z,level:surface[i]})),fords:river.fords.map(f => ({x:f.x,z:f.z}))};
}

// The nearest point of the river's centre line to (x, z).
export function riverNearest(river: River, x: number, z: number) {
  let best = Infinity, at = {x:0,z:0};
  const p = river.points;
  for (let i=1;i<p.length;i++) {
    const ax = p[i-1].x, az = p[i-1].z, sx = p[i].x-ax, sz = p[i].z-az, len = sx*sx+sz*sz;
    const u = Math.max(0,Math.min(1,((x-ax)*sx+(z-az)*sz)/len)), qx = ax+sx*u, qz = az+sz*u, d = (qx-x)**2+(qz-z)**2;
    if (d < best) { best = d; at = {x:qx,z:qz}; }
  }
  return at;
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

// Dilapidated bridges over the riverbed, square to the map (walkable surfaces
// are axis-aligned), where the river runs roughly along an axis, away from
// the fords and each other. A deck of plank rows, each in two halves: here
// and there a half is missing (never two rows running, so there is always a
// way over), and stretches of railing are gone. A misstep drops you into
// the water.
export interface Plank { x: number; z: number; w: number; d: number; y: number; rise: number; along?: 'x' }
export interface Bridge { along: 'x' | 'z'; x: number; z: number; length: number; planks: Plank[]; rails: Block[]; posts: Block[] }
// Half the width of a bridge's deck: each row is two planks this wide.
const half2 = 0.7;
export function placeBridges(next: Rng, river: River, water: Water, f: Heightfield, half: number): Bridge[] {
  const p = river.points, bridges: Bridge[] = [], want = next() < 0.5 ? 2 : 3;
  const order = p.map((_,i) => i).filter(i => i > 0 && i < p.length-1 && Math.max(Math.abs(p[i].x),Math.abs(p[i].z)) < half-16);
  for (let i=order.length-1;i>0;i--) { const k = Math.floor(next()*(i+1)); [order[i],order[k]] = [order[k],order[i]]; }
  for (const i of order) {
    if (bridges.length >= want) break;
    const c = p[i], dx = p[i+1].x-p[i-1].x, dz = p[i+1].z-p[i-1].z, len = Math.hypot(dx,dz);
    if (river.fords.some(fd => Math.hypot(fd.x-c.x,fd.z-c.z) < 10) || bridges.some(b => Math.hypot(b.x-c.x,b.z-c.z) < 18)) continue;
    // The river runs within 45 degrees of one axis; the bridge spans the other.
    const runsX = Math.abs(dx)/len >= Math.SQRT1_2, runsZ = !runsX;
    if (!runsX && !runsZ) continue;
    const along: 'x' | 'z' = runsZ ? 'x' : 'z', level = waterLevel(water,c.x,c.z);
    if (level === undefined) continue;
    // Out from the middle each way to firm ground well above the water, then a little further.
    const at = (s: number) => along === 'x' ? {x:c.x+s,z:c.z} : {x:c.x,z:c.z+s};
    const end = (sign: number) => {
      // The first ground well above the water that is also gentle for a
      // couple of metres on, so the deck lands on something walkable.
      for (let s=riverFloor+2;s<24;s+=0.5) {
        const q = at(sign*s), on = at(sign*(s+1.5));
        const above = (x: number, z: number) => fieldHeight(f,x,z) >= Math.max(level,waterLevel(water,x,z) ?? -Infinity)+0.5;
        if (above(q.x,q.z) && above(on.x,on.z) && gentle(f,on.x,on.z,1.5,1.5,0.25,0.65)) return sign*(s+0.5);
      }
    };
    const a = end(-1), b = end(1);
    if (a === undefined || b === undefined || b-a > 30) continue;
    // Room to step off at both ends, well inside the map's boundary walls.
    if ([a-3,b+3].some(s => { const q = at(s); return Math.max(Math.abs(q.x),Math.abs(q.z)) > half-16; })) continue;
    // Both landings, and the ground beyond them, clear of the river, so a
    // bridge never lands beside another bend of it.
    if ([a,a-3,b,b+3].some(s => { const q = at(s), r = riverNearest(river,q.x,q.z); return Math.hypot(r.x-q.x,r.z-q.z) < riverFloor+3; })) continue;
    // The deck lands just above the ground along its outer edges; the map
    // then levels a pad of ground at each landing to meet it (`landings`).
    const landing = (s: number, side: number) => {
      let top = -Infinity;
      for (let w=0.1;w<=1.4;w+=0.25) { const q = at(s), x = along === 'x' ? q.x : q.x+side*w, z = along === 'x' ? q.z+side*w : q.z; top = Math.max(top,fieldHeight(f,x,z)); }
      return top+0.06;
    };
    const level2 = [(landing(a,-1)+landing(a,1))/2,(landing(b,-1)+landing(b,1))/2], ends = new Map([[-1,level2],[1,level2]]), length = b-a;
    if (Math.abs(level2[1]-level2[0]) > length*0.3) continue;
    const rows = Math.round(length), step = length/rows, planks: Plank[] = [], rails: Block[] = [], posts: Block[] = [];
    // Which rows lose planks: 0 none, -1 or 1 that half, 2 both (a gap to
    // jump). Half-gaps come in runs of one to three rows on one side; to
    // change sides there is a whole row between runs, and a full gap has a
    // whole row before it to jump from and after it to land on. The first
    // two and last two rows are always whole.
    const missing: number[] = new Array(rows).fill(0);
    for (let r=2;r<rows-2;) {
      const before = missing[r-1];
      if (before === 0 && r+1 < rows-2 && next() < 0.16) { missing[r] = 2; r += 2; continue; }
      if (before !== 2 && next() < 0.3) {
        const side = before === 0 ? (next() < 0.5 ? -1 : 1) : before, run = 1+Math.floor(next()*3);
        for (let k=0;k<run && r < rows-2;k++,r++) missing[r] = side;
        r++;
        continue;
      }
      r++;
    }
    for (let r=0;r<rows;r++) {
      const mid = a+r*step+step/2, deck = (side: number) => { const [u,v] = ends.get(side)!; return u+(v-u)*(r/rows); }, slope = (side: number) => { const [u,v] = ends.get(side)!; return (v-u)/rows; };
      for (const side of [-1,1]) {
        if (missing[r] === side || missing[r] === 2) continue;
        const q = at(mid), [u,v] = ends.get(side)!, y = u+(v-u)*(r/rows), tilt = (v-u)/rows;
        planks.push(along === 'x' ? {x:q.x,z:q.z+side*half2,w:step,d:half2*2,y,rise:tilt,along:'x'} : {x:q.x+side*half2,z:q.z,w:half2*2,d:step,y,rise:tilt});
      }
      // Railings, a metre high, with most stretches gone.
      for (const side of [-1,1]) {
        if (next() < 0.55) continue;
        const q = at(mid), top = Math.max(deck(side),deck(side)+slope(side));
        rails.push(along === 'x' ? {x:q.x,z:q.z+side*(half2*2+0.04),w:step,d:0.08,y:top-0.05,h:1.05} : {x:q.x+side*(half2*2+0.04),z:q.z,w:0.08,d:step,y:top-0.05,h:1.05});
      }
      // Posts down to the riverbed every few rows.
      if (r % 3 === 1) for (const side of [-1,1]) {
        const q = at(mid), px = along === 'x' ? q.x : q.x+side*(half2*2-0.05), pz = along === 'x' ? q.z+side*(half2*2-0.05) : q.z, foot = fieldHeight(f,px,pz)-0.3;
        posts.push({x:px,z:pz,w:0.22,d:0.22,y:foot,h:deck(side)-foot});
      }
    }
    bridges.push({along,x:c.x,z:c.z,length,planks,rails,posts});
  }
  return bridges;
}

// Where each bridge meets the bank: the deck's outer edge, its height, and
// which way is outward along the span.
export function landings(b: Bridge) {
  const key = (q: Plank) => b.along === 'x' ? q.x : q.z, size = (q: Plank) => b.along === 'x' ? q.w : q.d;
  const first = b.planks.reduce((m,q) => key(q) < key(m) ? q : m), last = b.planks.reduce((m,q) => key(q) > key(m) ? q : m);
  return [{edge:key(first)-size(first)/2,y:first.y,out:-1},{edge:key(last)+size(last)/2,y:last.y+last.rise,out:1}];
}
