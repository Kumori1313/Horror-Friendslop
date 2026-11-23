import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as T from 'three';
import { geometryFor, kindOf, stairwellLayout } from '../src/layout.ts';
import { palettes, surfaceFor, surfaces, worldUV } from '../src/materials.ts';
import type { Finish, Surface } from '../src/materials.ts';
import { roomTemplates } from '../src/room-templates.ts';
import type { TemplateKind } from '../src/room-templates.ts';
import { generateLayout } from '../src/server/generate-layout.ts';
import { drawTemplates } from '../src/template-scene.ts';
import type { Layout } from '../src/layout.ts';

// Texture coordinates for every corner of a scaled, rotated box, as the facility builder computes them.
function faceSpans(w: number, h: number, d: number, angle = 0) {
  const box = new T.BoxGeometry(), o = new T.Object3D();
  o.scale.set(w,h,d); o.rotation.x = angle; o.updateMatrix();
  const normals = new T.Matrix3().getNormalMatrix(o.matrix);
  const p = box.attributes.position, n = box.attributes.normal, v = new T.Vector3(), m = new T.Vector3();
  const faces = new Map<string,number[][]>();
  for (let i=0;i<p.count;i++) {
    v.fromBufferAttribute(p,i).applyMatrix4(o.matrix);
    m.fromBufferAttribute(n,i).applyMatrix3(normals).normalize();
    const key = [m.x,m.y,m.z].map(c => Math.round(c*10)).join();
    faces.set(key,[...(faces.get(key) ?? []),worldUV(v.x,v.y,v.z,m.x,m.y,m.z)]);
  }
  const span = (uv: number[][]) => [Math.max(...uv.map(c => c[0]))-Math.min(...uv.map(c => c[0])),Math.max(...uv.map(c => c[1]))-Math.min(...uv.map(c => c[1]))];
  // The face whose outward normal points most along `axis` (0 = x, 1 = y, 2 = z).
  return (axis: number) => span([...faces.entries()].sort((a,b) => +b[0].split(',')[axis]-+a[0].split(',')[axis])[0][1]);
}

test('textures keep one scale per metre on short and long walls, floors and ramps', () => {
  // A 1 m wall stub and a 12 m hall wall: the texture spans their real size.
  const stub = faceSpans(1,3.6,0.12)(2), hall = faceSpans(12,3.6,0.12)(2);
  assert.deepEqual(stub.map(v => +v.toFixed(3)),[1,3.6]);
  assert.deepEqual(hall.map(v => +v.toFixed(3)),[12,3.6]);
  // A floor slab spans its width and depth.
  const floor = faceSpans(8,0.13,6)(1);
  assert.deepEqual(floor.map(v => +v.toFixed(3)),[8,6]);
  // The ramp's top keeps its width and its 7 m run; along the slope it is
  // projected, so 8.06 m of ramp reads as 7 m (13% shorter), never stretched.
  const ramp = faceSpans(2,0.13,Math.hypot(7,4),-Math.atan2(4,7))(1);
  assert.ok(Math.abs(ramp[0]-2) < 1e-6 && Math.abs(ramp[1]-7) < 0.01,'ramp spans '+ramp);
});

test('every room kind has a palette from the library, and facilities show at least five materials', () => {
  const library = Object.keys(surfaces) as Surface[];
  const kinds = new Set((Object.keys(roomTemplates) as TemplateKind[]).map(kindOf));
  for (const kind of kinds) {
    for (const part of ['wall','floor','ceiling'] as const) assert.ok(library.includes(palettes[kind][part]),kind+' '+part);
  }
  for (const finish of ['grate','ramp','trim','metal','rust','paint','wood'] as Finish[]) assert.ok(surfaceFor('corridor',finish));
  assert.ok(library.filter(s => surfaces[s].metalness >= 0.4).length >= 4,'several metallic surfaces');
  assert.ok(library.some(s => surfaces[s].reflect),'brushed steel reflects');
  for (const seed of [0,19,20,715,4242]) {
    const used = new Set<Surface>();
    for (const room of generateLayout(seed).rooms) for (const part of ['wall','floor','ceiling'] as const) used.add(palettes[room.kind][part]);
    assert.ok(used.size >= 5,'seed '+seed+' shows '+used.size+' shell materials');
  }
});

