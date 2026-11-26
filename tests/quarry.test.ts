import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trajectory } from '../src/flight.ts';
import { walkable } from '../src/layout.ts';
import { carrying, forceMap, gustEvery, gustFor, gusting, weather } from '../src/map-kinds.ts';
import { groundAt, outdoors } from '../src/places.ts';
import { onScree } from '../src/room-templates.ts';
import { route } from '../src/route.ts';
import { generateLayout } from '../src/server/generate-layout.ts';
import { Simulation } from '../src/server/simulation.ts';

const quarry = <T>(run: () => T) => { forceMap('quarry'); try { return run(); } finally { forceMap(); } };
const seeds = [3,19,77,101,512,2024,40000,77777];

test('a quarry is playable: every door, the bell and both spawns reachable; it has no river', () => quarry(() => {
  for (const seed of seeds) {
    const map = outdoors(seed);
    assert.equal(map.kind,'quarry');
    assert.equal(map.water.points.length,0,'dry');
    const reached = walkable(map.geometry,map.spawns[0],[],0.5);
    for (const p of [...map.doors.map(d => d.exit),map.ringing,map.spawns[1]]) assert.ok(reached(p),'seed '+seed+': reach '+JSON.stringify(p));
  }
}));

test('its pit steps down in terraces 4 m apart to a floor 12 m below the rim, inside the map', () => quarry(() => {
  for (const seed of seeds) {
    const map = outdoors(seed), q = map.quarry!;
    assert.ok(Math.hypot(q.x,q.z)+q.radii[0] < 67,'inside the walls');
    for (let a=0;a<8;a++) {
      const at = (d: number) => groundAt(map,q.x+Math.cos(a*Math.PI/4)*d,q.z+Math.sin(a*Math.PI/4)*d);
      // Mid-terrace each level is as planned, or higher where a ramp runs.
      const terraces = [q.radii[0]-2.5,q.radii[1]-2.5,4].map(at);
      for (const [j,y] of terraces.entries()) assert.ok(y > q.levels[j]-0.05 && y < q.levels[j]+8,'seed '+seed+': terrace '+j+' at '+y.toFixed(2)+' for '+q.levels[j]);
    }
    assert.ok(Math.abs(groundAt(map,q.x,q.z)-q.levels[2]) < 0.05,'seed '+seed+': the floor');
  }
}));

test('the ramps lead from the rim to the floor and back: whoever drops in can walk out', () => quarry(() => {
  for (const seed of seeds) {
    const map = outdoors(seed), q = map.quarry!;
    // The floor just past the foot of the last ramp (its middle may hold a boulder).
    const last = q.ramps[2], foot = last.start+last.turn*(last.span+0.15);
    const floor = {x:q.x+Math.cos(foot)*6,y:q.levels[2],z:q.z+Math.sin(foot)*6}, a = q.ramps[0].start-q.ramps[0].turn*0.4, rim = {x:q.x+Math.cos(a)*(q.radii[0]+4),y:0,z:q.z+Math.sin(a)*(q.radii[0]+4)};
    rim.y = groundAt(map,rim.x,rim.z);
    const down = walkable(map.geometry,rim,[],0.5), up = walkable(map.geometry,floor,[],0.5);
    assert.ok(down(floor),'seed '+seed+': down to the floor');
    assert.ok(up(rim),'seed '+seed+': back up to the rim');
    assert.ok(route(map.geometry,floor,map.doors[0].exit),'seed '+seed+': a walking route from the floor to the main door');
  }
}));

