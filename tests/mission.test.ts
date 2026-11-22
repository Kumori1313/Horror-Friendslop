import assert from 'node:assert/strict';
import { test } from 'node:test';
import { station, strikeRadius } from '../src/mission.ts';
import { generateLayout } from '../src/server/generate-layout.ts';
import { Simulation } from '../src/server/simulation.ts';

function shift(seed = 19) {
  const layout = generateLayout(seed);
  const sim = new Simulation(layout);
  sim.join(); sim.join();
  const [carrier,partner] = sim.state.players;
  const mission = sim.state.mission!;
  const relay = station(layout,'relay'), intake = station(layout,'intake'), exit = station(layout,'exit');
  const move = (p: typeof carrier, to: {x:number;y?:number;z:number}) => { p.x = to.x; p.z = to.z; p.feetY = to.y ?? p.feetY; };
  function power() {
    sim.act(carrier.id,'take');
    move(carrier,relay); move(partner,intake);
    sim.act(carrier.id,'operate');
    sim.act(partner.id,'operate');
    assert.equal(mission.stage,'extract');
  }
  function tick(seconds: number) { for (let i=0;i<Math.ceil(seconds*30);i++) sim.tick(1/30); }
  return {sim,mission,carrier,partner,relay,intake,exit,move,power,tick};
}

test('two live operators must work separate stations with the lit lamp and reunite to extract', () => {
  const {sim,carrier,partner,relay,intake,exit,mission,move,tick} = shift();
  sim.act(carrier.id,'take'); sim.act(carrier.id,'operate');
  assert.equal(mission.stage,'trace');
  move(carrier,relay);
  sim.act(carrier.id,'toggle'); sim.act(carrier.id,'operate');
  assert.equal(mission.stage,'trace');
  sim.act(carrier.id,'toggle'); sim.act(carrier.id,'operate');
  assert.equal(mission.stage,'answer');
  sim.act(partner.id,'operate');
  assert.equal(mission.stage,'answer');
  move(partner,intake); carrier.connected = false; sim.act(partner.id,'operate');
  assert.equal(mission.stage,'answer');
  carrier.connected = true; sim.act(partner.id,'operate');
  assert.equal(mission.diver.mode,'warning');
  move(carrier,exit); tick(6); sim.act(carrier.id,'operate');
  assert.equal(mission.stage,'extract');
  move(partner,exit); sim.act(partner.id,'operate');
  assert.equal(mission.stage,'won');
  const result = structuredClone(mission);
  sim.act(carrier.id,'toggle'); tick(100); sim.leave(partner.id);
  assert.deepEqual(mission,result);
});

test('warning precedes a marked strike, downed operators drop the light and can be rescued', () => {
  const {sim,carrier,partner,relay,mission,move,power,tick} = shift();
  power(); tick(3);
  assert.equal(mission.down.length,0);
  tick(2);
  assert.equal(mission.down[0].id,carrier.id);
  assert.equal(sim.state.lamp.owner,null);
  sim.act(carrier.id,'take');
  sim.inputs.set(carrier.id,{forward:1,right:0,yaw:0,pitch:0}); tick(1);
  assert.equal(carrier.z,relay.z); assert.equal(sim.state.lamp.owner,null);
  sim.act(partner.id,'operate');
  assert.equal(mission.down.length,1);
  move(partner,relay); sim.act(partner.id,'operate');
  assert.equal(mission.down.length,0);
  sim.act(carrier.id,'take'); assert.equal(sim.state.lamp.owner,carrier.id);
});

test('missing a rescue or taking a strike together ends the round; a new facility starts fresh', () => {
  const first = shift(); first.power(); first.tick(6);
  first.move(first.partner,{x:first.intake.x+strikeRadius+0.5,z:first.intake.z});
  first.tick(76); assert.equal(first.mission.stage,'lost');
  const second = shift(); second.power();
  second.move(second.partner,second.relay); second.tick(5);
  assert.equal(second.mission.stage,'lost'); assert.equal(second.mission.down.length,2);
  const next = new Simulation(generateLayout(715));
  assert.notEqual(next.state.round,second.sim.state.round);
  assert.notDeepEqual(next.layout?.rooms,second.sim.layout?.rooms);
  assert.equal(next.state.mission?.stage,'trace'); assert.deepEqual(next.state.mission?.down,[]);
  assert.equal(new Simulation().state.mission,undefined);
});

