import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { anchor, distances, generatorVersion, geometryFor, nearbyDoor, nextWiredBay, routeReach, validLayout, walkable } from '../src/layout.ts';
import type { Layout } from '../src/layout.ts';
import { obstaclesAt, roomTemplates, storey } from '../src/room-templates.ts';
import { maxPerRoom, spawnSalvage } from '../src/salvage.ts';
import { clearAt } from '../src/room.ts';
import { generateFactoryLayout as generateLayout } from '../src/server/generate-layout.ts';
import { Simulation } from '../src/server/simulation.ts';
import { route } from '../src/route.ts';
import { walkRoute } from './walk.ts';

const linkedSocket = (plan: Layout, id: string) => {
  const p = plan.passages.find(e => e.a === id || e.b === id)!;
  return p.a === id ? p.from : p.to;
};

test('1,000 repeatable seeds build traversable two-storey facilities from unique rooms', t => {
  const topologies = new Set<string>(), fallback: number[] = [], failures: number[] = [];
  const counts = {rooms:[] as number[],destinations:[] as number[],upper:[] as number[],stairs:[] as number[],loops:[] as number[]};
  for (let seed=0;seed<1000;seed++) {
    const plan = generateLayout(seed);
    if (!validLayout(plan)) failures.push(seed);
    if (plan.fallback) fallback.push(seed);
    const destinations = plan.rooms.filter(r => r.kind !== 'corridor' && r.kind !== 'stairwell');
    // Unique destinations, both storeys in use, and stairs that join them.
    assert.equal(new Set(destinations.map(r => r.template)).size,destinations.length);
    assert.ok(destinations.some(r => r.y === storey) && destinations.some(r => r.y === 0));
    const stairs = plan.rooms.filter(r => r.kind === 'stairwell');
    assert.ok(stairs.length >= 1);
    for (const s of stairs) {
      const ends = plan.passages.flatMap(p => [p.a === s.id ? p.from : '',p.b === s.id ? p.to : '']);
      assert.ok(ends.some(e => e.startsWith('upper')) && ends.some(e => e.startsWith('lower')),'stairwell '+s.id+' joins both storeys');
    }
    // Every loot room has a walking route back to base through doors and stairs.
    for (const room of destinations.filter(r => roomTemplates[r.template].loot)) {
      assert.ok(routeReach(plan,room.id,linkedSocket(plan,room.id)).has('intake'),'seed '+seed+': '+room.id+' cannot reach Intake');
    }
    const steps = distances(plan.rooms,plan.passages,'intake');
    for (const bay of plan.rooms.filter(r => r.id !== 'intake')) {
      const next = nextWiredBay(plan,bay.id,'intake');
      assert.equal(steps.get(next),steps.get(bay.id)!-1);
    }
    counts.rooms.push(plan.rooms.length); counts.destinations.push(destinations.length);
    counts.upper.push(destinations.filter(r => r.y === storey).length); counts.stairs.push(stairs.length);
    counts.loops.push(plan.passages.length-plan.rooms.length+1);
    topologies.add(plan.rooms.map(r => r.template+'@'+r.x+','+r.y+','+r.z+'/'+r.turn).sort().join(';'));
  }
  if (failures.length || fallback.length) {
    mkdirSync('test-results',{recursive:true});
    writeFileSync('test-results/layout-seeds.json',JSON.stringify({version:generatorVersion,failures,fallback},null,2)+'\n');
  }
  const span = (v: number[]) => Math.min(...v)+'–'+Math.max(...v);
  t.diagnostic(topologies.size+' unique facilities; '+fallback.length+'/1000 fallbacks; rooms '+span(counts.rooms)+
    ', destinations '+span(counts.destinations)+', upper destinations '+span(counts.upper)+', stairwells '+span(counts.stairs)+
    ', loops '+span(counts.loops));
  assert.deepEqual(failures,[]);
  assert.ok(fallback.length<10,'Fallback frequency exceeded the 1% budget; see test-results/layout-seeds.json');
  assert.ok(topologies.size>990);
  assert.ok(Math.min(...counts.destinations) > 12,'more destinations than the old 12–15 bays');
  for (const seed of [0,19,715,0xffffffff]) assert.deepEqual(generateLayout(seed),generateLayout(seed));
});