test('loose rock slows a walker a little', () => quarry(() => {
  const seed = seeds[0], map = outdoors(seed), sim = new Simulation(generateLayout(seed),'coop','inside');
  sim.join();
  const p = sim.state.players[0], g = map.geometry, h = map.quarry!.heaps[0];
  const walk = (x: number, z: number, yaw: number) => {
    Object.assign(p,{place:'outside',x,z,feetY:groundAt(map,x,z),yaw}); delete p.vy;
    sim.inputs.set(1,{forward:1,right:0,yaw,pitch:0});
    for (let i=0;i<10;i++) sim.tick(1/30);
    return Math.hypot(p.x-x,p.z-z);
  };
  // Off the top of a spoil heap, the clearest of eight ways (a boulder may sit
  // on it), against the plot.
  assert.ok(onScree(g,h.x,h.z));
  const loose = Math.max(...[0,1,2,3,4,5,6,7].map(a => walk(h.x,h.z,a*Math.PI/4))), firm = walk(map.exit.x,map.exit.z+3,Math.PI/2);
  assert.ok(loose < firm*0.92 && loose > firm*0.75,'scree '+loose.toFixed(2)+' m against '+firm.toFixed(2)+' m');
}));

test('the wind pushes a throw downwind; replays of a launch agree exactly', () => quarry(() => {
  const map = outdoors(seeds[1]), wind = map.geometry.wind!;
  assert.ok(Math.hypot(wind.x,wind.z) > 2);
  const start = {x:map.exit.x,y:groundAt(map,map.exit.x,map.exit.z+2)+1.4,z:map.exit.z+2,vx:0,vy:4,vz:0}, body = {r:0.12,h:0.12};
  const blown = trajectory(map.geometry,[],start,body,start), still = trajectory({...map.geometry,wind:undefined},[],start,body,start);
  const drift = {x:blown.rest.x-still.rest.x,z:blown.rest.z-still.rest.z};
  assert.ok(drift.x*wind.x+drift.z*wind.z > 0.5,'carried downwind: '+JSON.stringify(drift));
  // A fresh replay of the same launch lands on the same spot.
  const again = trajectory({...map.geometry},[],{...start},body,start);
  assert.deepEqual(again.rest,blown.rest);
}));

test('gusts come about 7 s in every 30 and drown sound further; the dust shortens sight', () => quarry(() => {
  const seed = seeds[2];
  let gusts = 0;
  for (let c=0;c<gustEvery*10;c++) if (gusting(seed,c)) gusts++;
  assert.equal(gusts,gustFor*10);
  const calm = [...Array(gustEvery).keys()].find(c => !gusting(seed,c))!, gust = [...Array(gustEvery).keys()].find(c => gusting(seed,c))!;
  assert.ok(carrying(seed,gust) < carrying(seed,calm) && carrying(seed,calm) < 1);
  assert.ok(weather.quarry.sight < 1);
}));

test('its toxic waste: drums leaking into spills on level ground, one on the pit floor, none on a ramp or in the way', () => quarry(() => {
  for (const seed of seeds) {
    const map = outdoors(seed), q = map.quarry!, toxic = map.toxic!;
    assert.ok(toxic.spills.length >= 6,'seed '+seed+': '+toxic.spills.length+' spills');
    assert.ok(toxic.spills.some(s => Math.hypot(s.x-q.x,s.z-q.z) < q.radii[2]-2 && Math.abs(s.y-q.levels[2]) < 0.1),'seed '+seed+': one on the pit floor');
    for (const s of toxic.spills) {
      assert.ok(toxic.drums.some(d => Math.hypot(d.x-s.x,d.z-s.z) < s.r+1.5),'seed '+seed+': drums by each spill');
      for (const r of q.ramps) for (let u=0;u<=1;u+=0.1) {
        const a = r.start+r.turn*r.span*u, x = q.x+Math.cos(a)*(r.radius-2), z = q.z+Math.sin(a)*(r.radius-2);
        assert.ok(Math.hypot(x-s.x,z-s.z) > s.r+0.5,'seed '+seed+': off the ramps');
      }
    }
    // Every drum is solid, and the crew still reaches every door and the bell.
    for (const d of toxic.drums) assert.ok(map.geometry.props.some(p => Math.abs(p.x-d.x) < 0.01 && Math.abs(p.z-d.z) < 0.01));
    const reached = walkable(map.geometry,map.spawns[0],[],0.5);
    for (const p of [...map.doors.map(d => d.exit),map.ringing]) assert.ok(reached(p),'seed '+seed);
  }
}));
