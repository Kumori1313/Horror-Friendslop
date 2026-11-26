import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatOn, healthOf, maxHealth, type Stalker } from '../src/mission.ts';
import { groundAt, outdoors } from '../src/places.ts';
import { deep } from '../src/layout.ts';
import type { Player } from '../src/room.ts';
import { generateLayout } from '../src/server/generate-layout.ts';
import { chargeDamage, clearRun, firstAfter, every, flareKeep, flatTime, inSight, openGround } from '../src/server/stalkers.ts';
import { Simulation } from '../src/server/simulation.ts';

// Operators outdoors on the first seed from 19 with an arena (below),
// operator 2 by the main door.
function field(seed = 19): ReturnType<typeof setup> {
  const found = setup(seed);
  return found.arena || seed > 60 ? found : field(seed+1);
}
function setup(seed: number) {
  const layout = generateLayout(seed), sim = new Simulation(layout,'coop','inside');
  sim.join(); sim.join();
  let state = 4242;
  sim.random = () => (state = (Math.imul(state,1103515245)+12345) >>> 0)/2**32;
  const mission = sim.state.mission!, map = outdoors(seed);
  const player = (id: number) => sim.state.players.find(p => p.id === id)!;
  const put = (p: Player, x: number, z: number, yaw = 0) => { Object.assign(p,{place:'outside',x,z,feetY:groundAt(map,x,z),yaw}); delete p.vy; sim.inputs.set(p.id,{forward:0,right:0,yaw,pitch:0}); };
  put(player(2),map.exit.x,map.exit.z);
  put(player(1),map.exit.x+1,map.exit.z);
  sim.tick(1/30);
  const run = (seconds: number, each?: () => void) => { for (let i=0;i<Math.round(seconds*30);i++) { sim.tick(1/30); each?.(); } };
  // A stalker of our own, `mode` roam unless given.
  const place = (x: number, z: number, yaw = 0, mode: Stalker['mode'] = 'roam') => { mission.stalkers = [{id:1,x,y:groundAt(map,x,z),z,yaw,mode}]; return mission.stalkers[0]; };
  // Open ground, within 2 m of level, from 6 m west of `arena` to 20 m east and 8 m
  // either side, nothing within 30 m of the building, and all of it east of
  // 4 m in sight from `arena`: room to charge, dodge and back off.
  let arena: {x: number; z: number} | undefined;
  for (let x=-60;x<=40 && !arena;x+=2) for (let z=-60;z<=60 && !arena;z+=2) {
    const b = map.building, base = groundAt(map,x,z);
    if (Math.abs(x+6-b.x) < b.w/2+30 && Math.abs(z-b.z) < b.d/2+30) continue;
    let level = true;
    for (let dx=-6;dx<=20 && level;dx+=2) for (let dz=-8;dz<=8 && level;dz+=2) level = openGround(layout,x+dx,z+dz) && Math.abs(groundAt(map,x+dx,z+dz)-base) < 2;
    if (!level || !clearRun(layout,{x,z},{x:x+12,z})) continue;
    for (let dx=4;dx<=20 && level;dx+=2) for (let dz=-8;dz<=8 && level;dz+=2) level = inSight(layout,{x,y:base,z},{x:x+dx,y:groundAt(map,x+dx,z+dz),z:z+dz});
    if (!level) continue;
    arena = {x,z};
  }
  return {layout,sim,mission,map,player,put,run,place,arena:arena!};
}

