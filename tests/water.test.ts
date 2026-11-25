import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkable } from '../src/layout.ts';
import { breathTime, items } from '../src/mission.ts';
import { deepWater, fordWater } from '../src/outdoor-features.ts';
import { groundAt, outdoors } from '../src/places.ts';
import { headHeight, waterLevel } from '../src/room-templates.ts';
import { route } from '../src/route.ts';
import { spawnSalvage } from '../src/salvage.ts';
import { generateLayout } from '../src/server/generate-layout.ts';
import { moveOperator, Simulation } from '../src/server/simulation.ts';
import type { Player } from '../src/room.ts';

const seed = 19;
const map = outdoors(seed);
// The middle of the river away from any ford, and the middle of a ford.
const deepSpot = (() => {
  const p = map.river.points.find(q => Math.max(Math.abs(q.x),Math.abs(q.z)) < 50 && map.river.fords.every(f => Math.hypot(f.x-q.x,f.z-q.z) > 30))!;
  return {x:p.x,y:groundAt(map,p.x,p.z),z:p.z};
})();
const ford = {...map.fords[0],y:groundAt(map,map.fords[0].x,map.fords[0].z)};

function outside() {
  const sim = new Simulation(generateLayout(seed),'coop','inside');
  sim.join(); sim.join();
  const p1 = sim.state.players[0], p2 = sim.state.players[1];
  // Operator 2 waits by the building, so a death doesn't end the expedition.
  Object.assign(p2,{place:'outside',x:map.exit.x,z:map.exit.z,feetY:0});
  const put = (p: Player, at: {x: number; y: number; z: number}) => Object.assign(p,{place:'outside',x:at.x,z:at.z,feetY:at.y});
  const run = (seconds: number) => { for (let i=0;i<Math.round(seconds*30);i++) sim.tick(1/30); };
  return {sim,p1,p2,put,run,mission:sim.state.mission!};
}

test('the riverbed holds water over a head in its channel and about waist deep at a ford', () => {
  const deep = waterLevel(map.water,deepSpot.x,deepSpot.z)!-deepSpot.y, shallow = waterLevel(map.water,ford.x,ford.z)!-ford.y;
  assert.ok(deep > headHeight+0.5 && deep < deepWater+1.2,'deep: '+deep.toFixed(2));
  assert.ok(Math.abs(shallow-fordWater) < 0.2,'shallow: '+shallow.toFixed(2));
  assert.equal(waterLevel(map.water,map.exit.x,map.exit.z),undefined,'none by the building');
  assert.equal(map.geometry.water,map.water);
});

test('under water, an operator has a few seconds of breath; surfacing in time saves them', () => {
  const {p1,put,run,mission} = outside();
  put(p1,deepSpot);
  run(breathTime-0.5);
  assert.equal(mission.dead?.includes(1) ?? false,false,'still holding their breath');
  assert.ok(mission.drowning?.some(d => d.id === 1));
  // Out, onto the bank above: breath back.
  put(p1,{x:map.exit.x+3,y:0,z:map.exit.z});
  run(0.1);
  assert.equal(mission.drowning?.some(d => d.id === 1) ?? false,false);
  put(p1,deepSpot);
  run(breathTime-0.5);
  assert.equal(mission.dead?.includes(1) ?? false,false,'a full breath again');
  run(1);
  assert.deepEqual(mission.dead,[1],'drowned');
});

test('wading through a ford is slower than walking', () => {
  const g = map.geometry, dry = {id:1,connected:true,x:map.exit.x+4,z:map.exit.z+3,feetY:0,yaw:0,pitch:0};
  const wet = {id:1,connected:true,x:ford.x,z:ford.z,feetY:ford.y,yaw:0,pitch:0};
  const before = [dry.z,wet.z];
  for (let i=0;i<10;i++) { moveOperator(dry,{forward:1,right:0,yaw:0,pitch:0},1/30,g); moveOperator(wet,{forward:1,right:0,yaw:0,pitch:0},1/30,g); }
  const walked = before[0]-dry.z, waded = before[1]-wet.z;
  assert.ok(waded > 0 && waded < walked*0.7,'waded '+waded.toFixed(2)+' against '+walked.toFixed(2));
});

