import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anchor, walkable } from '../src/layout.ts';
import { collectable, items, onPad } from '../src/mission.ts';
import { home, intakeDoor, outdoors, placeOf } from '../src/places.ts';
import { obstaclesAt, surfaceAt } from '../src/room-templates.ts';
import { route } from '../src/route.ts';
import { liftOf, spawnSalvage } from '../src/salvage.ts';
import { generateLayout } from '../src/server/generate-layout.ts';
import { Simulation } from '../src/server/simulation.ts';
import type { Player } from '../src/room.ts';

function crew(seed = 19, mode: 'solo' | 'coop' = 'coop') {
  const sim = new Simulation(generateLayout(seed),mode);
  sim.join(); if (mode === 'coop') sim.join();
  const player = (id: number) => sim.state.players.find(p => p.id === id)!;
  const at = (p: Player, to: {x: number; y?: number; z: number}) => Object.assign(p,{x:to.x,z:to.z,feetY:to.y ?? 0});
  return {sim,player,at,mission:sim.state.mission!};
}

test('a contract starts in the home dimension, and the arrival rift closes once everyone is out', () => {
  const {sim,player,at,mission} = crew();
  assert.equal(mission.stage,'home');
  assert.deepEqual(sim.state.players.map(placeOf),['home','home']);
  assert.equal(placeOf(sim.state.lamp),'home','the flashlight waits at home');
  // Nothing about the expedition moves until someone steps into the rift.
  for (let i=0;i<30;i++) sim.tick(1/30);
  assert.equal(mission.stage,'home');
  at(player(1),home().rift); sim.tick(1/30);
  assert.deepEqual([mission.stage,mission.arrival,placeOf(player(1))],['explore','open','outside']);
  const map = outdoors(sim.layout!.seed);
  assert.ok(Math.hypot(player(1).x-map.arrival.x,player(1).z-map.arrival.z) < 4,'arrives at the spawn area');
  assert.equal(player(1).transit?.n,1);
  at(player(2),home().rift); sim.tick(1/30);
  assert.deepEqual([mission.arrival,placeOf(player(2))],['closed','outside']);
  // A closed rift no longer leads anywhere.
  at(player(2),{x:0,z:2}); player(2).place = 'home';
  at(player(2),home().rift); sim.tick(1/30);
  assert.equal(placeOf(player(2)),'home');
  const solo = crew(20,'solo');
  solo.at(solo.player(1),home().rift); solo.sim.tick(1/30);
  assert.equal(solo.mission.arrival,'closed','a solo operator closes it at once');
});

test('every outdoor map lets the crew walk from the arrival rift to the façade door', () => {
  for (let seed=0;seed<60;seed++) {
    const map = outdoors(seed), reached = walkable(map.geometry,map.spawns[0]);
    for (const s of map.spawns) assert.ok(reached(s),'seed '+seed+': spawn '+JSON.stringify(s));
    assert.ok(reached(map.exit),'seed '+seed+': the door');
    assert.ok(route(map.geometry,map.spawns[1],map.exit),'seed '+seed+': a planned walk to the door');
    for (const r of map.rises) assert.ok(reached({x:r.x,y:r.h,z:r.z}),'seed '+seed+': the top of a bank');
  }
  const a = outdoors(5), b = outdoors(6);
  assert.notDeepEqual(a.rocks,b.rocks,'each seed lays out its own map');
  assert.deepEqual(a.building,b.building,'the façade is the same every run');
});

