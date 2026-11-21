import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { blockers, geometryFor, nearbyDoor, validLayout, generatorVersion, nextWiredBay, distances } from '../src/layout.ts';
import { clearAt } from '../src/room.ts';
import { generateLayout } from '../src/server/generate-layout.ts';
import { Simulation } from '../src/server/simulation.ts';

test('1,000 repeatable seeds produce traversable, varied floor plans', t => {
  const topologies = new Set<string>(), fallback: number[] = [], failures: number[] = [];
  for (let seed=0;seed<1000;seed++) {
    const plan = generateLayout(seed);
    if (!validLayout(plan)) failures.push(seed);
    const steps = distances(plan.rooms,plan.passages,plan.exitId);
    for (const bay of plan.rooms.filter(r => r.id !== plan.exitId)) {
      const next = nextWiredBay(plan,bay.id,plan.exitId);
      assert.ok(plan.passages.some(e => (e.a === bay.id && e.b === next) || (e.b === bay.id && e.a === next)));
      assert.equal(steps.get(next),steps.get(bay.id)!-1);
    }
    if (plan.fallback) fallback.push(seed);
    const points = new Map(plan.rooms.map(r=>[r.id,r.x+','+r.z]));
    topologies.add(plan.passages.map(e=>[points.get(e.a),points.get(e.b)].sort().join('/')).sort().join(';'));
  }
  if (failures.length || fallback.length) {
    mkdirSync('test-results',{recursive:true});
    writeFileSync('test-results/layout-seeds.json',JSON.stringify({version:generatorVersion,failures,fallback},null,2)+'\n');
  }
  t.diagnostic(topologies.size+' unique route graphs; '+fallback.length+'/1000 fallbacks');
  assert.deepEqual(failures,[]);
  assert.ok(fallback.length<10,'Fallback frequency exceeded the 1% budget; see test-results/layout-seeds.json');
  assert.ok(topologies.size>950);
  assert.notDeepEqual(generateLayout(19).rooms.map(r=>[r.x,r.z]),generateLayout(715).rooms.map(r=>[r.x,r.z]));
  for (const seed of [0,19,715,0xffffffff]) assert.deepEqual(generateLayout(seed),generateLayout(seed));
});

test('known fallback is playable and invalid socket geometry is rejected', () => {
  const plan = generateLayout(42,0);
  assert.equal(plan.fallback,true);
  assert.ok(validLayout(plan));
  const moved = structuredClone(plan);
  moved.rooms[1].x = moved.rooms[0].x; moved.rooms[1].z = moved.rooms[0].z;
  assert.equal(validLayout(moved),false);
  const blocked = structuredClone(plan);
  blocked.passages.pop();
  assert.equal(validLayout(blocked),false);
});

test('closed bulkheads stop movement; opening one changes authoritative collision for both seats', () => {
  const plan = generateLayout(19), g = geometryFor(plan);
  const sim = new Simulation(plan);
  const id = sim.join()!, second = sim.join()!;
  const d = g.doors[0];
  sim.act(id,'open-door');
  assert.deepEqual(sim.state.opened,[]);
  for (const who of [id,second]) sim.inputs.set(who,{forward:1,right:0,yaw:0,pitch:0});
  for (let n=0;n<100;n++) sim.tick(1/30);
  assert.ok(sim.state.players.every(p=>p.z>d.z && nearbyDoor(p,g,[])?.id===d.id));
  assert.equal(clearAt(d.x,d.z,0.25,blockers(g,[])),false);
  sim.act(second,'open-door');
  assert.deepEqual(sim.state.opened,[d.id]);
  for (let n=0;n<20;n++) sim.tick(1/30);
  assert.ok(sim.state.players.every(p=>p.z<d.z));
  assert.equal(clearAt(d.x,d.z,0.25,sim.obstacles),true);
});
