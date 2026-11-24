import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anchor, lampSpawn } from '../src/layout.ts';
import { assignment, collectable, items, kept, lossPercent, pace, pack } from '../src/mission.ts';
import type { Mission } from '../src/mission.ts';
import { home, outdoors, placeOf, riftOpen, riftSpot, riftZones } from '../src/places.ts';
import { freeSlot, hotbarSize, lampSlot, slotsOf } from '../src/room.ts';
import type { Player } from '../src/room.ts';
import { expeditionSeed, facilityValue, spawnSalvage } from '../src/salvage.ts';
import { generateLayout } from '../src/server/generate-layout.ts';
import { expeditionsPerContract, newContract, quotaShare, settle, wipeSeed } from '../src/server/mission.ts';
import { Simulation } from '../src/server/simulation.ts';
import { walkable } from '../src/layout.ts';
import { bank, escape, goInside, goOutside, ring } from './travel.ts';

function crew(seed = 19, mode: 'solo' | 'coop' = 'coop') {
  const sim = new Simulation(generateLayout(seed),mode,'inside');
  sim.join(); if (mode === 'coop') sim.join();
  const mission = () => sim.state.mission!;
  const at = (p: Player, to: {x: number; y: number; z: number}) => Object.assign(p,{x:to.x,z:to.z,feetY:to.y});
  const player = (id: number) => sim.state.players.find(p => p.id === id)!;
  // Stand on each item and pick it up, until the hotbar is full or `limit` is reached.
  function gather(id: number, limit = Infinity) {
    let taken = 0;
    for (const item of items(sim.layout!,mission())) {
      if (taken >= limit || freeSlot(player(id)) < 0) break;
      if (item.owner !== null || item.banked || item.place !== 'inside') continue;
      if (placeOf(player(id)) !== 'inside') goInside(sim);
      at(player(id),item); sim.act(id,'take'); taken++;
    }
  }
  const bankedValue = (m: Mission) => items(sim.layout!,m).filter(i => i.banked).reduce((s,i) => s+i.value,0);
  const run = (seconds: number) => { for (let t=0;t<seconds;t+=1/30) sim.tick(1/30); };
  return {sim,mission,at,player,gather,bankedValue,run};
}

test('every facility seeds the same reachable salvage, and the quota can be met', () => {
  for (const seed of [0,19,20,715,4242,0xffffffff]) {
    const plan = generateLayout(seed);
    const salvage = spawnSalvage(plan);
    assert.deepEqual(salvage,spawnSalvage(generateLayout(seed)),'salvage repeats for a seed');
    assert.equal(new Set(salvage.map(i => i.id)).size,salvage.length);
    assert.ok(salvage.length >= 3,'seed '+seed+' holds '+salvage.length+' items');
    assert.ok(salvage.every(i => plan.rooms.find(r => r.id === i.room)!.kind !== 'intake'));
    const contract = newContract(seed);
    let total = 0;
    for (let i=0;i<expeditionsPerContract;i++) total += facilityValue(generateLayout(expeditionSeed(seed,i)));
    assert.ok(contract.quota > 0 && contract.quota <= total*quotaShare,'quota '+contract.quota+' of '+total);
  }
  assert.equal(expeditionSeed(19,0),19,'the first expedition keeps a pinned seed');
  assert.notEqual(expeditionSeed(19,1),expeditionSeed(19,2));
});

test('the exit rift opens somewhere reachable from the bell, far from where the crew arrived', () => {
  for (let seed=0;seed<30;seed++) {
    const map = outdoors(seed), spot = riftSpot(seed), reached = walkable(map.geometry,map.ringing);
    assert.ok(riftZones(seed).length > 50,'seed '+seed+' has room for a rift');
    assert.ok(reached(spot),'seed '+seed+': the rift can be walked to from the bell');
    assert.ok(Math.hypot(spot.x-map.arrival.x,spot.z-map.arrival.z) >= 30,'seed '+seed+': not where the crew arrived');
  }
  assert.deepEqual(riftSpot(7),riftSpot(7),'fixed for each expedition');
});