test('black start requires priming and answering at the switchboard with a live relay carrier', () => {
  const {sim,mission,carrier,partner,relay,intake,exit,move} = shift(20);
  const board = station(sim.layout!,'switchboard');
  sim.act(carrier.id,'take');
  move(carrier,relay); sim.act(carrier.id,'operate');
  assert.equal(mission.stage,'prime');
  move(partner,board); sim.act(partner.id,'operate');
  assert.equal(mission.stage,'trace');
  sim.act(carrier.id,'operate');
  move(partner,intake); sim.act(partner.id,'operate');
  assert.equal(mission.stage,'answer');
  move(partner,board); sim.act(partner.id,'operate');
  assert.equal(mission.stage,'extract');
  move(partner,exit); move(carrier,exit); sim.act(partner.id,'operate');
  assert.equal(mission.stage,'won');
});

test('diver advances along the ceiling before warning at the new target bay', () => {
  const {sim,mission,carrier,exit,move,power,tick} = shift();
  power(); move(carrier,exit); tick(6);
  let previous = mission.diver.bay;
  for (let frame=0; frame<1200 && mission.diver.mode !== 'warning'; frame++) {
    sim.tick(1/30);
    if (mission.diver.bay !== previous) {
      const next = mission.diver.bay;
      assert.ok(sim.layout!.passages.some(e => [e.a,e.b].includes(previous) && [e.a,e.b].includes(next)));
      previous = next;
      assert.equal(mission.diver.mode,'tracking');
    }
  }
  assert.equal(mission.diver.mode,'warning');
  assert.equal(mission.diver.bay,exit.id);
  assert.equal(mission.down.length,0);
});

for (const seed of [19,20]) {
  test('one solo operator can power the facility and extract on seed '+seed, () => {
    const layout = generateLayout(seed);
    const sim = new Simulation(layout,'solo');
    assert.equal(sim.join(),1);
    assert.equal(sim.join(2),undefined);
    const player = sim.state.players[0], mission = sim.state.mission!;
    const move = (kind: Parameters<typeof station>[1]) => {
      const {x,y,z} = station(layout,kind);
      Object.assign(player,{x,z,feetY:y});
    };
    sim.act(1,'take');
    if (layout.callout === 'black-start') {
      move('relay'); sim.act(1,'operate'); assert.equal(mission.stage,'prime');
      move('switchboard'); sim.act(1,'operate'); assert.equal(mission.stage,'trace');
    }
    move('exit'); sim.act(1,'operate'); assert.equal(mission.stage,'trace');
    move('relay'); sim.act(1,'toggle'); sim.act(1,'operate'); assert.equal(mission.stage,'trace');
    sim.act(1,'toggle'); sim.act(1,'operate');
    assert.equal(mission.stage,'extract'); assert.equal(mission.diver.mode,'warning');
    move('exit'); sim.act(1,'operate'); assert.equal(mission.stage,'won');
  });
}

test('a solo strike ends immediately and a lone co-op seat still needs its partner',() => {
  const layout = generateLayout(19);
  for (const mode of ['solo','coop'] as const) {
    const sim = new Simulation(layout,mode);
    sim.join(1); sim.act(1,'take');
    const relay = station(layout,'relay');
    Object.assign(sim.state.players[0],{x:relay.x,z:relay.z,feetY:relay.y});
    sim.act(1,'operate');
    for (let i=0;i<160;i++) sim.tick(1/30);
    assert.equal(sim.state.mission!.stage,mode === 'solo' ? 'lost' : 'answer');
  }
});
