import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as T from 'three';
import { anchor, geometryFor, stairwellLayout } from '../src/layout.ts';
import type { Geometry, Layout } from '../src/layout.ts';
import { outward, surfaceAt } from '../src/room-templates.ts';
import { generateLayout } from '../src/server/generate-layout.ts';
import { portalGraph, visibleRooms } from '../src/visibility.ts';
import { spirePlaytestSeed } from '../src/facility-kinds.ts';

function camera(x: number, y: number, z: number, yaw: number, pitch = 0) {
  const c = new T.PerspectiveCamera(72,16/9,0.055,48);
  c.rotation.order = 'YXZ';
  c.position.set(x,y,z); c.rotation.set(pitch,yaw,0);
  c.updateMatrixWorld(); c.updateProjectionMatrix();
  return c;
}
function look(plan: Layout, c: T.PerspectiveCamera, feet: number, opened: readonly string[]) {
  const g = geometryFor(plan);
  const start = surfaceAt(g,c.position.x,c.position.z,feet)!.room;
  const m = new T.Matrix4().multiplyMatrices(c.projectionMatrix,c.matrixWorldInverse);
  return visibleRooms(portalGraph(plan,g),start,m.elements,c.position,opened,c.far);
}

// Every box that can block a sightline, tagged with its room. Ramps, stairs
// and rails are left out, which only makes the check stricter.
function occluders(g: Geometry, opened: readonly string[]) {
  const boxes: {min: T.Vector3; max: T.Vector3; rooms: string[]}[] = [];
  const add = (s: {x: number; z: number; w: number; d: number}, y0: number, y1: number, rooms: string[]) =>
    boxes.push({min:new T.Vector3(s.x-s.w/2,y0,s.z-s.d/2),max:new T.Vector3(s.x+s.w/2,y1,s.z+s.d/2),rooms});
  for (const s of g.walls) add(s,s.y-0.13,s.y+s.h,[s.room]);
  for (const s of [...g.roofs,...g.props]) add(s,s.y,s.y+s.h,[s.room]);
  for (const s of g.surfaces) if (!s.rise) add(s,s.y-0.13,s.y,[s.room]);
  for (const o of g.openings) {
    const door = g.doors.find(d => Math.abs(d.x-o.x) < 1e-6 && Math.abs(d.z-o.z) < 1e-6 && Math.abs(d.y-o.y) < 1e-6);
    if (door && !opened.includes(door.id)) add(door,door.y,door.y+door.h,[o.a,o.b]);
  }
  return boxes;
}

// Cast a grid of rays through the view. The first thing each ray hits must
// belong to a room that is drawn; rooms touching at a shared wall tie.
function missed(g: Geometry, c: T.PerspectiveCamera, drawn: Set<string>, opened: readonly string[]) {
  const boxes = occluders(g,opened), ray = new T.Ray(), hit = new T.Vector3(), box = new T.Box3();
  const misses = new Set<string>();
  for (let i=0;i<32;i++) for (let j=0;j<18;j++) {
    const dir = new T.Vector3(-1+(i+0.5)/16,-1+(j+0.5)/9,0.5).unproject(c).sub(c.position).normalize();
    ray.set(c.position,dir);
    let best = Infinity, rooms = new Set<string>();
    for (const b of boxes) {
      if (!ray.intersectBox(box.set(b.min,b.max),hit)) continue;
      const t = hit.distanceTo(c.position);
      if (t > c.far) continue;
      if (t < best-1e-4) { best = t; rooms = new Set(b.rooms); }
      else if (t <= best+1e-4) for (const r of b.rooms) rooms.add(r);
    }
    if (rooms.size && ![...rooms].some(r => drawn.has(r))) misses.add([...rooms].join('|'));
  }
  return [...misses];
}

test('the camera sees its own room and looks past an open bulkhead, but not a closed one', () => {
  const plan = generateLayout(19), g = geometryFor(plan);
  const north = camera(0,1.59,3,0);
  const sealed = look(plan,north,0,[]);
  assert.deepEqual([...sealed],['intake']);
  const door = g.doors[0].id;
  const open = look(plan,north,0,[door]);
  const ahead = plan.passages.find(p => p.id === door)!.b;
  assert.ok(open.has(ahead) && open.size > 1);
  assert.deepEqual([...look(plan,camera(0,1.59,3,Math.PI),0,[door])],['intake'],'looking away from the only open doorway');
});

test('the stairwell landing sees across the hall gallery into the closet', () => {
  const plan = stairwellLayout();
  const east = look(plan,camera(0,5.59,-16,-Math.PI/2),4,[]);
  assert.ok(east.has('hall') && east.has('closet'));
  assert.ok(!east.has('intake'),'Intake lies behind the camera, down the stairs');
});

test('Spire landings reveal rooms through their own doors and cull the closed-off floors', () => {
  const plan = generateLayout(spirePlaytestSeed), open = geometryFor(plan).doors.map(d => d.id);
  const second = look(plan,camera(4,5.59,-16,0),4,open);
  assert.ok(second.has('lockers') && second.has('stairwell-a'));
  assert.ok(!second.has('stores'));
  const fourth = look(plan,camera(16,13.59,0,Math.PI),12,open);
  assert.ok(fourth.has('stores'));
  assert.ok(!fourth.has('lockers') && !fourth.has('intake'));
});

test('culling never hides a room the camera can see, and skips most of the facility', t => {
  let poses = 0, drawn = 0, total = 0;
  for (const seed of [3,19,20,77,315,642,808,999]) {
    const plan = generateLayout(seed), g = geometryFor(plan);
    const opened = g.doors.map(d => d.id);
    let random = seed;
    const next = () => (random = (Math.imul(random,1664525)+1013904223) >>> 0)/4294967296;
    // Stand at room pads and in doorways, where the next room's portal is closest.
    const spots = [
      ...plan.rooms.filter(() => next() < 0.35).map(r => anchor(r)),
      ...g.openings.filter(() => next() < 0.2).map(o => {
        const [nx,nz] = outward(o.side), s = next() < 0.5 ? -0.3 : 0.3;
        return {x:o.x+nx*s,y:o.y,z:o.z+nz*s};
      }),
    ];
    for (const spot of spots) {
      if (!surfaceAt(g,spot.x,spot.z,spot.y)) continue;
      const c = camera(spot.x,spot.y+1.59,spot.z,next()*Math.PI*2,(next()-0.5)*1.2);
      const visible = look(plan,c,spot.y,opened);
      assert.deepEqual(missed(g,c,visible,opened),[],'seed '+seed+' at '+JSON.stringify(spot)+' yaw '+c.rotation.y.toFixed(2));
      poses++; drawn += visible.size; total += plan.rooms.length;
    }
  }
  t.diagnostic(poses+' poses; '+(100*drawn/total).toFixed(1)+'% of rooms drawn on average');
  assert.ok(drawn/total < 0.4);
});
