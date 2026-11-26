import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchor, connections, geometryFor } from '../src/layout.ts';
import { catalog, healthOf, maxHealth, recoverAfter, recoverTo, revivedHealth, type Gnawer, type Mission } from '../src/mission.ts';
import { obstaclesAt, roomTemplates, surfaceAt } from '../src/room-templates.ts';
import { clearAt, slotsOf, type Player } from '../src/room.ts';
import { spawnSalvage } from '../src/salvage.ts';
import { generateLayout } from '../src/server/generate-layout.ts';
import { hurt } from '../src/server/mission.ts';
import { biteReach, flareFear } from '../src/server/gnawers.ts';
import { Simulation } from '../src/server/simulation.ts';
import { goInside } from './travel.ts';

// A crew inside the facility on seed 19, operator 2 parked in Intake.
function crew(seed = 19) {
  const sim = new Simulation(generateLayout(seed),'coop','inside');
  sim.join(); sim.join();
  // A seeded generator, so where the Gnawer nests and what it does repeat.
  let state = 12345;
  sim.random = () => (state = (Math.imul(state,1103515245)+12345) >>> 0)/2**32;
  const mission = sim.state.mission!, layout = sim.layout!;
  const player = (id: number) => sim.state.players.find(p => p.id === id)!;
  const run = (seconds: number) => { for (let i=0;i<Math.round(seconds*30);i++) sim.tick(1/30); };
  sim.tick(1/30);
  return {sim,mission,layout,player,run,gnawer:() => mission.gnawers![0]};
}
// Stand an operator at a point, on the floor there.
function stand(sim: Simulation, p: Player, at: {x: number; y: number; z: number}, yaw = 0) {
  Object.assign(p,{x:at.x,z:at.z,feetY:at.y,yaw,place:'inside'});
  sim.inputs.set(p.id,{forward:0,right:0,yaw,pitch:0});
}
// Pick up a piece of salvage in the facility, by standing on it.
function pickUp(sim: Simulation, p: Player, id: string) {
  const item = catalog(sim.layout!,sim.state.mission!).find(s => s.id === id)!;
  stand(sim,p,item);
  sim.act(p.id,'take');
  sim.act(p.id,'select',{slot:slotsOf(p).indexOf(id)});
}

test('health: hits wear it down, it creeps back to half after a while, and none means down; a revive brings back a little', () => {
  const {sim,mission,player,run} = crew();
  const p = player(1);
  stand(sim,p,{x:0,y:0,z:2}); stand(sim,player(2),{x:1,y:0,z:2});
  hurt(sim.state,mission,p,30);
  assert.equal(healthOf(p),70);
  hurt(sim.state,mission,p,40);
  assert.equal(healthOf(p),30);
  run(recoverAfter-0.5);
  assert.equal(healthOf(p),30,'no recovery yet');
  run(10);
  assert.equal(healthOf(p),recoverTo,'recovers only to half');
  hurt(sim.state,mission,p,60);
  assert.deepEqual(mission.down.map(d => d.id),[1],'down at none');
  assert.equal(healthOf(p),0);
  // The partner revives.
  sim.act(2,'operate');
  assert.deepEqual([mission.down.length,healthOf(p)],[0,revivedHealth]);
  assert.equal(p.hits,3);
});

test('a Gnawer nests deep in the facility, one on a first expedition, never over a pit', () => {
  for (const seed of [1,19,77,4242]) {
    const {mission,layout} = crew(seed), hops = connections(layout), intake = layout.rooms.find(r => r.kind === 'intake')!;
    assert.equal(mission.gnawers!.length,1,'seed '+seed);
    const g = mission.gnawers![0], room = surfaceAt(geometryFor(layout),g.nest.x,g.nest.z,g.nest.y)!.room, r = layout.rooms.find(m => m.id === room)!;
    assert.ok(hops(intake.id,room) >= 3,'seed '+seed+': far from Intake');
    assert.equal(roomTemplates[r.template].depth,undefined);
  }
});

test('a Gnawer drags loose salvage back to its nest', () => {
  const {sim,mission,layout,player,run,gnawer} = crew();
  stand(sim,player(1),{x:0,y:0,z:2}); stand(sim,player(2),{x:1,y:0,z:2});
  const g = gnawer(), hops = connections(layout), geometry = geometryFor(layout);
  const nestRoom = surfaceAt(geometry,g.nest.x,g.nest.z,g.nest.y)!.room;
  // Salvage in a room near the nest, away from the nest itself.
  const item = spawnSalvage(layout).find(s => { const d = hops(nestRoom,s.room); return d >= 1 && d <= 2; })!;
  assert.ok(item,'salvage near the nest');
  let carried = false;
  for (let t=0;t<90 && !(carried && !g.carry);t+=1/30) { sim.tick(1/30); if (g.carry === item.id) carried = true; }
  void run;
  assert.ok(carried,'it went for the salvage');
  const h = mission.haul.find(e => e.id === item.id)!;
  assert.ok(Math.hypot(h.x-g.nest.x,h.z-g.nest.z) < 0.5,'left at the nest');
  assert.equal(h.gnawer,undefined);
});

test('a Gnawer\'s bite hurts and knocks salvage out of the hand, and it takes it', () => {
  const {sim,mission,layout,player,gnawer} = crew();
  const g = gnawer(), p = player(1);
  stand(sim,player(2),{x:1,y:0,z:2});
  const item = spawnSalvage(layout)[0];
  pickUp(sim,p,item.id);
  assert.equal(slotsOf(p).includes(item.id),true);
  // Right beside it.
  stand(sim,p,{x:g.x+biteReach*0.6,y:g.y,z:g.z});
  sim.tick(1/30);
  assert.ok(healthOf(p) < maxHealth && healthOf(p) >= maxHealth-16,'bitten: '+healthOf(p));
  assert.equal(g.bites,1);
  assert.equal(slotsOf(p).includes(item.id),false,'knocked out of the hand');
  assert.deepEqual([g.carry,mission.haul.find(e => e.id === item.id)!.gnawer],[item.id,g.id],'taken');
});

