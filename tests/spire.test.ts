import assert from 'node:assert/strict';
import { test } from 'node:test';
import { facilityKind, facilityStoreys, spirePlaytestSeeds } from '../src/facility-kinds.ts';
import { anchor, geometryFor, isSpireFlight, validLayout, walkable } from '../src/layout.ts';
import { mapKind, mapKinds } from '../src/map-kinds.ts';
import { listen, pace } from '../src/mission.ts';
import { groundAt, insideDoors, outdoors, placeOf } from '../src/places.ts';
import { assembleTemplates, orient, roomTemplates, storey, surfaceContains, turnPoint } from '../src/room-templates.ts';
import { shaftKillDepth } from '../src/spiral.ts';
import { expeditionSeed, spawnSalvage } from '../src/salvage.ts';
import { generateLayout } from '../src/server/generate-layout.ts';
import { moveOperator, Simulation } from '../src/server/simulation.ts';
import { walkRoute } from './walk.ts';
import { goInside } from './travel.ts';

const spire = () => generateLayout(spirePlaytestSeeds.spire);

test('contracts draw both facilities and each facility can appear on every outdoor map', () => {
  const pairings = new Set<string>();
  const draws = new Set(Array.from({length:3},(_,i) => facilityKind(expeditionSeed(spirePlaytestSeeds.spire,i))));
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
  assert.equal(plan.rooms.filter(isSpireFlight).length,4);
  assert.equal(Math.max(...plan.rooms.map(r => r.y)),3*storey);
  const outside = outdoors(plan.seed), exits = insideDoors(plan);
  assert.equal(outside.facility,plan.facility);
  assert.ok(outside.tower);
  assert.deepEqual(exits.map(d => d.id),outside.doors.map(d => d.id));
  assert.ok(exits.every(d => d.door.y === 0));
});

test('Spire wings vary by seed, repeat utility rooms, and put more dangerous rooms on each higher floor', () => {
  const topologies = new Set<string>();
  for (const seed of [1,2,3,5,7,8,13,17].filter(seed => facilityKind(seed) === 'spire')) {
    const plan = generateLayout(seed);
    assert.ok(validLayout(plan));
    const destinations = plan.rooms.filter(r => !isSpireFlight(r) && !['intake','corridor','stairwell'].includes(r.kind));
    assert.ok(destinations.length >= 25);
    assert.equal(destinations.filter(r => r.template === 'office').length,1);
    assert.ok(destinations.filter(r => ['hoist-store','closet','stores'].includes(r.template)).length >= 2);
    assert.ok(new Set(destinations.map(r => r.template)).size < destinations.length);
    const floors = facilityStoreys(plan.facility,seed);
    const danger = Array.from({length:floors},(_,i) => destinations.filter(r => r.y === i*storey && roomTemplates[r.template].depth).length);
    assert.deepEqual(danger,Array.from({length:floors},(_,i) => Math.min(i,3)));
    topologies.add(destinations.map(r => [r.template,r.x,r.z].join('/')).join(','));
  }
  assert.ok(topologies.size >= 3);
});

test('seeded Spires draw all three heights with a crown and façade at the matching height', () => {
  const heights = new Set<number>();
  for (let seed=0; seed<128; seed++) {
    if (facilityKind(seed) === 'spire') heights.add(facilityStoreys('spire',seed));
  }
  assert.deepEqual(heights,new Set([4,5,6]));

  for (const [preset,seed] of Object.entries(spirePlaytestSeeds)) {
    const floors = preset === 'spire' ? 4 : Number(preset.slice(-1));
    const plan = generateLayout(seed), tower = plan.rooms.filter(isSpireFlight), exterior = outdoors(seed);
    assert.ok(validLayout(plan));
    assert.deepEqual(plan,generateLayout(seed));
    assert.equal(tower.length,floors);
    assert.deepEqual(tower.map(r => r.y),Array.from({length:floors},(_,i) => i*storey));
    assert.equal(tower.at(-1)!.template,'spire-crown');
    assert.equal(exterior.tower!.length,floors+1);
    assert.equal(exterior.building.h,floors*storey+3);
  }
});