test('the façade door leads to Intake and back, and each place keeps its own things', () => {
  const {sim,player,at,mission} = crew();
  for (const id of [1,2]) { at(player(id),home().rift); sim.tick(1/30); }
  const map = outdoors(sim.layout!.seed);
  at(player(1),{x:map.door.x,z:map.door.z+1});
  assert.equal(sim.passage(player(1)),'enter');
  sim.act(1,'open-door');
  assert.equal(placeOf(player(1)),'inside');
  assert.equal(sim.roomOf(player(1)),'intake');
  assert.equal(sim.passage(player(1)),'leave','Intake\'s outer door is beside the entry');
  // Split up: one inside, one outside at the same coordinates as the lift.
  const lift = liftOf(sim.layout!);
  at(player(1),lift); at(player(2),lift);
  assert.equal(onPad(player(1),lift),true);
  assert.equal(onPad(player(2),lift),false,'the lift is only inside');
  // The Diver strikes only operators inside the facility.
  const bay = sim.layout!.rooms.find(r => r.kind !== 'intake' && r.kind !== 'corridor')!;
  at(player(1),anchor(bay)); at(player(2),anchor(bay));
  mission.awake = true;
  mission.diver = {mode:'warning',bay:bay.id,seconds:0.05};
  for (let i=0;i<10;i++) sim.tick(1/30);
  assert.deepEqual(mission.down.map(d => d.id),[1],'only the operator inside is struck');
  mission.down = [];
  // Salvage carried out and dropped stays outside.
  const item = spawnSalvage(sim.layout!)[0];
  at(player(1),item); sim.act(1,'take');
  at(player(1),{x:intakeDoor.x,z:intakeDoor.z-1});
  sim.act(1,'open-door');
  assert.deepEqual([placeOf(player(1)),player(1).transit?.yaw],['outside',Math.PI],'leaves facing away from the door');
  sim.act(1,'drop');
  const dropped = items(sim.layout!,mission).find(i => i.id === item.id)!;
  assert.equal(dropped.place,'outside');
  const inside = {...player(1),place:'inside' as const};
  assert.equal(collectable(sim.layout!,mission,inside,obstaclesAt(sim.geometry!,0)),undefined,'not reachable from inside at the same spot');
  sim.act(1,'take');
  assert.equal(items(sim.layout!,mission).find(i => i.id === item.id)!.owner,1);
  // A throw outdoors lands on the outdoor map.
  sim.act(1,'throw',{aim:{yaw:Math.PI,pitch:0.4,power:0.8}});
  const thrown = mission.haul.find(h => h.id === item.id)!;
  assert.equal(thrown.place,'outside');
  assert.ok(surfaceAt(map.geometry,thrown.x,thrown.z,thrown.y),'rests on the outdoor ground');
});

test('a sale brings everyone home, the receipt waits there, and the rift starts the next facility', () => {
  const {sim,player,at,mission} = crew();
  for (const id of [1,2]) { at(player(id),home().rift); sim.tick(1/30); }
  const map = outdoors(sim.layout!.seed);
  for (const id of [1,2]) { at(player(id),{x:map.door.x,z:map.door.z+1}); sim.act(id,'open-door'); }
  const item = spawnSalvage(sim.layout!)[0];
  at(player(1),item); sim.act(1,'take');
  for (const id of [1,2]) at(player(id),liftOf(sim.layout!));
  sim.act(1,'operate'); sim.act(1,'operate');
  assert.equal(mission.stage,'settled');
  assert.deepEqual(sim.state.players.map(placeOf),['home','home']);
  assert.deepEqual([placeOf(sim.state.lamp),sim.state.lamp.owner],['home',null]);
  const first = sim.layout;
  sim.act(1,'next');
  assert.equal(mission.stage,'home');
  assert.notEqual(sim.layout,first,'the next facility is planned');
  for (let i=0;i<30;i++) sim.tick(1/30);
  assert.equal(mission.stage,'home','and waits for the rift');
  at(player(2),home().rift); sim.tick(1/30);
  assert.deepEqual([mission.stage,placeOf(player(2)),mission.contract.index],['explore','outside',1]);
});

test('a refresh in any place resumes there', () => {
  const {sim,player,at} = crew();
  const resume = () => {
    const restored = new Simulation(generateLayout(19));
    restored.join(); restored.join();
    restored.state = JSON.parse(JSON.stringify(sim.state));
    restored.tick(1/30);
    return restored;
  };
  at(player(1),home().rift); sim.tick(1/30);
  const map = outdoors(sim.layout!.seed);
  at(player(1),{x:map.door.x,z:map.door.z+1}); sim.act(1,'open-door');
  // One operator inside, one still at home: each resumes in their place.
  const r1 = resume();
  assert.deepEqual(r1.state.players.map(placeOf),['inside','home']);
  assert.equal(r1.roomOf(r1.state.players[0]),'intake');
  assert.equal(r1.state.mission!.arrival,'open');
  const p2 = r1.state.players[1];
  Object.assign(p2,home().rift); r1.tick(1/30);
  assert.deepEqual([placeOf(p2),r1.state.mission!.arrival],['outside','closed']);
  // Outside, too.
  at(player(2),home().rift); sim.tick(1/30);
  const r2 = resume();
  assert.equal(placeOf(r2.state.players[1]),'outside');
  Object.assign(r2.state.players[1],{x:map.door.x,z:map.door.z+1});
  r2.act(2,'open-door');
  assert.equal(placeOf(r2.state.players[1]),'inside');
});
