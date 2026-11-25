import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collisionIndex, geometryFor, walkable, type Geometry } from '../src/layout.ts';
import { trajectory, launchFrom } from '../src/flight.ts';
import { groundAt, insideDoors, outdoors, placeOf, riftZones } from '../src/places.ts';
import { climbable, fieldHeight, maxGrade, surfaceAt, type Heightfield } from '../src/room-templates.ts';
import { route } from '../src/route.ts';
import { bodyOf } from '../src/salvage.ts';
import { generateLayout } from '../src/server/generate-layout.ts';
import { moveOperator, Simulation } from '../src/server/simulation.ts';
import type { Player } from '../src/room.ts';

// A test hillside: level ground for x < 0, rising at `grade` for x >= 0.
function hillside(grade: number): Geometry {
  const n = 41, h: number[] = [];
  for (let k=0;k<n;k++) for (let i=0;i<n;i++) h.push(Math.max(0,i-20)*grade);
  const field: Heightfield = {x0:-20,z0:-20,step:1,n,h};
  return {surfaces:[{x:0,z:0,w:40,d:40,y:-2,room:'outside',field}],walls:[],roofs:[],rails:[],props:[],doors:[],openings:[]};
}
const walker = (x = -2): Player => ({id:1,connected:true,x,z:0,feetY:0,yaw:0,pitch:0});
// Facing −z, strafing right heads +x (uphill), left heads −x (downhill).
const climb = (p: Player, g: Geometry, seconds: number, right = 1) => { for (let t=0;t<seconds;t+=1/30) moveOperator(p,{forward:0,right,yaw:0,pitch:0},1/30,g); };

test('walkable slopes up to 35 degrees; anything steeper is a wall', () => {
  const gentle = hillside(0.6), steep = hillside(0.85);
  const a = walker(), b = walker();
  climb(a,gentle,3);
  assert.ok(a.x > 5 && Math.abs(a.feetY!-fieldHeight(gentle.surfaces[0].field!,a.x,a.z)) < 1e-9,'up a 31 degree slope, on the ground');
  climb(b,steep,3);
  assert.ok(b.x < 0.6,'stopped within half a metre of the foot of a 40 degree slope, x='+b.x);
  assert.equal(maxGrade,0.7);
  // The flood fill and the route planner use the same rule.
  assert.equal(walkable(gentle,{x:-2,y:0,z:0},[],0.5)({x:8,y:4.8,z:0}),true);
  assert.equal(walkable(steep,{x:-2,y:0,z:0},[],0.5)({x:8,y:6.8,z:0}),false);
  assert.ok(route(gentle,{x:-2,y:0,z:0},{x:8,y:4.8,z:0}));
  assert.equal(route(steep,{x:-2,y:0,z:0},{x:8,y:6.8,z:0},[0]),undefined);
});

test('a slope too steep to climb can be walked down but not up, and a sheer drop is a drop', () => {
  const steep = hillside(1.2);
  // The flood fill goes down but never back up.
  assert.equal(walkable(steep,{x:-2,y:0,z:0},[],0.5)({x:8,y:9.6,z:0}),false);
  const cliff = hillside(4), top = {...walker(3),feetY:12};
  climb(top,cliff,2,-1);
  assert.ok(top.feetY! < 12,'fell off the cliff, feet '+top.feetY);
});

test('the host and the guest\'s prediction move alike over rolling ground', () => {
  const map = outdoors(19), sim = new Simulation(generateLayout(19),'coop','home');
  sim.join();
  const p = sim.state.players[0];
  Object.assign(p,{...map.spawns[0],feetY:map.spawns[0].y,place:'outside'});
  const twin: Player = {...p};
  const input = {forward:1,right:0.3,yaw:map.spawns[0].yaw,pitch:0};
  sim.inputs.set(1,input);
  for (let i=0;i<300;i++) { sim.tick(1/30); moveOperator(twin,input,1/30,map.geometry); }
  assert.deepEqual([p.x,p.z,p.feetY],[twin.x,twin.z,twin.feetY]);
  assert.ok(Math.hypot(p.x-map.spawns[0].x,p.z-map.spawns[0].z) > 20,'it went somewhere');
});

test('a throw on a hillside lands on the ground and rolls downhill', () => {
  const g = hillside(0.45), body = bodyOf('valve');
  const from = {x:9,z:0,feetY:fieldHeight(g.surfaces[0].field!,9,0)};
  const start = launchFrom(g,[],from,{fx:0,fz:-1,up:0.2,speed:3},body);
  const path = trajectory(g,[],start,body,{x:0,y:0,z:0});
  assert.ok(path.rest.x < 9-1,'rolled down the slope, to x='+path.rest.x);
  assert.ok(Math.abs(path.rest.y-fieldHeight(g.surfaces[0].field!,path.rest.x,path.rest.z)) < 1e-6,'resting on the ground');
  // On level ground it slides to a stop.
  const flat = hillside(0), still = trajectory(flat,[],launchFrom(flat,[],{x:-5,z:0,feetY:0},{fx:0,fz:-1,up:0.2,speed:3},body),body,{x:0,y:0,z:0});
  assert.equal(still.rest.y,0);
});