test('none come at first; the first after three minutes, inside or out, one more every two, up to three; the bell sends one more', () => {
  const {sim,mission,map,player,run} = field();
  const keepUp = () => { mission.down = []; delete mission.flat; for (const p of sim.state.players) p.hp = maxHealth; };
  const spawned: {x: number; z: number}[] = [];
  const watch = () => {
    keepUp();
    for (const s of mission.stalkers ?? []) if (!spawned[s.id-1]) {
      spawned[s.id-1] = {x:s.x,z:s.z};
      const far = sim.state.players.filter(p => p.place === 'outside').map(p => ({x:p.x,z:p.z}));
      for (const p of far.length ? far : [map.exit]) assert.ok(Math.hypot(p.x-s.x,p.z-s.z) >= 45,'stalker '+s.id+' arrives far off');
      assert.ok(!deep(map.geometry,s.x,s.z,s.y),'not in the river');
    }
  };
  // Time inside counts: the first arrives while the crew is in the
  // facility, far from the main door.
  for (const p of sim.state.players) p.place = 'inside';
  run(firstAfter-2,watch);
  assert.equal(mission.stalkers?.length ?? 0,0,'none yet');
  run(3,watch);
  assert.equal(mission.stalkers?.length,1,'the first, while inside');
  for (const p of sim.state.players) p.place = 'outside';
  run(every,watch);
  assert.equal(mission.stalkers?.length,2,'the second');
  run(every,watch);
  assert.equal(mission.stalkers?.length,3,'the third');
  run(every+30,watch);
  assert.equal(mission.stalkers?.length,3,'no more than three');
  mission.enraged = true;
  run(0.1,watch);
  assert.equal(mission.stalkers?.length,4,'the bell brings one more');
  void player;
});

test('it sees someone in the open, winds up and charges: 50 damage and knocked flat for a moment', () => {
  const {sim,mission,player,put,run,place,arena} = field();
  assert.ok(arena,'an open stretch');
  const me = player(1);
  put(me,arena.x+12,arena.z);
  place(arena.x,arena.z,-Math.PI/2);
  let wound = false;
  for (let i=0;i<180 && healthOf(me) === maxHealth;i++) { sim.tick(1/30); wound ||= mission.stalkers![0].mode === 'windup'; }
  assert.ok(wound,'it wound up');
  assert.equal(healthOf(me),maxHealth-chargeDamage);
  assert.ok(flatOn(mission,1),'knocked flat');
  // Flat: no walking until they get up.
  const at = {x:me.x,z:me.z};
  sim.inputs.set(1,{forward:1,right:0,yaw:0,pitch:0});
  run(0.5);
  assert.ok(Math.hypot(me.x-at.x,me.z-at.z) < 0.01,'still flat');
  run(flatTime);
  assert.ok(!flatOn(mission,1));
  assert.ok(Math.hypot(me.x-at.x,me.z-at.z) > 1,'up and walking');
  assert.equal(healthOf(me),maxHealth-chargeDamage,'time to get away before it charges again');
});

test('stepping aside as it sets off dodges the charge; it wheels round and comes again', () => {
  const {sim,mission,player,put,run,place,arena} = field();
  const me = player(1);
  put(me,arena.x+12,arena.z,Math.PI/2);
  const s = place(arena.x,arena.z,-Math.PI/2);
  for (let i=0;i<180 && s.mode !== 'windup';i++) sim.tick(1/30);
  assert.equal(s.mode,'windup','it wound up');
  // It aims as it sets off: stepping aside then (facing west, toward it,
  // right is north) takes them out of its path.
  const mode = (): Stalker['mode'] => s.mode;
  for (let i=0;i<60 && mode() !== 'charge';i++) sim.tick(1/30);
  assert.equal(mode(),'charge');
  sim.inputs.set(1,{forward:0,right:1,yaw:Math.PI/2,pitch:0});
  let recovered = false;
  run(3,() => { recovered ||= s.mode === 'recover'; });
  sim.inputs.set(1,{forward:0,right:0,yaw:Math.PI/2,pitch:0});
  assert.equal(healthOf(me),maxHealth,'missed');
  assert.ok(recovered,'it stumbled round');
  let again = false;
  run(8,() => { again ||= (s.charges ?? 0) >= 2; });
  assert.ok(again,'and came again');
  void mission;
});

test('cover breaks its sight: someone behind the building is not seen', () => {
  const {layout,map,player,put,run,place} = field();
  const b = map.building, me = player(1);
  const west = {x:b.x-b.w/2-4,z:b.z}, east = {x:b.x+b.w/2+4,z:b.z};
  assert.equal(inSight(layout,{...west,y:groundAt(map,west.x,west.z)},{...east,y:groundAt(map,east.x,east.z)}),false);
  put(me,east.x,east.z);
  const s = place(west.x,west.z);
  run(1.5);
  assert.notEqual(s.mode,'stalk');
  assert.notEqual(s.mode,'windup');
});

