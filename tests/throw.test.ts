import assert from 'node:assert/strict';
import { test } from 'node:test';
import { geometryFor, lampSpawn, stairwellLayout, walkable } from '../src/layout.ts';
import type { Geometry } from '../src/layout.ts';
import { launchFrom, positionAt, trajectory } from '../src/flight.ts';
import type { Body } from '../src/flight.ts';
import { canCollect, collectable, items } from '../src/mission.ts';
import { obstaclesAt, surfaceAt, surfaceHeight } from '../src/room-templates.ts';
import type { Point3 } from '../src/room-templates.ts';
import { lampSlot, slotsOf } from '../src/room.ts';
import type { Player } from '../src/room.ts';
import { bodyOf, spawnSalvage } from '../src/salvage.ts';
import { generateLayout } from '../src/server/generate-layout.ts';
import { Simulation, throwSpeed } from '../src/server/simulation.ts';

function random(seed: number) {
  let n = seed >>> 0;
  return () => ((n = (Math.imul(n,1664525)+1013904223) >>> 0) / 4294967296);
}
function crew(seed = 19) {
  const sim = new Simulation(generateLayout(seed));
  sim.join(); sim.join();
  const player = (id: number) => sim.state.players.find(p => p.id === id)!;
  const at = (p: Player, to: Point3) => Object.assign(p,{x:to.x,z:to.z,feetY:to.y});
  const run = (seconds: number) => { for (let t=0;t<seconds;t+=1/30) sim.tick(1/30); };
  return {sim,player,at,run};
}
const aim = (yaw: number, pitch: number, power: number) => {
  const speed = throwSpeed(power,false);
  return {fx:-Math.sin(yaw),fz:-Math.cos(yaw),up:Math.sin(pitch),speed};
};

// The rest spot is on a floor, the item overlaps nothing solid, and an
// operator can stand somewhere within reach of it.
function settled(g: Geometry, rest: Point3, b: Body, opened: readonly string[], reached: (p: Point3) => boolean, label: string) {
  const floor = surfaceAt(g,rest.x,rest.z,rest.y);
  assert.ok(floor && Math.abs(surfaceHeight(floor,rest.x,rest.z)-rest.y) < 1e-6,label+': rests on a floor');
  const solids = [...g.walls,...g.props,...g.rails,...g.doors.filter(d => !opened.includes(d.id))];
  const inside = solids.find(s => Math.abs(rest.x-s.x) < s.w/2+b.r-1e-6 && Math.abs(rest.z-s.z) < s.d/2+b.r-1e-6 && rest.y < s.y+s.h && rest.y+2*b.h > s.y);
  assert.ok(!inside,label+': overlaps a solid at '+JSON.stringify(rest));
  let reachable = false;
  for (let dx=-1.75;dx<=1.75 && !reachable;dx+=0.25) for (let dz=-1.75;dz<=1.75 && !reachable;dz+=0.25) {
    const stand = surfaceAt(g,rest.x+dx,rest.z+dz,rest.y);
    if (!stand) continue;
    const feet = surfaceHeight(stand,rest.x+dx,rest.z+dz), p = {x:rest.x+dx,y:feet,z:rest.z+dz};
    if (!reached(p)) continue;
    const operator = {id:1,connected:true,x:p.x,z:p.z,feetY:feet,yaw:0,pitch:0};
    reachable = canCollect(operator,rest,obstaclesAt(g,feet,opened));
  }
  assert.ok(reachable,label+': nobody can reach '+JSON.stringify(rest));
}

test('a throw is deterministic: a client replaying the launch draws the host\'s arc and resting spot', () => {
  const {sim,player,at} = crew();
  const item = spawnSalvage(sim.layout!)[0];
  at(player(1),item); sim.act(1,'take');
  sim.act(1,'throw',{aim:{yaw:0.7,pitch:0.4,power:0.8}});
  const h = sim.state.mission!.haul.find(entry => entry.id === item.id)!;
  assert.ok(h.flight && h.flight.d > 0.2,'the item is in flight');
  // What a client receives: the launch, over JSON, and its own copy of the facility.
  const wire = JSON.parse(JSON.stringify(sim.state));
  const flight = wire.mission.haul.find((entry: {id: string}) => entry.id === item.id).flight;
  const fresh = geometryFor(generateLayout(19)), body = bodyOf(item.kind);
  const replay = trajectory(fresh,[],flight,body,{x:0,y:0,z:0});
  assert.equal(replay.duration,h.flight.d);
  const end = positionAt(replay,replay.duration);
  assert.deepEqual([end.x,end.y-body.h,end.z],[h.x,h.y,h.z],'the client lands it where the host put it');
  assert.deepEqual(replay.rest,{x:h.x,y:h.y,z:h.z});
});