test('things dropped or thrown into deep water sink and are lost; in a ford they stay', () => {
  const {sim,p1,put,run,mission} = outside();
  const items0 = spawnSalvage(sim.layout!).slice(0,2);
  for (const it of items0) { put(p1,{x:it.x,y:it.y,z:it.z}); p1.place = 'inside'; sim.act(1,'take'); }
  put(p1,deepSpot);
  sim.act(1,'select',{slot:0}); sim.act(1,'drop');
  run(0.1);
  assert.equal(items(sim.layout!,mission).some(i => i.id === items0[0].id),false,'sunk');
  put(p1,ford);
  sim.act(1,'select',{slot:1}); sim.act(1,'drop');
  run(0.1);
  assert.ok(items(sim.layout!,mission).some(i => i.id === items0[1].id),'resting in the shallows');
  // The flashlight, dropped in deep water, is lost.
  put(p1,{x:sim.state.lamp.x,y:0,z:sim.state.lamp.z}); p1.place = 'inside'; sim.act(1,'take');
  assert.equal(sim.state.lamp.owner,1);
  put(p1,deepSpot);
  sim.act(1,'select',{slot:p1.slots!.indexOf('lamp')}); sim.act(1,'drop');
  run(0.1);
  assert.deepEqual([sim.state.lamp.lost,sim.state.lamp.on,sim.state.lamp.owner],[true,false,null]);
});

test('a drowned operator\'s gear sinks with them', () => {
  const {sim,p1,put,run,mission} = outside();
  const it = spawnSalvage(sim.layout!)[0];
  put(p1,{x:it.x,y:it.y,z:it.z}); p1.place = 'inside'; sim.act(1,'take');
  put(p1,deepSpot);
  run(breathTime+0.2);
  assert.deepEqual(mission.dead,[1]);
  assert.equal(items(sim.layout!,mission).some(i => i.id === it.id),false);
});

test('bridges cross the river, with holes that drop you in', () => {
  let bridged = 0;
  for (let s=1;s<=24;s++) if (outdoors(s).bridges.length) bridged++;
  assert.ok(bridged >= 18,'most maps have a bridge: '+bridged+' of 24');
  for (const s of [3,19,24]) {
    const m = outdoors(s);
    for (const b of m.bridges) {
      // From the ground just short of one landing to just past the other.
      const key = (q: {x: number; z: number}) => b.along === 'x' ? q.x : q.z;
      const lo = Math.min(...b.planks.map(q => key(q)-(b.along === 'x' ? q.w : q.d)/2))-0.4, hi = Math.max(...b.planks.map(q => key(q)+(b.along === 'x' ? q.w : q.d)/2))+0.4;
      const at = [lo,hi].map(t => { const x = b.along === 'x' ? t : b.x, z = b.along === 'x' ? b.z : t; return {x,y:groundAt(m,x,z),z}; });
      assert.ok(route(m.geometry,at[0],at[1],[0.25,0]),'seed '+s+': walk across the bridge at '+b.x.toFixed(0)+','+b.z.toFixed(0));
    }
  }
  // Stepping into a hole over the channel drops you into the water.
  let found: {m: ReturnType<typeof outdoors>; b: (typeof map.bridges)[number]; plank: (typeof map.bridges)[number]['planks'][number]} | undefined;
  for (let s=1;s<=24 && !found;s++) {
    const m = outdoors(s);
    for (const b of m.bridges) {
      const key = (q: {x: number; z: number}) => (b.along === 'x' ? q.x : q.z).toFixed(2), count = new Map<string,number>();
      for (const pl of b.planks) count.set(key(pl),(count.get(key(pl)) ?? 0)+1);
      const plank = b.planks.find(pl => {
        if (count.get(key(pl)) !== 1) return false;
        const hx = b.along === 'x' ? pl.x : 2*b.x-pl.x, hz = b.along === 'x' ? 2*b.z-pl.z : pl.z;
        return (waterLevel(m.water,hx,hz) ?? -Infinity) > groundAt(m,hx,hz)+headHeight;
      });
      if (plank) { found = {m,b,plank}; break; }
    }
  }
  assert.ok(found,'a hole over deep water');
  const {m,b,plank} = found;
  // Sidestep from the remaining plank toward the missing one.
  const toward = b.along === 'x' ? Math.sign(b.z-plank.z) : Math.sign(b.x-plank.x);
  const p = {id:1,connected:true,x:plank.x,z:plank.z,feetY:plank.y+plank.rise/2,yaw:0,pitch:0};
  for (let i=0;i<30;i++) moveOperator(p,b.along === 'x' ? {forward:-toward,right:0,yaw:0,pitch:0} : {forward:0,right:toward,yaw:0,pitch:0},1/30,m.geometry);
  assert.ok(p.feetY < plank.y-0.8,'fell through, feet at '+p.feetY.toFixed(2)+' from '+plank.y.toFixed(2));
  assert.ok((waterLevel(m.water,p.x,p.z) ?? -Infinity) > p.feetY+headHeight,'into deep water');
});

test('planning never walks through deep water', () => {
  const reached = walkable(map.geometry,map.spawns[0],[],0.5);
  assert.equal(reached(deepSpot),false);
  assert.equal(reached(ford),true,'but wades a ford');
});
