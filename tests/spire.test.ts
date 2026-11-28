import assert from 'node:assert/strict';
import { test } from 'node:test';
import { facilityKind, spirePlaytestSeed } from '../src/facility-kinds.ts';
import { anchor, geometryFor, isSpireFlight, validLayout, walkable } from '../src/layout.ts';
import { mapKind, mapKinds } from '../src/map-kinds.ts';
import { listen, pace } from '../src/mission.ts';
import { groundAt, insideDoors, outdoors, placeOf } from '../src/places.ts';
import { storey } from '../src/room-templates.ts';
import { expeditionSeed, spawnSalvage } from '../src/salvage.ts';
import { generateLayout } from '../src/server/generate-layout.ts';
import { Simulation } from '../src/server/simulation.ts';
import { walkRoute } from './walk.ts';
import { goInside } from './travel.ts';

const spire = () => generateLayout(spirePlaytestSeed);

test('contracts draw both facilities and each facility can appear on every outdoor map', () => {
  const pairings = new Set<string>();
  const draws = new Set(Array.from({length:3},(_,i) => facilityKind(expeditionSeed(spirePlaytestSeed,i))));
  assert.deepEqual(draws,new Set(['factory','spire']));
  for (let seed=0;seed<128;seed++) pairings.add(`${facilityKind(seed)}/${mapKind(seed)}`);
  for (const map of mapKinds) {
    assert.ok(pairings.has(`factory/${map}`));
    assert.ok(pairings.has(`spire/${map}`));
  }
  const plan = spire();
  assert.equal(plan.facility,'spire');
  assert.equal(generateLayout(0).facility,'factory');
  assert.deepEqual(plan,spire());
  assert.ok(validLayout(plan));
  assert.equal(plan.rooms.filter(isSpireFlight).length,3);
  assert.equal(Math.max(...plan.rooms.map(r => r.y)),3*storey);
  const outside = outdoors(plan.seed), exits = insideDoors(plan);
  assert.equal(outside.facility,plan.facility);
  assert.ok(outside.tower);
  assert.deepEqual(exits.map(d => d.id),outside.doors.map(d => d.id));
  assert.ok(exits.every(d => d.door.y === 0));
});

test('an operator climbs the Spire, crosses the inner stairs and extracts fourth-floor salvage', () => {
  const plan = spire(), g = geometryFor(plan);
  const sim = new Simulation(plan,'solo');
  sim.stalkers = false;
  sim.state.mission!.gnawers = [];
  sim.join(1);
  goInside(sim);
  const p = sim.state.players[0];
  assert.equal(sim.roomOf(p),'intake');
  const room = (id: string) => anchor(plan.rooms.find(r => r.id === id)!);
  const reached = walkable(g,{x:p.x,y:p.feetY ?? 0,z:p.z},g.doors.map(d => d.id));
  for (const r of plan.rooms) assert.ok(reached(anchor(r)),r.id);
  const salvage = spawnSalvage(plan);
  for (const item of salvage) assert.ok(reached(item),item.id);

  walkRoute(sim,1,room('lockers'));
  assert.equal(p.feetY,storey);
  walkRoute(sim,1,room('stairwell-a'));
  assert.deepEqual([sim.roomOf(p),p.feetY],['stairwell-a',storey]);
  walkRoute(sim,1,{x:16,y:2*storey,z:-24});
  assert.deepEqual([sim.roomOf(p),p.feetY],['stairwell-a',2*storey]);
  walkRoute(sim,1,room('chiller'));
  assert.equal(sim.roomOf(p),'chiller');

  const prize = salvage.find(item => item.room === 'closet')!;
  walkRoute(sim,1,prize);
  assert.deepEqual([sim.roomOf(p),p.feetY],['closet',3*storey]);
  sim.act(1,'take');
  const mission = sim.state.mission!;
  assert.ok(mission.haul.some(item => item.id === prize.id && item.owner === 1));

  walkRoute(sim,1,insideDoors(plan)[0].entry);
  sim.act(1,'open-door');
  assert.equal(placeOf(p),'outside');
  const outside = outdoors(plan.seed);
  Object.assign(p,{...outside.ringing,feetY:outside.ringing.y});
  sim.act(1,'operate');
  assert.ok(mission.rift);
  const {x,z} = mission.rift;
  Object.assign(p,{x,z,feetY:groundAt(outside,x,z)});
  sim.tick(1/60);
  assert.equal(placeOf(p),'home');
  assert.equal(mission.contract.receipts[0].credited,prize.value);
});

test('the Bell Diver follows the upper Spire flights and its chains carry through nearby landings', () => {
  const plan = spire(), sim = new Simulation(plan,'coop','inside');
  sim.join(1);
  const mission = sim.state.mission!, p = sim.state.players[0];
  const {x,y,z} = anchor(plan.rooms.find(r => r.id === 'stores')!);
  Object.assign(p,{x,z,feetY:y});
  const start = anchor(plan.rooms.find(r => r.id === 'spire-flight-2')!);
  mission.diver = {mode:'hanging',bay:'spire-flight-2',seconds:0,...start};
  sim.random = () => 0;
  sim.tick(1/30);
  assert.deepEqual([mission.diver.bay,mission.diver.y],['spire-flight-3',2*storey]);
  assert.equal(listen(plan,'lockers',mission.diver,0).clip,0);
  assert.equal(listen(plan,'intake',mission.diver,0).clip,undefined);
  const time = pace(mission).step;
  for (let i=0;i<=time*30;i++) sim.tick(1/30);
  assert.deepEqual([mission.diver.bay,mission.diver.y],['stores',3*storey]);
});