// Two different materials drawn flush in the same plane flicker through each
// other. Check every visible face of the shell against every other box.
function flushFaces(layout: Layout) {
  const g = geometryFor(layout), kind = new Map(layout.rooms.map(r => [r.id,r.kind]));
  type Box = {look:string; lo:number[]; hi:number[]};
  const boxes: Box[] = [];
  drawTemplates(g,(room,finish,color,x,y,z,w,h,d,angle,axis) => {
    const shell = ['wall','floor','ceiling','grate','ramp'].includes(finish);
    if (!angle && axis !== 'wedge') boxes.push({look:finish+':'+color+(shell ? ':'+kind.get(room) : ''),lo:[x-w/2,y-h/2,z-d/2],hi:[x+w/2,y+h/2,z+d/2]});
  },() => 0);
  // A point a player could see from: above some floor, below its ceiling.
  const air = (q: number[]) => g.surfaces.some(f => Math.abs(q[0]-f.x) < f.w/2 && Math.abs(q[2]-f.z) < f.d/2 && q[1] > Math.min(f.y,f.y+(f.rise ?? 0))-0.01 && q[1] < Math.max(f.y,f.y+(f.rise ?? 0))+3.7);
  const inside = (q: number[]) => boxes.some(c => c.lo.every((l,k) => q[k] > l) && c.hi.every((h,k) => q[k] < h));
  const found: string[] = [];
  for (let i=0;i<boxes.length;i++) for (let j=i+1;j<boxes.length;j++) {
    const a = boxes[i], b = boxes[j];
    if (a.look === b.look) continue;
    for (let ax=0;ax<3;ax++) for (const [pa,pb,dir] of [[a.lo,b.lo,-1],[a.hi,b.hi,1]] as const) {
      if (Math.abs(pa[ax]-pb[ax]) > 1e-6) continue;
      const others = [0,1,2].filter(o => o !== ax);
      if (others.some(o => Math.min(a.hi[o],b.hi[o])-Math.max(a.lo[o],b.lo[o]) <= 1e-4)) continue;
      for (const u of [0.1,0.5,0.9]) for (const v of [0.1,0.5,0.9]) {
        const q = [0,0,0];
        q[ax] = pa[ax]+dir*0.002;
        others.forEach((o,n) => { const lo = Math.max(a.lo[o],b.lo[o]), hi = Math.min(a.hi[o],b.hi[o]); q[o] = lo+(hi-lo)*(n ? v : u); });
        if (air(q) && !inside(q)) found.push(a.look+' / '+b.look+' at '+q.map(n => n.toFixed(2)).join());
      }
    }
  }
  return found;
}

test('no two materials are drawn flush in the same plane where a player can see them', () => {
  for (const seed of [0,1,19,20,77,187,715,4242]) assert.deepEqual(flushFaces(generateLayout(seed)).slice(0,3),[],'seed '+seed);
  assert.deepEqual(flushFaces(stairwellLayout()).slice(0,3),[],'stairwell walkthrough');
});

test('the solid fill under a ramp or stair flight stays inside its sides', () => {
  for (const layout of [stairwellLayout(),generateLayout(19),generateLayout(77)]) {
    const g = geometryFor(layout), drawn: {room: string; x: number; z: number; w: number; d: number; angle?: number; axis?: string}[] = [];
    drawTemplates(g,(room,finish,color,x,y,z,w,h,d,angle,axis) => drawn.push({room,x,z,w,d,angle,axis}),() => 0);
    for (const s of g.surfaces.filter(f => f.rise)) {
      const across = s.along ? s.d : s.w;
      const wedge = drawn.find(b => b.axis === 'wedge' && Math.abs(b.x-s.x) < 0.01 && Math.abs(b.z-s.z) < 0.01)!;
      assert.ok(wedge,'a fill under '+s.room);
      // A wedge's local width runs across the slope; the slab and treads span the full width.
      assert.ok(wedge.w <= across-0.003,s.room+': fill '+wedge.w+' wide under a '+across+' m '+(s.stairs ? 'flight' : 'ramp'));
      assert.ok(wedge.d <= (s.along ? s.w : s.d)-0.003,s.room+': fill stops short of the landing');
    }
  }
});