test('rift zones lie on level, reachable ground, and routes reach them from the bell', () => {
  for (const seed of [3,19,77]) {
    const map = outdoors(seed), zones = riftZones(seed);
    assert.ok(zones.length > 200,'seed '+seed+': plenty of zones');
    for (const z of zones) assert.equal(z.y,groundAt(map,z.x,z.z));
    // A spread of zones, planned on foot from the bell.
    for (const z of [zones[0],zones[Math.floor(zones.length/2)],zones[zones.length-1]]) assert.ok(route(map.geometry,map.ringing,z),'seed '+seed+': a route to '+JSON.stringify(z));
  }
});

test('fire exits lead into rooms deep inside and back out of their own door', () => {
  for (let seed=1;seed<=40;seed++) {
    const layout = generateLayout(seed), map = outdoors(seed), inside = insideDoors(layout);
    assert.equal(inside.length,map.doors.length,'seed '+seed+': every door has an inside');
    const g = geometryFor(layout), reached = walkable(g,{x:0,y:0,z:4.6},g.doors.map(d => d.id));
    for (const d of inside) assert.ok(reached(d.entry),'seed '+seed+': '+d.id+' entry walkable from Intake');
    assert.equal(new Set(inside.map(d => d.room)).size,inside.length,'each in its own room');
  }
  const sim = new Simulation(generateLayout(5),'coop','inside');
  sim.join();
  const p = sim.state.players[0], map = outdoors(5), fire = map.doors[1], inside = insideDoors(sim.layout!)[1];
  Object.assign(p,{place:'outside',x:fire.exit.x,z:fire.exit.z,feetY:0});
  sim.act(1,'open-door');
  assert.deepEqual([placeOf(p),sim.roomOf(p)],['inside',inside.room]);
  Object.assign(p,{x:inside.entry.x,z:inside.entry.z,feetY:inside.entry.y});
  sim.act(1,'open-door');
  assert.equal(placeOf(p),'outside');
  assert.ok(Math.hypot(p.x-fire.exit.x,p.z-fire.exit.z) < 1,'out of the same fire exit');
  assert.ok(surfaceAt(map.geometry,p.x,p.z,p.feetY ?? 0));
});

test('walking down into a ditch is allowed, and nowhere you can get down to leaves you stranded', () => {
  // Down a 50 degree slope: allowed now; back up: not.
  const steep = hillside(1.2), up = fieldHeight(steep.surfaces[0].field!,6,0);
  const p = {...walker(6),feetY:up};
  climb(p,steep,3,-1);
  assert.ok(p.x < 0.5,'walked down to the foot, x='+p.x);
  climb(p,steep,3,1);
  assert.ok(p.x < 0.6,'and cannot walk back up, x='+p.x);
  // On real maps, at half-metre spacing and the real walking rule: from
  // everywhere reachable from the arrival, the arrival is reachable again.
  for (let seed=1;seed<=12;seed++) {
    const map = outdoors(seed), g = map.geometry, s = g.surfaces[0], step = 0.5, span = 281, x0 = -70;
    const h = (i: number, k: number) => groundAt(map,x0+i*step,x0+k*step);
    const index = collisionIndex(g), open = (i: number, k: number) => index.clear(x0+i*step,x0+k*step,h(i,k));
    const may = (ai: number, ak: number, bi: number, bk: number) => climbable(s,h(ai,ak),h(bi,bk),x0+bi*step,x0+bk*step);
    const flood = (forward: boolean) => {
      const start = [Math.round((map.spawns[0].x-x0)/step),Math.round((map.spawns[0].z-x0)/step)], seen = new Set([start[1]*span+start[0]]), queue = [start];
      for (let q=0;q<queue.length;q++) {
        const [i,k] = queue[q];
        for (const [di,dk] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const ni = i+di, nk = k+dk, key = nk*span+ni;
          if (ni < 0 || nk < 0 || ni >= span || nk >= span || seen.has(key) || !open(ni,nk)) continue;
          if (forward ? !may(i,k,ni,nk) : !may(ni,nk,i,k)) continue;
          seen.add(key); queue.push([ni,nk]);
        }
      }
      return seen;
    };
    const out = flood(true), back = flood(false), stuck = [...out].filter(j => !back.has(j));
    assert.ok(stuck.length <= 4,'seed '+seed+': '+stuck.length+' half-metre spots with no way back, e.g. '+stuck.slice(0,3).map(j => (x0+(j % span)*step)+','+(x0+Math.floor(j/span)*step)).join(' '));
  }
});