test('the flashlight takes a hotbar slot, the first pickup wakes the Diver, and banking keeps the light', () => {
  const {sim,mission,at,player} = crew();
  assert.equal(mission().diver.mode,'dormant');
  at(player(1),{...lampSpawn,y:0});
  sim.act(1,'take');
  assert.deepEqual(slotsOf(player(1)),[lampSlot,null,null,null]);
  const salvage = spawnSalvage(sim.layout!);
  for (const item of salvage.slice(0,hotbarSize)) { at(player(1),item); sim.act(1,'take'); }
  assert.equal(pack(sim.layout!,mission(),1).length,hotbarSize-1,'with the light, three slots are left for salvage');
  assert.equal(sim.state.lamp.stowed,true,'the light clips to the chest while salvage is in hand');
  assert.ok(mission().awake && mission().diver.mode === 'quiet','the first pickup wakes the Diver');
  ring(sim,1); bank(sim,1);
  for (let i=0;i<60;i++) sim.tick(1/30);
  assert.deepEqual(slotsOf(player(1)).filter(Boolean),[lampSlot],'banking keeps the flashlight');
  assert.equal(items(sim.layout!,mission()).filter(i => i.banked).length,3);
});

test('either operator can ring the bell, once: it opens the rift and enrages the Diver', () => {
  const {sim,mission,player,run} = crew();
  assert.equal(pace(mission()).wait+pace(mission()).fall,4);
  ring(sim,2);
  assert.deepEqual([mission().bell,mission().enraged],[2,true]);
  const spot = riftSpot(sim.layout!.seed);
  assert.deepEqual(mission().rift,{x:spot.x,z:spot.z,seconds:riftOpen});
  assert.deepEqual(pace(mission()),{wait:1.75,fall:0.75,step:1.4,travel:0.9,wander:5.6,rise:2.5,quiet:1.5,reach:3},'faster, and chasing from farther, for the rest of the expedition');
  run(1);
  ring(sim,1);
  assert.equal(mission().bell,2,'a second ring changes nothing');
  assert.ok(Math.abs(mission().rift!.seconds-(riftOpen-1)) < 0.1,'the timer keeps running');
  assert.equal(assignment(sim.layout!,sim.state,player(1),sim.solids(player(1))),undefined,'the bell offers nothing once rung');
  // The crew can still go back inside for more salvage.
  goInside(sim);
  assert.equal(placeOf(player(1)),'inside');
  const item = spawnSalvage(sim.layout!)[0];
  Object.assign(player(1),{x:item.x,z:item.z,feetY:item.y});
  sim.act(1,'take');
  assert.equal(items(sim.layout!,mission()).find(i => i.id === item.id)!.owner,1);
});

test('each item is credited exactly once, thrown in or carried in', () => {
  const {sim,mission,player,gather,run} = crew();
  gather(1,2); gather(2,1);
  ring(sim,1);
  const thrown = pack(sim.layout!,mission(),1), carried = pack(sim.layout!,mission(),2);
  bank(sim,1);
  run(2);
  for (const i of thrown) assert.equal(items(sim.layout!,mission()).find(x => x.id === i.id)!.banked,true);
  // Banked salvage can't be picked up again.
  // Beside the rift, within arm's reach of what went in, but not in it.
  Object.assign(player(1),{x:mission().rift!.x,z:mission().rift!.z+1.4});
  assert.equal(collectable(sim.layout!,mission(),player(1),sim.solids(player(1))),undefined);
  escape(sim,2);
  escape(sim,2);
  assert.deepEqual([placeOf(player(2)),mission().escaped],['home',[2]],'escaped home, once');
  escape(sim,1);
  assert.equal(mission().stage,'settled','everyone is out, so the expedition ends at once');
  const receipt = mission().contract.receipts[0];
  assert.deepEqual(receipt.items.map(i => i.kind).sort(),[...thrown,...carried].map(i => i.kind).sort());
  assert.equal(receipt.credited,[...thrown,...carried].reduce((s,i) => s+i.value,0));
  assert.equal(mission().contract.receipts.length,1);
});

test('the rift closing on an operator outside costs a fifth, and they respawn home', () => {
  const {sim,mission,player,gather,bankedValue,run} = crew();
  gather(1,2); gather(2,1);
  const lostItem = pack(sim.layout!,mission(),2)[0];
  ring(sim,1); bank(sim,1); run(2);
  const gross = bankedValue(mission());
  escape(sim,1);
  goOutside(sim,2);
  run(riftOpen);
  assert.equal(mission().stage,'settled');
  const receipt = mission().contract.receipts[0];
  assert.deepEqual([receipt.gross,receipt.lost,receipt.credited],[gross,1,kept(gross,1)]);
  assert.ok(!receipt.items.some(i => i.kind === lostItem.kind && i.value === lostItem.value) || receipt.items.length === 2,'what the left-behind operator carried is lost');
  assert.deepEqual(sim.state.players.map(placeOf),['home','home'],'both start the next expedition at home');
});

