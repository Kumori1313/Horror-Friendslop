import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collisionIndex, playerRadius, walkable, type Geometry } from '../src/layout.ts';
import { groundAt, outdoors, riftZones } from '../src/places.ts';
import { climbable, fieldGrade, maxGrade } from '../src/room-templates.ts';
import { route } from '../src/route.ts';

test('every map has its riverbed and fords, plenty of ruins and wrecks of several kinds, and trails, clear of the building and the arrival', () => {
  for (let seed=1;seed<=24;seed++) {
    const map = outdoors(seed), b = map.building;
    assert.ok(map.fords.length >= 2 && map.fords.length <= 3,'seed '+seed+': '+map.fords.length+' fords');
    assert.ok(map.ruins.length >= 3 && map.ruins.length <= 6,'seed '+seed+': '+map.ruins.length+' ruins');
    // A marsh's pools leave a little less room for wrecks.
    assert.ok(map.wrecks.length >= (map.kind === 'marsh' ? 4 : 6) && map.wrecks.length <= 10,'seed '+seed+': '+map.wrecks.length+' wrecks');
    assert.ok(new Set(map.wrecks.map(w => w.kind)).size >= 4,'seed '+seed+': several kinds of wreck');
    assert.equal(map.trails.length,map.doors.length,'a trail to every door');
    for (const t of map.trails) assert.ok(t.length > 20,'seed '+seed+': a trail');
    for (const at of [...map.ruins,...map.wrecks]) {
      assert.ok(!(Math.abs(at.x-b.x) < b.w/2+14 && Math.abs(at.z-b.z-2) < b.d/2+15),'seed '+seed+': clear of the building\'s plot');
      assert.ok(Math.hypot(at.x-map.arrival.x,at.z-map.arrival.z) > 16,'seed '+seed+': clear of the arrival');
    }
    for (const p of map.river.points) {
      assert.ok(Math.hypot(p.x-b.x,p.z-b.z) >= 34,'seed '+seed+': the riverbed keeps clear of the building');
      assert.ok(Math.hypot(p.x-map.arrival.x,p.z-map.arrival.z) >= 18,'seed '+seed+': and of the arrival');
    }
  }
});

test('the riverbed is a barrier: its banks can\'t be climbed except at the fords', () => {
  for (const seed of [2,9,19]) {
    const map = outdoors(seed), f = map.ground, p = map.river.points;
    // The steepest point across the river at a point along it.
    const across = (i: number) => {
      const a = p[Math.max(0,i-1)], c = p[Math.min(p.length-1,i+1)], len = Math.hypot(c.x-a.x,c.z-a.z), nx = -(c.z-a.z)/len, nz = (c.x-a.x)/len;
      let steepest = 0;
      for (let d=-9;d<=9;d+=0.25) steepest = Math.max(steepest,Math.sqrt(fieldGrade(f,p[i].x+nx*d,p[i].z+nz*d)));
      return steepest;
    };
    const inside = p.map((q,i) => i).filter(i => Math.max(Math.abs(p[i].x),Math.abs(p[i].z)) < 60);
    // From the middle of each ford, both banks can be climbed (the trails
    // prove a whole crossing).
    for (const ford of map.river.fords) {
      const i = p.findIndex(q => q.t === ford.t), a = p[i-1], c = p[i+1], len = Math.hypot(c.x-a.x,c.z-a.z), nx = -(c.z-a.z)/len, nz = (c.x-a.x)/len;
      const side = (s: number) => { const x = ford.x+nx*8*s, z = ford.z+nz*8*s; return {x,y:groundAt(map,x,z),z}; };
      const from = walkable(map.geometry,{x:ford.x,y:groundAt(map,ford.x,ford.z),z:ford.z},[],0.5);
      assert.ok(from(side(-1)) && from(side(1)),'seed '+seed+': both banks of the ford at '+ford.t+' can be climbed');
    }
    const away = inside.filter(i => map.river.fords.every(fd => Math.hypot(p[i].x-fd.x,p[i].z-fd.z) > 40));
    const barrier = away.filter(i => across(i) > maxGrade).length;
    assert.ok(barrier >= away.length*0.7,'seed '+seed+': '+barrier+' of '+away.length+' stretches between fords can\'t be climbed out of');
  }
});

test('trails are walkable from the arrival to every door, both ways', () => {
  for (const seed of [1,5,19,40]) {
    const map = outdoors(seed), g = map.geometry, s = g.surfaces[0], index = collisionIndex(g);
    for (const [k,t] of map.trails.entries()) {
      for (let i=1;i<t.length;i++) {
        const a = t[i-1], b = t[i];
        assert.ok(climbable(s,a.y,b.y,b.x,b.z) && climbable(s,b.y,a.y,a.x,a.z),'seed '+seed+' trail '+k+': walkable at '+b.x.toFixed(1)+','+b.z.toFixed(1));
        assert.ok(index.clear(b.x,b.z,b.y,playerRadius),'seed '+seed+' trail '+k+': clear at '+b.x.toFixed(1)+','+b.z.toFixed(1));
      }
      assert.ok(Math.hypot(t[0].x-map.arrival.x,t[0].z-map.arrival.z) < 1.5 && Math.hypot(t.at(-1)!.x-map.doors[k].exit.x,t.at(-1)!.z-map.doors[k].exit.z) < 1.5);
    }
  }
});

test('the building and the rift can each be reached by more than one route', () => {
  // Block the middle of the first route found and plan again.
  const second = (g: Geometry, from: {x: number; y: number; z: number}, to: {x: number; y: number; z: number}) => {
    const first = route(g,from,to)!;
    assert.ok(first,'a first route');
    let length = 0;
    const legs = first.slice(1).map((p,i) => { const l = Math.hypot(p.x-first[i].x,p.z-first[i].z); length += l; return {a:first[i],b:p,l}; });
    let walked = 0, mid = first[0];
    for (const leg of legs) { if (walked+leg.l >= length/2) { const u = (length/2-walked)/leg.l; mid = {x:leg.a.x+(leg.b.x-leg.a.x)*u,y:0,z:leg.a.z+(leg.b.z-leg.a.z)*u}; break; } walked += leg.l; }
    const block = {x:mid.x,z:mid.z,w:6,d:6,y:-50,h:100,room:'outside',inward:1};
    return route({...g,walls:[...g.walls,block]},from,to,[0.45,0.25,0]);
  };
  for (const seed of [3,19,40]) {
    const map = outdoors(seed);
    assert.ok(second(map.geometry,map.spawns[0],{x:map.door.x,y:0,z:map.door.z+1}),'seed '+seed+': another way to the main door');
    const zones = riftZones(seed), zone = zones[Math.floor(zones.length/3)];
    assert.ok(second(map.geometry,map.ringing,zone),'seed '+seed+': another way to a rift zone');
    assert.equal(groundAt(map,zone.x,zone.z),zone.y);
  }
});