test('thrown items come to rest on a floor, clear of walls and props, within an operator\'s reach', () => {
  for (const seed of [0,19,77,715]) {
    const layout = generateLayout(seed), g = geometryFor(layout), opened = g.doors.map(d => d.id);
    const reached = walkable(g,{x:0,y:0,z:3},opened), next = random(seed);
    const starts = spawnSalvage(layout);
    for (let n=0;n<40;n++) {
      const from = starts[n % starts.length], kind = n % 5 ? starts[n % starts.length].kind : 'lamp';
      const body = bodyOf(kind), p = {x:from.x,z:from.z,feetY:from.y};
      const start = launchFrom(g,opened,p,aim(next()*Math.PI*2,next()*1.4-0.4,next()),body);
      const path = trajectory(g,opened,start,body,from);
      settled(g,path.rest,body,opened,reached,'seed '+seed+' throw '+n);
      assert.ok(path.duration < 8,'seed '+seed+' throw '+n+' settles');
    }
  }
});

test('items thrown off a gallery fall to the floor below, and a closed bulkhead stops a throw', () => {
  const layout = stairwellLayout(), g = geometryFor(layout), reached = walkable(g,{x:0,y:0,z:3});
  let fell = 0;
  for (const s of g.surfaces.filter(f => f.catwalk)) {
    for (let i=0;i<8;i++) {
      const yaw = i*Math.PI/4, body = bodyOf('valve'), p = {x:s.x,z:s.z,feetY:s.y};
      const path = trajectory(g,[],launchFrom(g,[],p,aim(yaw,0.15,0.7),body),body,{x:s.x,y:s.y,z:s.z});
      settled(g,path.rest,body,[],reached,'gallery throw '+i);
      if (path.rest.y < s.y-1) fell++;
    }
  }
  assert.ok(fell >= 2,'only '+fell+' throws fell from a gallery');

  const {sim,player,at,run} = crew();
  const lamp = sim.state.lamp, door = sim.geometry!.doors.find(d => Math.abs(d.z+2) < 0.2 && Math.abs(d.x) < 0.2)!;
  assert.ok(door && !sim.state.opened!.includes(door.id),'Intake\'s bulkhead starts closed');
  at(player(1),{...lampSpawn,y:0}); sim.act(1,'take');
  sim.act(1,'throw',{aim:{yaw:0,pitch:0.05,power:1}});
  assert.ok(lamp.owner === null && lamp.flight,'the flashlight is in flight');
  assert.equal(lamp.on,true,'it stays lit while it flies');
  assert.ok(lamp.z > door.z+door.d/2,'stopped by the bulkhead at z='+lamp.z);
  run(lamp.flight!.d+0.1);
  assert.equal(lamp.flight,undefined);
  assert.equal(lamp.y,0.14,'lies on Intake\'s floor');
  sim.state.opened!.push(door.id);
  at(player(1),{x:lamp.x,y:0,z:lamp.z}); sim.act(1,'take');
  assert.equal(lamp.owner,1);
  sim.act(1,'throw',{aim:{yaw:0,pitch:0.05,power:1}});
  assert.ok(lamp.z < door.z-1,'an open bulkhead lets it through, to z='+lamp.z);
});