test('one escaped operator keeps x × 0.8^d with d partners lost', () => {
  assert.deepEqual([0,1,2,3,4,5].map(d => kept(1000,d)),[1000,800,640,512,410,328]);
  assert.deepEqual([1,2,5].map(lossPercent),[20,36,67]);
  const {sim,mission,gather,bankedValue,run} = crew();
  gather(1,3);
  ring(sim,1); bank(sim,1); run(2);
  const gross = bankedValue(mission());
  // A larger lobby: two more operators who never make it out.
  sim.state.players.push({...sim.state.players[1],id:3},{...sim.state.players[1],id:4});
  for (const id of [3,4]) sim.inputs.set(id,{forward:0,right:0,yaw:0,pitch:0});
  escape(sim,1);
  const receipt = settle(sim.layout!,sim.state,mission());
  assert.equal(receipt.lost,3);
  assert.equal(receipt.credited,Math.round(gross*0.8**3));
  assert.equal(receipt.deduction,gross-receipt.credited);
});

test('a downed operator nobody reaches dies, dropping what they carry; a rescue saves them', () => {
  const {sim,mission,player,gather,run} = crew();
  gather(2,1);
  const item = pack(sim.layout!,mission(),2)[0];
  mission().down.push({id:2,seconds:75});
  Object.assign(player(1),{x:player(2).x+1,z:player(2).z,feetY:player(2).feetY});
  assert.equal(assignment(sim.layout!,sim.state,player(1),sim.solids(player(1)))?.kind,'revive');
  sim.act(1,'operate');
  assert.equal(mission().down.length,0,'revived');
  mission().down.push({id:2,seconds:0.05});
  run(0.2);
  assert.deepEqual(mission().dead,[2]);
  const dropped = items(sim.layout!,mission()).find(i => i.id === item.id)!;
  assert.deepEqual([dropped.owner,dropped.x,dropped.z],[null,player(2).x,player(2).z],'dropped where they fell');
  // A dead operator watching their partner turns their view, not their body.
  const facing = player(2).yaw;
  sim.inputs.set(2,{forward:1,right:0,yaw:facing+2,pitch:0.5});
  run(0.2);
  assert.deepEqual([player(2).yaw,player(2).x],[facing,dropped.x],'the body stays as it fell');
  assert.equal(mission().stage,'explore','the partner can still make it out');
  ring(sim,1); escape(sim,1);
  assert.equal(mission().stage,'settled');
  assert.equal(mission().contract.receipts[0].lost,1);
});

test('if nobody escapes, the crew is wiped and a fresh contract follows with nothing credited', () => {
  const {sim,mission,gather,run} = crew();
  const first = mission().contract;
  gather(1,2);
  ring(sim,1); bank(sim,1); run(2);
  run(riftOpen);
  assert.deepEqual([mission().stage,mission().outcome,mission().contract.credited],['settled','wipe',0]);
  assert.equal(mission().contract.receipts.length,0,'nothing thrown in counts');
  sim.act(1,'next');
  const fresh = mission().contract;
  assert.deepEqual([fresh.seed,fresh.index,fresh.credited,fresh.receipts.length],[wipeSeed(first.seed),0,0,0]);
  assert.equal(sim.layout!.seed,fresh.seed);
  assert.equal(mission().stage,'home');
  assert.equal(mission().bell,undefined);
  // A crew struck down together is wiped at once.
  goInside(sim);
  const room = sim.layout!.rooms.find(r => r.kind !== 'intake' && r.kind !== 'corridor')!;
  for (const p of sim.state.players) Object.assign(p,{...anchor(room),feetY:anchor(room).y});
  mission().awake = true;
  mission().diver = {mode:'falling',bay:room.id,seconds:0.05,y:anchor(room).y};
  run(0.4);
  assert.deepEqual([mission().stage,mission().outcome],['settled','wipe']);
});

test('hauling enough across expeditions meets the quota and wins the contract', () => {
  const {sim,mission,gather,run} = crew();
  const round = sim.state.round;
  const stage = () => mission().stage;
  while (stage() === 'explore') {
    while (items(sim.layout!,mission()).some(i => i.owner === null && !i.banked && i.place === 'inside')) {
      gather(1); gather(2);
      if (mission().bell === undefined) ring(sim,1);
      bank(sim,1); bank(sim,2); run(2);
      goInside(sim);
    }
    escape(sim,1); escape(sim,2);
    if (stage() === 'settled') {
      sim.act(1,'next');
      assert.equal(sim.state.round,round,'the same crew session');
      goInside(sim);
    }
  }
  assert.equal(mission().stage,'won');
  assert.equal(mission().outcome,'quota');
  assert.ok(mission().contract.credited >= mission().contract.quota);
});