test('a baton hit or a thrown item stuns it and drives it off', () => {
  for (const how of ['baton','throw'] as const) {
    const {sim,mission,player,put,run,place,arena} = field();
    const me = player(1);
    put(me,arena.x+12,arena.z,Math.PI/2);
    const s = place(arena.x+(how === 'baton' ? 10.5 : 7),arena.z,-Math.PI/2,'stalk');
    if (how === 'baton') {
      mission.haul.push({id:'bought-1',kind:'baton',owner:1,x:0,y:0,z:0,place:'outside'});
      me.slots = ['bought-1',null,null,null]; me.hand = 0;
      sim.act(1,'swing');
    } else {
      mission.haul.push({id:'bought-2',kind:'cell',owner:1,x:0,y:0,z:0,place:'outside'});
      me.slots = ['bought-2',null,null,null]; me.hand = 0;
      sim.act(1,'throw',{aim:{yaw:Math.PI/2,pitch:0.15,power:0.5}});
      for (let i=0;i<60 && s.mode !== 'stunned';i++) sim.tick(1/30);
    }
    assert.equal(s.mode,'stunned',how);
    const near = Math.hypot(s.x-me.x,s.z-me.z);
    run(5);
    assert.equal(healthOf(me),maxHealth,how+': unhurt');
    assert.ok(Math.hypot(s.x-me.x,s.z-me.z) > near+2,how+': backed off');
  }
});

test('a lit flare keeps it off', () => {
  const {sim,mission,player,put,run,place,arena} = field();
  const me = player(1);
  put(me,arena.x+12,arena.z);
  mission.haul.push({id:'bought-1',kind:'flare',owner:null,x:me.x,y:me.feetY ?? 0,z:me.z,place:'outside',burn:60});
  const s = place(arena.x,arena.z,-Math.PI/2);
  let closest = Infinity;
  run(12,() => { closest = Math.min(closest,Math.hypot(s.x-me.x,s.z-me.z)); });
  assert.equal(healthOf(me),maxHealth);
  assert.ok(closest > flareKeep-1.5,'kept off: '+closest.toFixed(1)+' m');
  void sim;
});

test('roaming, it keeps to open ground out of the river and comes toward the crew', () => {
  const {layout,mission,map,run,place} = field();
  const s = place(map.exit.x+50 > 70 ? map.exit.x-50 : map.exit.x+50,map.exit.z);
  if (!openGround(layout,s.x,s.z)) { const a = {x:-40,z:-40}; Object.assign(s,{x:a.x,z:a.z,y:groundAt(map,a.x,a.z)}); }
  const start = Math.hypot(s.x-map.exit.x,s.z-map.exit.z);
  let closest = start;
  run(60,() => {
    assert.ok(!deep(map.geometry,s.x,s.z,s.y),'out of deep water');
    assert.ok(Math.abs(s.y-groundAt(map,s.x,s.z)) < 0.05,'on the ground');
    closest = Math.min(closest,Math.hypot(s.x-map.exit.x,s.z-map.exit.z));
  });
  assert.ok(closest < start-10,'drifted toward the crew: '+start.toFixed(0)+' -> '+closest.toFixed(0)+' m');
  void mission;
});

test('outside a charge it keeps its distance, even from someone lying flat', () => {
  const {mission,player,put,run,place,arena} = field();
  const me = player(1);
  put(me,arena.x+12,arena.z,Math.PI/2);
  const s = place(arena.x,arena.z,-Math.PI/2);
  let closest = Infinity, hits = 0;
  run(25,() => {
    if (s.mode !== 'charge') closest = Math.min(closest,Math.hypot(s.x-me.x,s.z-me.z));
    if (mission.down.length) { mission.down = []; me.hp = maxHealth; hits++; }
  });
  assert.ok(closest > 3.5,'closest between charges: '+closest.toFixed(1)+' m');
  assert.ok((s.charges ?? 0) >= 2,'it kept coming');
  void hits;
});