test('a refresh mid-flight lands the item where the host put it, and a partner can pick it up', () => {
  const {sim,player,at,run} = crew(19);
  const item = spawnSalvage(sim.layout!)[1];
  at(player(1),item); sim.act(1,'take');
  sim.act(1,'throw',{aim:{yaw:2.2,pitch:0.6,power:0.9}});
  run(0.15);
  const mission = sim.state.mission!, h = mission.haul.find(entry => entry.id === item.id)!;
  assert.ok(h.flight && h.flight.t > 0 && h.flight.t < h.flight.d,'still flying');
  const rest = {x:h.x,y:h.y,z:h.z};
  at(player(2),rest);
  assert.equal(collectable(sim.layout!,mission,player(2),sim.solids(player(2))),undefined,'nobody catches it mid-air');
  // The host reloads: a new simulation resumes from the saved state.
  const resumed = new Simulation(generateLayout(19));
  resumed.join(); resumed.join();
  resumed.state = JSON.parse(JSON.stringify(sim.state));
  for (let t=0;t<3;t+=1/30) resumed.tick(1/30);
  const landed = items(resumed.layout!,resumed.state.mission!).find(i => i.id === item.id)!;
  assert.equal(landed.flight,undefined);
  assert.deepEqual({x:landed.x,y:landed.y,z:landed.z},rest);
  const partner = resumed.state.players.find(p => p.id === 2)!;
  resumed.act(2,'take');
  assert.equal(items(resumed.layout!,resumed.state.mission!).find(i => i.id === item.id)!.owner,2,'the partner picks it up');
  assert.deepEqual(slotsOf(partner).filter(Boolean),[item.id]);
});

test('the hotbar fills to four, the light clips on, and old checkpoints rebuild their slots', () => {
  const {sim,player,at} = crew(19);
  at(player(1),{...lampSpawn,y:0}); sim.act(1,'take');
  sim.act(1,'select',{slot:2});
  assert.equal(sim.state.lamp.stowed,true);
  assert.ok(Math.hypot(sim.state.lamp.x-player(1).x,sim.state.lamp.z-player(1).z) < 0.2,'clipped to the chest');
  sim.act(1,'throw',{aim:{yaw:0,pitch:0,power:1}});
  assert.equal(sim.state.lamp.owner,1,'an empty slot throws nothing');
  sim.act(1,'select',{slot:7});
  assert.equal(player(1).hand,2,'slots outside the hotbar are ignored');
  // A checkpoint saved before the hotbar: the carried light gets a slot back.
  const old = JSON.parse(JSON.stringify(sim.state));
  for (const p of old.players) { delete p.slots; delete p.hand; }
  const resumed = new Simulation(generateLayout(19));
  resumed.join(); resumed.join();
  resumed.state = old;
  resumed.tick(1/30);
  assert.deepEqual(slotsOf(resumed.state.players[0]),[lampSlot,null,null,null]);
});

test('a struck operator\'s hotbar loses the flashlight it dropped', () => {
  const {sim,player,at} = crew(19);
  at(player(1),{...lampSpawn,y:0}); sim.act(1,'take');
  // What a strike does to the light: it falls where the operator stood.
  Object.assign(sim.state.lamp,{owner:null,x:1,y:0.14,z:1});
  sim.tick(1/30);
  assert.deepEqual(slotsOf(player(1)),[null,null,null,null]);
  sim.act(1,'throw',{aim:{yaw:0,pitch:0,power:1}});
  assert.deepEqual([sim.state.lamp.x,sim.state.lamp.z,sim.state.lamp.flight],[1,1,undefined],'nothing left to throw');
});

test('throws up or down a stair flight or ramp stay in the facility and come to rest within reach', () => {
  for (const layout of [stairwellLayout(),generateLayout(1),generateLayout(77)]) {
    const g = geometryFor(layout), reached = walkable(g,{x:0,y:0,z:3},g.doors.map(d => d.id));
    for (const s of g.surfaces.filter(f => f.rise)) {
      for (const end of [-1,1]) for (const power of [0.3,1]) for (const pitch of [-0.1,0.3]) {
        // Stand just past one end of the flight and throw along it.
        const p = {x:s.x+(s.along ? end*(s.w/2+0.4) : 0),z:s.z+(s.along ? 0 : end*(s.d/2+0.4)),feetY:end*s.rise! < 0 ? s.y : s.y+s.rise!};
        if (!surfaceAt(g,p.x,p.z,p.feetY)) continue;
        const body = bodyOf('valve'), fallback = {x:p.x,y:p.feetY,z:p.z};
        const start = launchFrom(g,[],p,{fx:s.along ? -end : 0,fz:s.along ? 0 : -end,up:Math.sin(pitch),speed:throwSpeed(power,false)},body);
        const path = trajectory(g,[],start,body,fallback);
        const label = 'seed '+layout.seed+' '+s.room+' end '+end+' power '+power+' pitch '+pitch;
        assert.notEqual(path.rest,fallback,label+': fell out and returned to the thrower');
        settled(g,path.rest,body,g.doors.map(d => d.id),reached,label);
      }
    }
  }
});
