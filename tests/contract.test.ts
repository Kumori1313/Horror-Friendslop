import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anchor, lampSpawn } from '../src/layout.ts';
import { assignment, items, kept, lossPercent, pack } from '../src/mission.ts';
import type { Mission } from '../src/mission.ts';
import { freeSlot, hotbarSize, lampSlot, slotsOf } from '../src/room.ts';
import type { Player } from '../src/room.ts';
import { expeditionSeed, facilityValue, liftOf, spawnSalvage } from '../src/salvage.ts';
import { generateLayout } from '../src/server/generate-layout.ts';
import { expeditionsPerContract, newContract, quotaShare, settle } from '../src/server/mission.ts';
import { Simulation } from '../src/server/simulation.ts';
import { goInside } from './travel.ts';

function crew(seed = 19, mode: 'solo' | 'coop' = 'coop') {
  const sim = new Simulation(generateLayout(seed),mode,'inside');
  sim.join(); if (mode === 'coop') sim.join();
  const mission = sim.state.mission!;
  const at = (p: Player, to: {x: number; y: number; z: number}) => Object.assign(p,{x:to.x,z:to.z,feetY:to.y});
  const player = (id: number) => sim.state.players.find(p => p.id === id)!;
  // Stand on an item and pick it up; when the hotbar is full, unload at the lift first.
  function gather(id: number, limit = Infinity) {
    let taken = 0;
    for (const item of items(sim.layout!,mission)) {
      if (taken >= limit) break;
      if (item.owner !== null || item.loaded) continue;
      if (freeSlot(player(id)) < 0) load(id);
      at(player(id),item); sim.act(id,'take'); taken++;
    }
  }
  function load(id: number) { at(player(id),liftOf(sim.layout!)); sim.act(id,'operate'); }
  const loadedValue = (m: Mission) => items(sim.layout!,m).filter(i => i.loaded).reduce((s,i) => s+i.value,0);
  return {sim,mission,at,player,gather,load,loadedValue};
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

test('the flashlight takes a hotbar slot, the first pickup wakes the Diver, and loading keeps the light', () => {
  const {sim,mission,at,player,load,loadedValue} = crew();
  assert.equal(mission.diver.mode,'dormant');
  at(player(1),{...lampSpawn,y:0});
  sim.act(1,'take');
  assert.deepEqual(slotsOf(player(1)),[lampSlot,null,null,null]);
  assert.equal(sim.state.lamp.stowed,false,'a selected flashlight is in the hand');
  const salvage = spawnSalvage(sim.layout!);
  for (const item of salvage.slice(0,hotbarSize)) { at(player(1),item); sim.act(1,'take'); }
  assert.equal(pack(sim.layout!,mission,1).length,hotbarSize-1,'with the light, three slots are left for salvage');
  assert.equal(player(1).hand,3,'a pickup selects its slot');
  assert.equal(sim.state.lamp.stowed,true,'the light clips to the chest while salvage is in hand');
  assert.ok(mission.awake && sim.state.mission!.diver.mode === 'quiet','the first pickup wakes the Diver');
  const dropped = pack(sim.layout!,mission,1).at(-1)!;
  at(player(1),{x:1,y:0,z:4});
  sim.act(1,'drop');
  const fallen = items(sim.layout!,mission).find(i => i.id === dropped.id)!;
  assert.deepEqual([fallen.owner,fallen.x,fallen.z],[null,1,4],'drops at the operator\'s feet');
  assert.equal(slotsOf(player(1))[3],null);
  sim.act(1,'select',{slot:0});
  assert.equal(sim.state.lamp.stowed,false,'selecting the light brings it back to the hand');
  load(1);
  assert.equal(pack(sim.layout!,mission,1).length,0);
  assert.deepEqual(slotsOf(player(1)),[lampSlot,null,null,null],'loading keeps the flashlight');
  assert.equal(loadedValue(mission),salvage.slice(0,2).reduce((s,i) => s+i.value,0));
});

test('hauling enough across expeditions meets the quota and wins the contract', () => {
  const {sim,mission,at,player,gather,load} = crew();
  const round = sim.state.round;
  gather(1); load(1);
  at(player(2),liftOf(sim.layout!));
  assert.equal(assignment(sim.layout!,sim.state,player(1),sim.solids(player(1)))?.kind,'extract');
  sim.act(1,'operate');
  assert.equal(mission.stage,'settled');
  const first = mission.contract.receipts[0];
  assert.equal(first.credited,facilityValue(sim.layout!));
  assert.equal(first.deduction,0);
  sim.act(2,'next');
  assert.equal(mission.stage,'home','the crew waits at home for the rift');
  goInside(sim);
  assert.equal(mission.contract.index,1);
  assert.equal(sim.layout!.seed,expeditionSeed(mission.contract.seed,1),'a fresh facility');
  assert.equal(sim.state.round,round,'the same crew session');
  assert.deepEqual([mission.haul,mission.down,mission.awake],[[],[],false]);
  assert.ok(sim.state.players.every(p => sim.roomOf(p) === 'intake'),'both start at base');
  const stage = () => sim.state.mission!.stage;
  while (stage() === 'explore') {
    gather(1); load(1);
    at(player(2),liftOf(sim.layout!)); sim.act(1,'operate');
    if (stage() === 'settled') { sim.act(1,'next'); goInside(sim); }
  }
  assert.equal(mission.stage,'won');
  assert.equal(mission.outcome,'quota');
  assert.ok(mission.contract.credited >= mission.contract.quota);
  assert.ok(mission.contract.receipts.length < expeditionsPerContract+1);
});

test('missing the quota by the last expedition loses the contract', () => {
  const {sim,mission,at,player} = crew();
  for (let i=0;i<expeditionsPerContract;i++) {
    for (const id of [1,2]) at(player(id),liftOf(sim.layout!));
    sim.act(1,'operate');
    if (i < expeditionsPerContract-1) { assert.equal(mission.stage,'settled'); sim.act(1,'next'); goInside(sim); }
  }
  assert.deepEqual([mission.stage,mission.outcome,mission.contract.credited],['lost','deadline',0]);
  assert.equal(mission.contract.receipts.length,expeditionsPerContract);
});

test('a crew wipe ends the contract', () => {
  const {sim,mission,at,player,gather} = crew();
  gather(1,1);
  const room = sim.layout!.rooms.find(r => r.kind !== 'intake' && r.kind !== 'corridor')!;
  for (const id of [1,2]) at(player(id),anchor(room));
  mission.diver = {mode:'warning',bay:room.id,seconds:0.05};
  for (let i=0;i<10;i++) sim.tick(1/30);
  assert.deepEqual([mission.stage,mission.outcome],['lost','wipe']);
  assert.equal(mission.down.length,2);
});

test('rescuing a partner before extracting keeps the full haul', () => {
  const {sim,mission,at,player,gather,load,loadedValue} = crew();
  gather(1,3); load(1);
  mission.down.push({id:2,seconds:75});
  at(player(1),{x:player(2).x+1,y:player(2).feetY ?? 0,z:player(2).z});
  assert.equal(assignment(sim.layout!,sim.state,player(1),sim.solids(player(1)))?.kind,'revive');
  sim.act(1,'operate');
  assert.equal(mission.down.length,0);
  const gross = loadedValue(mission);
  for (const id of [1,2]) at(player(id),liftOf(sim.layout!));
  sim.act(2,'operate');
  const receipt = mission.contract.receipts[0];
  assert.deepEqual([receipt.gross,receipt.deduction,receipt.credited,receipt.lost],[gross,0,gross,0]);
});

test('extracting alone deducts a fifth of the haul, and the downed partner\'s pack is lost', () => {
  const {sim,mission,at,player,gather,load,loadedValue} = crew();
  gather(1,3); load(1);
  gather(2,1);
  const left = pack(sim.layout!,mission,2)[0];
  const gross = loadedValue(mission);
  mission.down.push({id:2,seconds:75});
  at(player(1),liftOf(sim.layout!));
  const task = assignment(sim.layout!,sim.state,player(1),sim.solids(player(1)));
  assert.deepEqual([task?.kind,task?.label],['abandon','Extract alone (−20%)']);
  sim.act(1,'operate');
  const receipt = mission.contract.receipts[0];
  assert.equal(receipt.gross,gross);
  assert.equal(receipt.deduction,Math.round(gross*0.2));
  assert.equal(receipt.credited,gross-Math.round(gross*0.2),'100 recovered credits 80');
  assert.equal(receipt.items.length,3,'only the lift is sold; the partner\'s '+left.kind+' stays behind');
  assert.equal(receipt.lost,1);
});

test('a brief disconnect or leaving never counts as a paid extraction', () => {
  const {sim,mission,at,player,gather,load} = crew();
  gather(1,2); load(1);
  at(player(1),liftOf(sim.layout!));
  player(2).connected = false;
  assert.equal(assignment(sim.layout!,sim.state,player(1),sim.solids(player(1))),undefined,'no extraction while the partner is reconnecting');
  sim.act(1,'operate');
  assert.equal(mission.stage,'explore');
  player(2).connected = true;
  sim.leave(2);
  assert.deepEqual([mission.stage,mission.outcome,mission.contract.receipts.length,mission.contract.credited],['lost','left',0,0]);
});

test('a solo operator extracts the full haul', () => {
  const {sim,mission,gather,load,loadedValue} = crew(20,'solo');
  assert.equal(sim.join(2),undefined);
  gather(1,4); load(1);
  const gross = loadedValue(mission);
  sim.act(1,'operate');
  assert.deepEqual([mission.contract.receipts[0].credited,mission.contract.receipts[0].deduction],[gross,0]);
});

test('refreshing during settlement credits the sale exactly once', () => {
  const {sim,mission,at,player,gather,load} = crew();
  gather(1,3); load(1);
  for (const id of [1,2]) at(player(id),liftOf(sim.layout!));
  sim.act(1,'operate');
  const credited = mission.contract.credited;
  assert.ok(credited > 0);
  // A replayed extraction after the sale does nothing.
  sim.act(1,'operate'); sim.act(2,'operate');
  assert.equal(mission.contract.credited,credited);
  // A refreshed host restores the checkpoint and carries on from it.
  const checkpoint = JSON.parse(JSON.stringify({seed:sim.layout!.seed,state:sim.state}));
  const restored = new Simulation(generateLayout(checkpoint.seed));
  restored.join(); restored.join();
  restored.state = checkpoint.state;
  restored.act(1,'operate');
  assert.deepEqual([restored.state.mission!.stage,restored.state.mission!.contract.credited,restored.state.mission!.contract.receipts.length],['settled',credited,1]);
  restored.act(1,'next'); restored.act(2,'next');
  assert.equal(restored.state.mission!.contract.index,1,'two presses start one expedition');
  assert.equal(restored.state.mission!.contract.credited,credited);
});

test('each operator left behind compounds the penalty instead of adding to it', () => {
  // x · 0.8^d: five losses still leave a third of the haul, not nothing.
  assert.deepEqual([0,1,2,3,4,5].map(d => kept(1000,d)),[1000,800,640,512,410,328]);
  assert.deepEqual([1,2,5].map(lossPercent),[20,36,67]);
  const {sim,mission,gather,load,loadedValue} = crew();
  gather(1,3); load(1);
  const gross = loadedValue(mission);
  // A larger lobby: two more operators who never reach the lift.
  sim.state.players.push({...sim.state.players[1],id:3},{...sim.state.players[1],id:4});
  const receipt = settle(sim.layout!,sim.state,mission,[1]);
  assert.equal(receipt.lost,3);
  assert.equal(receipt.credited,Math.round(gross*0.8**3));
  assert.equal(receipt.deduction,gross-receipt.credited);
});