test('every facility can be walked on the real geometry from the spawn to each room, and from loot to the exit', t => {
  // Per room: never more than two items, and two only rarely.
  const loot = [0,0,0], other = [0,0,0];
  t.after(() => {
    const share = (a: number[]) => a[2]/(a[0]+a[1]+a[2]);
    t.diagnostic('two-item rooms: loot '+(100*share(loot)).toFixed(1)+'%, other '+(100*share(other)).toFixed(1)+'%');
  });
  for (let seed=0;seed<1000;seed++) {
    const plan = generateLayout(seed), g = geometryFor(plan);
    const reached = walkable(g,{x:-0.7,y:0,z:3},g.doors.map(d => d.id));
    for (const room of plan.rooms) assert.ok(reached(anchor(room)),'seed '+seed+': cannot walk to '+room.id);
    // Every salvage spot shares the spawn's walkable region, so it can be hauled back to base.
    const salvage = spawnSalvage(plan);
    for (const item of salvage) assert.ok(reached(item),'seed '+seed+': cannot walk to '+item.id);
    for (const room of plan.rooms) {
      if (['intake','corridor','stairwell'].includes(room.kind)) continue;
      const count = salvage.filter(i => i.room === room.id).length;
      assert.ok(count <= maxPerRoom,'seed '+seed+': '+room.id+' holds '+count);
      if (roomTemplates[room.template].loot) { assert.ok(count >= 1,'seed '+seed+': empty loot room '+room.id); loot[count]++; }
      else other[count]++;
    }
    if (seed % 40) continue;
    // Intake's closed bulkhead holds the crew in base until someone opens it.
    const sealed = walkable(g,{x:-0.7,y:0,z:3});
    assert.ok(plan.rooms.filter(r => r.id !== 'intake').every(r => !sealed(anchor(r))));
  }
  const share = (a: number[]) => a[2]/(a[0]+a[1]+a[2]);
  assert.ok(share(loot) > 0.2 && share(loot) < 0.4,'loot rooms hold two items about 30% of the time');
  assert.ok(share(other) < 0.1,'other rooms rarely hold two items');
});

test('the fallback is playable, and overlapping or disconnected plans are rejected', () => {
  const plan = generateLayout(42,0);
  assert.equal(plan.fallback,true);
  assert.ok(validLayout(plan));
  const moved = structuredClone(plan);
  const store = moved.rooms.find(r => r.kind !== 'intake' && r.kind !== 'corridor')!;
  Object.assign(store,{x:moved.rooms[0].x,y:0,z:moved.rooms[0].z});
  assert.equal(validLayout(moved),false);
  const blocked = structuredClone(plan);
  blocked.passages = blocked.passages.slice(1);
  assert.equal(validLayout(blocked),false);
  const twin = structuredClone(plan);
  twin.rooms.find(r => r.kind === 'workshop' || r.kind === 'stores' || r.kind === 'closet' || r.kind === 'office' || r.kind === 'lockers' || r.kind === 'coldstore')!.template = 'relay';
  assert.equal(validLayout(twin),false);
});

test('closed bulkheads stop movement; opening one changes authoritative collision for both seats', () => {
  const plan = generateLayout(19), g = geometryFor(plan);
  const sim = new Simulation(plan,'coop','inside');
  const id = sim.join()!, second = sim.join()!;
  const d = g.doors[0];
  assert.deepEqual([d.x,d.z],[0,-2]);
  sim.act(id,'open-door');
  assert.deepEqual(sim.state.opened,[]);
  for (const who of [id,second]) sim.inputs.set(who,{forward:1,right:0,yaw:0,pitch:0});
  for (let n=0;n<100;n++) sim.tick(1/30);
  assert.ok(sim.state.players.every(p=>p.z>d.z && nearbyDoor(p,g,[])?.id===d.id));
  assert.equal(clearAt(d.x,d.z,0.25,obstaclesAt(g,0)),false);
  sim.act(second,'open-door');
  assert.deepEqual(sim.state.opened,[d.id]);
  for (let n=0;n<20;n++) sim.tick(1/30);
  assert.ok(sim.state.players.every(p=>p.z<d.z));
  assert.equal(clearAt(d.x,d.z,0.25,obstaclesAt(g,0,sim.state.opened)),true);
});

test('every salvage item has a centred walking route from the spawn', () => {
  for (let seed=0;seed<1000;seed+=10) {
    const plan = generateLayout(seed);
    for (const item of spawnSalvage(plan)) {
      assert.ok(route(plan,{x:-0.7,y:0,z:3},item,undefined,1),'seed '+seed+': no route to '+item.id);
    }
  }
});

test('a route can stop near a tight goal and keep its wide clearance', () => {
  const plan = generateLayout(19), g = geometryFor(plan);
  // A point hard against a doorway jamb only allows a cramped route.
  const o = g.openings.find(o => o.side === 'north' && o.y === 0)!;
  const tight = {x:o.x+0.9,y:o.y,z:o.z+0.4};
  const exact = route(plan,{x:-0.7,y:0,z:3},tight)!, loose = route(plan,{x:-0.7,y:0,z:3},tight,undefined,1)!;
  assert.ok(exact && loose);
  const end = loose.at(-1)!;
  assert.ok(Math.hypot(end.x-tight.x,end.z-tight.z) <= 1 && end.y === tight.y);
  assert.ok(route(plan,{x:-0.7,y:0,z:3},tight,[0.85],1),'the wide margin reaches the neighbourhood');
});

test('an operator walks the planned route through doors and stairs to loot rooms and back to base', () => {
  for (const seed of [19,20,715,4242]) {
    const plan = generateLayout(seed);
    const sim = new Simulation(plan,'solo','inside');
    sim.join(1);
    const loot = plan.rooms.filter(r => roomTemplates[r.template].loot).slice(0,2);
    for (const room of [...loot,plan.rooms.find(r => r.kind === 'intake')!]) {
      const target = anchor(room);
      const p = walkRoute(sim,1,target);
      assert.equal(sim.roomOf(p),room.id,'seed '+seed+' reached '+room.id);
      assert.equal(p.feetY,target.y);
    }
  }
});
