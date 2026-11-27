import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkable } from '../src/layout.ts';
import { carrying, forceMap, seeing, squalling, weather } from '../src/map-kinds.ts';
import { groundAt, outdoors } from '../src/places.ts';
import { footingAt, waterLevel } from '../src/room-templates.ts';
import { generateLayout } from '../src/server/generate-layout.ts';
import { inSight } from '../src/server/stalkers.ts';
import { Simulation } from '../src/server/simulation.ts';

const snow = <T>(run: () => T) => { forceMap('snow'); try { return run(); } finally { forceMap(); } };
const seeds = [3,19,77,101,512,2024,40000,77777];

test('a snowfield is playable: every door, the bell and both spawns reachable; its river runs on', () => snow(() => {
  for (const seed of seeds) {
    const map = outdoors(seed);
    assert.equal(map.kind,'snow');
    assert.ok(map.water.points.length > 0,'seed '+seed+': a river');
    const reached = walkable(map.geometry,map.spawns[0],[],0.5);
    for (const p of [...map.doors.map(d => d.exit),map.ringing,map.spawns[1]]) assert.ok(reached(p),'seed '+seed+': reach '+JSON.stringify(p));
  }
}));

test('deep drifts cover much of the open ground, never the trodden trails, and slow a walker', () => snow(() => {
  for (const seed of seeds) {
    const map = outdoors(seed), g = map.geometry;
    let deep = 0, all = 0;
    for (let x=-60;x<=60;x+=2) for (let z=-60;z<=60;z+=2) { all++; if (footingAt(g,x,z) === 2) deep++; }
    assert.ok(deep > all*0.12 && deep < all*0.6,'seed '+seed+': '+Math.round(deep/all*100)+'% drifts');
    for (const line of map.trails) for (const p of line) assert.notEqual(footingAt(g,p.x,p.z),2,'seed '+seed+': a trail through a drift');
  }
  // A walker in a drift against one on a trail.
  const seed = seeds[0], map = outdoors(seed), sim = new Simulation(generateLayout(seed),'coop','inside');
  sim.join();
  const p = sim.state.players[0];
  const walk = (x: number, z: number, yaw: number) => {
    Object.assign(p,{place:'outside',x,z,feetY:groundAt(map,x,z),yaw}); delete p.vy;
    sim.inputs.set(1,{forward:1,right:0,yaw,pitch:0});
    for (let i=0;i<10;i++) sim.tick(1/30);
    return Math.hypot(p.x-x,p.z-z);
  };
  // A spot deep in a drift with drift for a metre all round, on gentle ground.
  let spot: {x: number; z: number} | undefined;
  for (let x=-50;x<=50 && !spot;x+=1) for (let z=-50;z<=50 && !spot;z+=1) {
    if (waterLevel(map.water,x,z) !== undefined) continue;
    if ([[0,0],[1,0],[-1,0],[0,1],[0,-1],[1.5,0],[-1.5,0]].every(([dx,dz]) => footingAt(map.geometry,x+dx,z+dz) === 2) && Math.abs(groundAt(map,x+1.5,z)-groundAt(map,x-1.5,z)) < 0.2) spot = {x,z};
  }
  assert.ok(spot,'a drift to walk in');
  const slow = Math.max(walk(spot!.x,spot!.z,Math.PI/2),walk(spot!.x,spot!.z,-Math.PI/2)), firm = walk(map.exit.x,map.exit.z+3,Math.PI/2);
  assert.ok(slow < firm*0.82 && slow > firm*0.65,'drift '+slow.toFixed(2)+' m against '+firm.toFixed(2)+' m');
}));

test('squalls close in about 12 s in every 45: creatures see and hear less far', () => snow(() => {
  const seed = seeds[1], squall = weather.snow.squall!;
  let on = 0;
  for (let c=0;c<squall.every*8;c++) if (squalling(seed,c)) on++;
  assert.equal(on,squall.for*8);
  const calm = [...Array(squall.every).keys()].find(c => !squalling(seed,c))!, storm = [...Array(squall.every).keys()].find(c => squalling(seed,c))!;
  assert.ok(seeing(seed,storm) < seeing(seed,calm) && carrying(seed,storm) < carrying(seed,calm));
  // Other maps have no squalls.
  forceMap('hills');
  assert.equal(squalling(seed,storm),false);
}));

test('in a squall a stalker loses sight of someone it sees in the clear', () => snow(() => {
  const seed = seeds[2], layout = generateLayout(seed), map = outdoors(seed), squall = weather.snow.squall!;
  const calm = [...Array(squall.every).keys()].find(c => !squalling(seed,c) && !squalling(seed,c+1))!, storm = [...Array(squall.every).keys()].find(c => squalling(seed,c) && squalling(seed,c+1))!;
  const sees = (clock: number) => {
    for (let x=-50;x<=30;x+=5) for (let z=-50;z<=50;z+=5) {
      const a = {x,y:groundAt(map,x,z),z}, b = {x:x+20,y:groundAt(map,x+20,z),z};
      if (waterLevel(map.water,a.x,a.z) !== undefined || waterLevel(map.water,b.x,b.z) !== undefined || !inSight(layout,a,b)) continue;
      const sim = new Simulation(layout,'coop','inside');
      sim.join();
      const p = sim.state.players[0];
      Object.assign(p,{place:'outside',x:b.x,z:b.z,feetY:b.y}); delete p.vy;
      sim.inputs.set(1,{forward:0,right:0,yaw:0,pitch:0});
      sim.state.mission!.clock = clock;
      sim.state.mission!.stalkers = [{id:1,x:a.x,y:a.y,z:a.z,yaw:-Math.PI/2,mode:'roam'}];
      for (let i=0;i<10;i++) sim.tick(1/30);
      return sim.state.mission!.stalkers![0].mode === 'stalk';
    }
    throw Error('no open ground');
  };
  assert.equal(sees(calm),true);
  assert.equal(sees(storm),false);
}));
