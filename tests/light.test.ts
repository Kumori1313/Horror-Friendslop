import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lampSpawn, powered } from '../src/layout.ts';
import { items, pack } from '../src/mission.ts';
import { batteryLife, chargeOf, lampSlot, slotsOf } from '../src/room.ts';
import type { Player, Snapshot } from '../src/room.ts';
import { facilityValue, spawnSalvage } from '../src/salvage.ts';
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
// A spare cell can only be bought; until the shop, put one on the floor as a
// purchase would, with its kind on its haul entry.
function buyCell(sim: Simulation, at: {x: number; y: number; z: number}, id = 'bought-cell-1') {
  sim.state.mission!.haul.push({id,kind:'cell',owner:null,x:at.x,y:at.y,z:at.z,place:'inside'});
  return {id};
}

test('Intake is lit, corridors, stairwells and the service tunnel are dark, and about half the other rooms have power', () => {
  let rooms = 0, lit = 0;
  for (let seed=1;seed<=40;seed++) {
    const layout = generateLayout(seed);
    for (const r of layout.rooms) {
      const on = powered(layout,r.id);
      assert.equal(on,powered(layout,r.id),'the same every time');
      if (r.kind === 'intake') assert.equal(on,true);
      else if (r.kind === 'corridor' || r.kind === 'stairwell' || r.template === 'tunnel' || r.template.startsWith('spire-')) assert.equal(on,false);
      else { rooms++; if (on) lit++; }
    }
  }
  assert.ok(lit/rooms > 0.35 && lit/rooms < 0.65,'about half: '+lit+' of '+rooms);
});

test('spare cells are only ever bought: no facility spawns one, and they add nothing to the quota', () => {
  for (let seed=1;seed<=60;seed++) {
    const layout = generateLayout(seed);
    assert.equal(spawnSalvage(layout).some(i => i.kind === 'cell'),false,'seed '+seed);
  }
  const {sim,mission} = crew();
  buyCell(sim,{x:0,y:0,z:0});
  const bought = items(sim.layout!,mission()).find(i => i.id === 'bought-cell-1')!;
  assert.deepEqual([bought.kind,bought.value],['cell',0]);
  assert.equal(facilityValue(sim.layout!),spawnSalvage(sim.layout!).reduce((s,i) => s+i.value,0));
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
  const cell = buyCell(sim,{x:player(2).x,y:player(2).feetY ?? 0,z:player(2).z});
  sim.act(2,'take');
  assert.equal(mission().awake,undefined,'a bought cell is not salvage: picking it up wakes nothing');
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
