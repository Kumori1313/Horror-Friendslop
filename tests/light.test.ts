import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lampSpawn, powered } from '../src/layout.ts';
import { items, pack } from '../src/mission.ts';
import { batteryLife, chargeOf, lampSlot, slotsOf } from '../src/room.ts';
import type { Player, Snapshot } from '../src/room.ts';
import { facilityValue, maxPerRoom, spawnSalvage } from '../src/salvage.ts';
import { generateLayout } from '../src/server/generate-layout.ts';
import { Simulation } from '../src/server/simulation.ts';

function crew(seed = 19) {
  const sim = new Simulation(generateLayout(seed),'coop','inside');
  sim.join(); sim.join();
  const mission = () => sim.state.mission!;
  const player = (id: number) => sim.state.players.find(p => p.id === id)!;
  const at = (p: Player, to: {x: number; y: number; z: number}) => Object.assign(p,{x:to.x,z:to.z,feetY:to.y});
  const run = (seconds: number) => { for (let i=0;i<Math.round(seconds*30);i++) sim.tick(1/30); };
  const lamp = () => sim.state.lamp;
  // Operator 1 picks up the flashlight, on.
  at(player(1),{...lampSpawn,y:0}); sim.act(1,'take');
  return {sim,mission,player,at,run,lamp};
}
const cellOf = (sim: Simulation) => spawnSalvage(sim.layout!).find(i => i.kind === 'cell')!;

test('Intake is lit, corridors, stairwells and the service tunnel are dark, and about half the other rooms have power', () => {
  let rooms = 0, lit = 0;
  for (let seed=1;seed<=40;seed++) {
    const layout = generateLayout(seed);
    for (const r of layout.rooms) {
      const on = powered(layout,r.id);
      assert.equal(on,powered(layout,r.id),'the same every time');
      if (r.kind === 'intake') assert.equal(on,true);
      else if (r.kind === 'corridor' || r.kind === 'stairwell' || r.template === 'tunnel') assert.equal(on,false);
      else { rooms++; if (on) lit++; }
    }
  }
  assert.ok(lit/rooms > 0.35 && lit/rooms < 0.65,'about half: '+lit+' of '+rooms);
});

test('every facility hides one or two spare cells, worth nothing, in rooms with room to spare', () => {
  for (let seed=1;seed<=60;seed++) {
    const layout = generateLayout(seed), all = spawnSalvage(layout), cells = all.filter(i => i.kind === 'cell');
    assert.ok(cells.length >= 1 && cells.length <= 2,'seed '+seed+': '+cells.length+' cells');
    for (const c of cells) {
      assert.equal(c.value,0);
      assert.ok(all.filter(i => i.room === c.room && i.kind !== 'cell').length < maxPerRoom,'not in a full room');
      assert.ok(all.filter(i => i !== c && i.room === c.room).every(i => Math.hypot(i.x-c.x,i.z-c.z) >= 1),'clear of salvage');
    }
    assert.equal(facilityValue(layout),all.filter(i => i.kind !== 'cell').reduce((s,i) => s+i.value,0),'cells add nothing to the quota');
  }
});

test('the battery drains while the flashlight is on, at half rate clipped on, and not at all when off', () => {
  const {sim,player,at,run,lamp} = crew();
  assert.equal(chargeOf(lamp()),batteryLife,'full to start');
  run(10);
  assert.equal(lamp().charge,batteryLife-10);
  // With salvage selected the light clips on and drains at half rate.
  const item = spawnSalvage(sim.layout!).find(i => i.kind !== 'cell')!;
  at(player(1),item); sim.act(1,'take');
  assert.equal(lamp().stowed,true);
  run(10);
  assert.equal(lamp().charge,batteryLife-15);
  sim.act(1,'toggle');
  run(10);
  assert.equal(lamp().charge,batteryLife-15,'off, it keeps its charge');
});

test('a flat flashlight switches off and will not switch on until a spare cell goes in', () => {
  const {sim,mission,player,at,run,lamp} = crew();
  lamp().charge = 3;
  run(4);
  assert.deepEqual([lamp().charge,lamp().on],[0,false]);
  sim.act(1,'toggle');
  assert.equal(lamp().on,false,'a flat battery will not switch on');
  // Operator 2 picks up a cell but cannot load a flashlight they don't hold.
  const cell = cellOf(sim);
  at(player(2),cell); sim.act(2,'take');
  sim.act(2,'select',{slot:slotsOf(player(2)).indexOf(cell.id)});
  sim.act(2,'load');
  assert.equal(lamp().charge,0);
  // Operator 1 takes the cell from where operator 2 drops it, and loads it.
  sim.act(2,'drop');
  at(player(1),items(sim.layout!,mission()).find(i => i.id === cell.id)!); sim.act(1,'take');
  sim.act(1,'select',{slot:slotsOf(player(1)).indexOf(cell.id)});
  sim.act(1,'load');
  assert.equal(lamp().charge,batteryLife,'full again');
  assert.equal(items(sim.layout!,mission()).some(i => i.id === cell.id),false,'the cell is used up');
  assert.deepEqual(pack(sim.layout!,mission(),1).map(i => i.id),[]);
  assert.deepEqual(slotsOf(player(1)).filter(Boolean),[lampSlot]);
  sim.act(1,'load');
  sim.act(1,'toggle');
  assert.equal(lamp().on,true);
});

test('the charge survives dropping, trading, throwing, a refresh and the next expedition, and a wipe refills it', () => {
  const {sim,mission,player,at,run,lamp} = crew();
  run(20);
  const left = lamp().charge;
  sim.act(1,'drop');
  at(player(2),lamp()); sim.act(2,'take');
  assert.deepEqual([lamp().owner,lamp().charge],[2,left],'traded with its charge');
  sim.act(2,'throw',{aim:{yaw:0,pitch:0.3,power:0.5}});
  assert.equal(lamp().charge,left,'thrown with its charge');
  // A refresh restores the host from its checkpoint.
  const saved: Snapshot = JSON.parse(JSON.stringify(sim.state));
  const again = new Simulation(sim.layout,'coop','inside');
  again.join(); again.join();
  again.state = saved;
  assert.equal(again.state.lamp.charge,left);
  // The next expedition keeps the battery; only a fresh contract refills it.
  mission().escaped = [1];
  mission().rift = {x:0,z:0,seconds:0.01};
  mission().bell = 1;
  run(0.1);
  assert.equal(mission().stage,'settled');
  const settled = lamp().charge;
  sim.act(1,'next');
  assert.equal(lamp().charge,settled,'carried into the next expedition');
  mission().stage = 'settled'; mission().outcome = 'wipe';
  sim.act(1,'next');
  assert.equal(lamp().charge,undefined,'a fresh contract starts full');
});

test('the expedition clock counts whole seconds while the crew is out, and restarts each expedition', () => {
  const {sim,mission,run} = crew();
  run(2.5);
  assert.equal(mission().clock,2);
  sim.tick(0.2);
  assert.equal(mission().clock,2,'whole seconds only, so a quiet room still sleeps');
  mission().escaped = [1]; mission().rift = {x:0,z:0,seconds:0.01}; mission().bell = 1;
  run(0.1);
  sim.act(1,'next');
  assert.equal(mission().clock,undefined);
});