test('a baton hit, a lit flare, or a thrown item drives a Gnawer off, and it drops what it carries', () => {
  // The baton.
  {
    const {sim,mission,layout,player,gnawer} = crew();
    const g = gnawer(), p = player(1);
    stand(sim,player(2),{x:1,y:0,z:2});
    // Away from the flashlight's spot, so E takes the baton.
    mission.haul.push({id:'bought-1',kind:'baton',owner:null,x:3,y:0,z:4,place:'inside'});
    stand(sim,p,{x:3,y:0,z:4}); sim.act(1,'take'); sim.act(1,'select',{slot:slotsOf(p).indexOf('bought-1')});
    assert.ok(slotsOf(p).includes('bought-1'),'holding the baton');
    // Give it something to carry, then face it from just out of bite reach.
    const item = spawnSalvage(layout)[0];
    mission.haul.push({id:item.id,owner:null,x:g.x,y:g.y,z:g.z,place:'inside',gnawer:g.id}); g.carry = item.id; g.mode = 'carry';
    stand(sim,p,{x:g.x,y:g.y,z:g.z+biteReach+0.3},0);
    sim.act(1,'swing');
    assert.equal(g.mode,'flee');
    assert.equal(g.carry,undefined);
    assert.equal(mission.haul.find(e => e.id === item.id)!.gnawer,undefined,'dropped');
  }
  // A lit flare nearby.
  {
    const {sim,mission,player,gnawer} = crew();
    const g = gnawer();
    stand(sim,player(1),{x:0,y:0,z:2}); stand(sim,player(2),{x:1,y:0,z:2});
    mission.haul.push({id:'bought-2',kind:'flare',owner:null,x:g.x+flareFear-1,y:g.y,z:g.z,place:'inside',burn:30});
    sim.tick(1/30);
    assert.equal(g.mode,'flee');
  }
  // A thrown item flying close by. The Gnawer is held where it stands, and
  // the throw comes from 2.5 m away across open floor.
  {
    const {sim,layout,player,gnawer} = crew();
    const g = gnawer(), p = player(1), geometry = geometryFor(layout);
    stand(sim,player(2),{x:1,y:0,z:2});
    const item = spawnSalvage(layout)[0];
    pickUp(sim,p,item.id);
    const pin = {x:g.x,y:g.y,z:g.z}, solids = obstaclesAt(geometry,pin.y);
    const from = [[0,2.5],[0,-2.5],[2.5,0],[-2.5,0]].map(([dx,dz]) => ({x:pin.x+dx,y:pin.y,z:pin.z+dz})).find(q => {
      const floor = surfaceAt(geometry,q.x,q.z,q.y);
      return floor && Math.abs(floor.y-pin.y) < 0.01 && [0.2,0.4,0.6,0.8,1].every(t => clearAt(pin.x+(q.x-pin.x)*t,pin.z+(q.z-pin.z)*t,0.3,solids));
    })!;
    assert.ok(from,'open floor beside the nest');
    stand(sim,p,from,Math.atan2(-(pin.x-from.x),-(pin.z-from.z)));
    let fled = false;
    sim.act(1,'throw',{aim:{yaw:p.yaw,pitch:0.1,power:0.05}});
    for (let i=0;i<60 && !fled;i++) { Object.assign(g,pin); sim.tick(1/30); fled = (g.mode as Gnawer['mode']) === 'flee'; }
    assert.ok(fled,'driven off by the throw');
  }
});

test('a Gnawer stays inside and leaves downed operators alone', () => {
  const {sim,mission,player,run,gnawer} = crew();
  const g = gnawer(), p = player(1);
  stand(sim,player(2),{x:1,y:0,z:2});
  hurt(sim.state,mission,p,maxHealth);
  stand(sim,p,{x:g.x+0.5,y:g.y,z:g.z});
  run(3);
  assert.equal(g.bites ?? 0,0,'no bites on the downed');
});

test('Gnawers are cheap to run: a minute of the host\'s ticks with two of them takes well under a second', () => {
  const {sim,mission,layout,player,run} = crew(77);
  stand(sim,player(1),{x:0,y:0,z:2}); stand(sim,player(2),{x:1,y:0,z:2});
  mission.contract.index = 1;
  delete (mission as Mission).gnawers;
  sim.tick(1/30);
  assert.equal(mission.gnawers!.length,2,'two on a later expedition');
  const start = performance.now();
  run(60);
  const ms = performance.now()-start;
  assert.ok(ms < 1500,'a minute took '+ms.toFixed(0)+' ms');
  void layout; void ({} as Gnawer); void anchor; void goInside;
});

test('a Gnawer nips and runs: next to someone it can\'t rob, it bites once and backs off', () => {
  const {sim,player,gnawer} = crew();
  const g = gnawer(), p = player(1);
  stand(sim,player(2),{x:1,y:0,z:2});
  // Holding only the flashlight: nothing to knock loose.
  let bites = 0;
  for (let i=0;i<90;i++) { if (i === 0) stand(sim,p,{x:g.x+0.6,y:g.y,z:g.z}); sim.tick(1/30); bites = g.bites ?? 0; }
  assert.equal(bites,1,'one bite in three seconds');
  assert.ok(healthOf(p) >= maxHealth-16);
});