for (const seed of Object.values(spirePlaytestSeeds)) {
  const floors = facilityStoreys('spire',seed);
  test('an operator climbs the '+floors+'-storey Spire and extracts top-floor salvage', () => {
    const plan = generateLayout(seed), g = geometryFor(plan);
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

    walkRoute(sim,1,room('spire-floor-2'));
    assert.equal(p.feetY,storey);
    walkRoute(sim,1,room('stairwell-a'));
    assert.deepEqual([sim.roomOf(p),p.feetY],['stairwell-a',storey]);
    const stair = plan.rooms.find(r => r.id === 'stairwell-a')!;
    const upper = turnPoint({x:0,y:storey,z:0},stair.turn);
    walkRoute(sim,1,{x:stair.x+upper.x,y:stair.y+upper.y,z:stair.z+upper.z});
    assert.deepEqual([sim.roomOf(p),p.feetY],['stairwell-a',2*storey]);
    walkRoute(sim,1,room('spire-floor-3'));
    assert.equal(sim.roomOf(p),'spire-floor-3');

    const top = (floors-1)*storey;
    const prize = salvage.find(item => item.y === top && item.room.startsWith('transfer-'))!;
    walkRoute(sim,1,prize);
    assert.deepEqual([sim.roomOf(p),p.feetY],[prize.room,top]);
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
}

test('the Bell Diver follows the upper Spire flights and its chains carry through nearby landings', () => {
  const plan = spire(), sim = new Simulation(plan,'coop','inside');
  sim.join(1);
  const mission = sim.state.mission!, p = sim.state.players[0];
  const {x,y,z} = anchor(plan.rooms.find(r => r.id === 'spire-floor-4')!);
  Object.assign(p,{x,z,feetY:y});
  const start = anchor(plan.rooms.find(r => r.id === 'spire-floor-2')!);
  mission.diver = {mode:'hanging',bay:'spire-floor-2',seconds:0,...start};
  sim.random = () => 0;
  sim.tick(1/30);
  assert.deepEqual([mission.diver.bay,mission.diver.y],['spire-floor-3',2*storey]);
  assert.equal(listen(plan,'spire-floor-4',mission.diver,0).clip,0);
  assert.equal(listen(plan,'intake',mission.diver,0).clip,undefined);
  const time = pace(mission).step;
  for (let i=0;i<=time*30;i++) sim.tick(1/30);
  assert.deepEqual([mission.diver.bay,mission.diver.y],['spire-floor-4',3*storey]);
});

test('the Bell Diver holds over a shared landing without striking the next floor', () => {
  const plan = spire(), sim = new Simulation(plan,'coop','inside');
  sim.join(1);
  sim.join(2);
  const mission = sim.state.mission!, [near,above] = sim.state.players;
  Object.assign(near,{x:0.7,z:-7,feetY:8});
  Object.assign(above,{x:0.7,z:-7,feetY:12});
  assert.equal(sim.roomOf(near),'spire-floor-3');
  assert.equal(sim.roomOf(above),'spire-floor-4');
  mission.gnawers = [];
  mission.diver = {mode:'hanging',bay:'spire-floor-3',seconds:0,x:near.x,y:near.feetY,z:near.z,moves:0};
  sim.tick(1/30);
  const before = mission.diver.drop!;
  assert.ok(before > 0);
  near.x = -0.7;
  assert.equal(sim.roomOf(near),'spire-floor-2');
  sim.tick(1/30);
  assert.ok(mission.diver.drop! < before);
  assert.deepEqual([mission.diver.bay,mission.diver.moves,mission.diver.travel],['spire-floor-3',0,undefined]);
  for (let i=0; i<150; i++) sim.tick(1/30);
  assert.deepEqual(mission.down.map(d => d.id),[1]);
});

test('the six-storey shaft stays open and falls reach the same fatal depth', () => {
  const plan = generateLayout(spirePlaytestSeeds['spire-6']), sim = new Simulation(plan,'coop','inside');
  sim.join(1);
  sim.join(2);
  const crown = plan.rooms.find(r => r.template === 'spire-crown')!, p = sim.state.players[0];
  const geometry = geometryFor(plan);
  assert.equal(geometry.rails.length,0);
  assert.ok(geometry.surfaces.every(s => !surfaceContains(s,crown.x,crown.z)));
  Object.assign(p,{x:crown.x,z:crown.z+4,feetY:crown.y});
  sim.inputs.set(1,{forward:1,right:0,yaw:0,pitch:0});
  for (let i=0;i<12;i++) sim.tick(1/30);
  sim.inputs.set(1,{forward:0,right:0,yaw:0,pitch:0});
  assert.ok(p.vy! < 0);
  for (let i=0; i<72 && p.feetY! > -10; i++) sim.tick(1/30);
  assert.ok(p.feetY! <= -10 && p.feetY! > -shaftKillDepth);
  assert.ok(p.vy! < 0);
  assert.ok(!sim.state.mission!.dead?.length);
  for (let i=0; i<60 && !sim.state.mission!.dead?.length; i++) sim.tick(1/30);
  assert.deepEqual(sim.state.mission!.dead,[1]);
  assert.ok(p.feetY! < -shaftKillDepth);
});

test('the transfer gallery can be crossed by jumping, and running off its ledge falls', () => {
  const g = assembleTemplates([{id:'probe',template:'transfer',x:0,y:0,z:0,turn:0}],[],true);
  const start = {id:1,connected:true,x:0.65,z:0,feetY:0,yaw:0,pitch:0};
  const walker = {...start}, jumper = {...start};
  const travel = {forward:0,right:1,yaw:0,pitch:0};
  for (let i=0;i<18;i++) moveOperator(walker,travel,1/30,g);
  assert.ok(walker.feetY < -0.5);
  const decks = orient('transfer',0).surfaces;
  for (const platform of [decks[3],decks[4],decks[5],decks[1]]) {
    for (let i=0;i<18;i++) moveOperator(jumper,{...travel,jump:i === 0},1/30,g);
    for (let i=0;i<15;i++) moveOperator(jumper,{...travel,right:0},1/30,g);
    assert.ok(Math.abs(jumper.x-platform.x) < platform.w/2);
    assert.equal(jumper.feetY,0);
  }
});