test('missing the quota by the last expedition loses the contract', () => {
  const {sim,mission} = crew();
  for (let i=0;i<expeditionsPerContract;i++) {
    ring(sim,1); escape(sim,1); escape(sim,2);
    if (i < expeditionsPerContract-1) { assert.equal(mission().stage,'settled'); sim.act(1,'next'); goInside(sim); }
  }
  assert.deepEqual([mission().stage,mission().outcome,mission().contract.credited],['lost','deadline',0]);
  assert.equal(mission().contract.receipts.length,expeditionsPerContract);
});

test('a brief disconnect or leaving never counts as a paid extraction', () => {
  const {sim,mission,player,gather,run} = crew();
  gather(1,2);
  ring(sim,1); bank(sim,1); run(2);
  player(2).connected = false;
  run(1);
  assert.equal(mission().stage,'explore','a reconnecting partner holds nothing up');
  player(2).connected = true;
  sim.leave(2);
  assert.deepEqual([mission().stage,mission().outcome,mission().contract.receipts.length,mission().contract.credited],['lost','left',0,0]);
});

test('a solo operator escapes with the full haul', () => {
  const {sim,mission,gather,bankedValue,run} = crew(20,'solo');
  assert.equal(sim.join(2),undefined);
  gather(1,2);
  ring(sim,1); bank(sim,1); run(2);
  gather(1,2);
  const gross = bankedValue(mission())+pack(sim.layout!,mission(),1).reduce((s,i) => s+i.value,0);
  escape(sim,1);
  assert.deepEqual([mission().contract.receipts[0].credited,mission().contract.receipts[0].deduction],[gross,0]);
});

test('refreshing during settlement credits the sale exactly once', () => {
  const {sim,mission,gather,run} = crew();
  gather(1,3);
  ring(sim,1); bank(sim,1); run(2);
  escape(sim,1); escape(sim,2);
  const credited = mission().contract.credited;
  assert.ok(credited > 0);
  sim.act(1,'operate'); sim.tick(1/30);
  assert.equal(mission().contract.credited,credited);
  // A refreshed host restores the checkpoint and carries on from it.
  const checkpoint = JSON.parse(JSON.stringify({seed:sim.layout!.seed,state:sim.state}));
  const restored = new Simulation(generateLayout(checkpoint.seed));
  restored.join(); restored.join();
  restored.state = checkpoint.state;
  restored.tick(1/30);
  assert.deepEqual([restored.state.mission!.stage,restored.state.mission!.contract.credited,restored.state.mission!.contract.receipts.length],['settled',credited,1]);
  assert.deepEqual(restored.state.players.map(placeOf),['home','home']);
  restored.act(1,'next'); restored.act(2,'next');
  assert.equal(restored.state.mission!.contract.index,1,'two presses start one expedition');
  assert.equal(restored.state.mission!.contract.credited,credited);
  assert.equal(home().rift.z,-3.4);
});

test('a refresh while the rift is open keeps the timer, what went in, and who escaped', () => {
  const {sim,mission,player,gather,run} = crew();
  gather(1,2);
  ring(sim,1); bank(sim,1); run(2);
  escape(sim,1);
  const banked = items(sim.layout!,mission()).filter(i => i.banked).map(i => i.id);
  const restored = new Simulation(generateLayout(19));
  restored.join(); restored.join();
  restored.state = JSON.parse(JSON.stringify(sim.state));
  restored.tick(1/30);
  const m = restored.state.mission!;
  assert.deepEqual([m.escaped,m.bell,m.enraged],[[1],1,true]);
  assert.ok(m.rift && Math.abs(m.rift.seconds-mission().rift!.seconds) < 0.1);
  assert.deepEqual(items(restored.layout!,m).filter(i => i.banked).map(i => i.id),banked);
  assert.deepEqual(restored.state.players.map(placeOf),['home',placeOf(player(2))]);
  // The partner still makes it out of the restored expedition, and the sale counts once.
  const p2 = restored.state.players[1];
  Object.assign(p2,{place:'outside',x:m.rift!.x,z:m.rift!.z,feetY:0});
  restored.tick(1/30);
  assert.equal(m.stage,'settled');
  assert.equal(m.contract.receipts.length,1);
});
