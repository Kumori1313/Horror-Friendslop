import { test } from 'node:test';
import assert from 'node:assert/strict';
import { healthOf, heldBy, maxHealth } from '../src/mission.ts';
import { groundAt, outdoors } from '../src/places.ts';
import { waterLevel } from '../src/room-templates.ts';
import type { Player } from '../src/room.ts';
import { generateLayout } from '../src/server/generate-layout.ts';
import { grabDamage, grabReach, linger, lurkerStretch, sinkTime } from '../src/server/lurkers.ts';
import { Simulation } from '../src/server/simulation.ts';

// Operators outdoors on seed 19, with the Lurker in its river.
function bank(seed = 19) {
  const sim = new Simulation(generateLayout(seed),'coop','inside');
  sim.join(); sim.join();
  let state = 777;
  sim.random = () => (state = (Math.imul(state,1103515245)+12345) >>> 0)/2**32;
  const mission = sim.state.mission!, map = outdoors(seed);
  const player = (id: number) => sim.state.players.find(p => p.id === id)!;
  const put = (p: Player, x: number, z: number, yaw = 0) => { Object.assign(p,{place:'outside',x,z,feetY:groundAt(map,x,z),yaw}); delete p.vy; sim.inputs.set(p.id,{forward:0,right:0,yaw,pitch:0}); };
  // Operator 2 by the building, out of the way.
  put(player(2),map.exit.x,map.exit.z);
  put(player(1),map.exit.x+1,map.exit.z);
  sim.tick(1/30);
  const lurker = () => mission.lurkers![0];
  const run = (seconds: number) => { for (let i=0;i<Math.round(seconds*30);i++) sim.tick(1/30); };
  // A steep stretch of its river, with dry bank within 5.5 m of the centre
  // line (and, given `dryBack`, dry that far back from it and 2 m either
  // side, and low: no more than 2 m above the water): a fresh Lurker is put there, and the dry spot nearest it returned
  // with the way across the river there.
  const dryAt = (x: number, z: number) => { const wet = waterLevel(map.water,x,z); return wet === undefined || groundAt(map,x,z) > wet+0.2; };
  const beside = (out: number, dryBack = 0) => {
    const {lo,hi} = lurkerStretch(seed), p = map.water.points;
    for (let k=lo+1;k<hi;k++) {
      const a = p[k-1], c = p[k+1], len = Math.hypot(c.x-a.x,c.z-a.z), nx = -(c.z-a.z)/len, nz = (c.x-a.x)/len;
      for (const side of [1,-1]) for (let d=out;d<5.5;d+=0.25) {
        const x = p[k].x+nx*d*side, z = p[k].z+nz*d*side, wet = waterLevel(map.water,x,z);
        if (wet !== undefined && groundAt(map,x,z) <= wet+0.2) continue;
        const ex = nx*side, ez = nz*side;
        let clear = true;
        for (let b=0;b<=dryBack && clear;b+=0.5) for (const t of dryBack && b === dryBack ? [-2,-1,0,1,2] : [0]) clear &&= dryAt(x+ex*b+ez*t,z+ez*b-ex*t) && (!dryBack || groundAt(map,x+ex*b+ez*t,z+ez*b-ex*t)-p[k].level <= 2);
        if (!clear) break;
        mission.lurkers = [{id:2,x:p[k].x,y:p[k].level-0.7,z:p[k].z,yaw:0,mode:'lurk'}];
        return {x,z,nx:nx*side,nz:nz*side,k};
      }
    }
    return undefined;
  };
  return {sim,mission,map,player,put,run,lurker,beside,dryAt};
}
// How closely its heading points from it toward (x, z): 1 dead ahead.
const facingToward = (l: {x: number; z: number; yaw: number}, x: number, z: number) => {
  const d = Math.hypot(x-l.x,z-l.z) || 1;
  return (-Math.sin(l.yaw)*(x-l.x)-Math.cos(l.yaw)*(z-l.z))/d;
};

test('the Lurker starts in the river\'s deep water and patrols it without ever leaving', () => {
  for (const seed of [19,77,101]) {
    const {map,run,lurker} = bank(seed);
    const l = lurker();
    assert.ok(l,'seed '+seed+': a Lurker');
    let moves = 0;
    for (let t=0;t<60;t+=1/6) {
      const from = {x:l.x,z:l.z};
      run(1/6);
      const level = waterLevel(map.water,l.x,l.z);
      assert.ok(level !== undefined && level-groundAt(map,l.x,l.z) >= 1.5,'seed '+seed+': in deep water at '+t+' s');
      // Facing the way it goes.
      if (Math.hypot(l.x-from.x,l.z-from.z) > 0.1) { moves++; assert.ok(facingToward(l,l.x+(l.x-from.x),l.z+(l.z-from.z)) > 0.8,'seed '+seed+': facing its way at '+t+' s'); }
    }
    assert.ok(moves > 60,'seed '+seed+': it patrols');
  }
});

test('it ignores someone standing still out of hearing, and comes along the river for someone moving', () => {
  const {sim,player,put,run,lurker,beside} = bank();
  // 4 m back from the water's edge: well beyond its reach and, standing
  // still, beyond its hearing.
  const edge = beside(3)!, spot = {...edge,x:edge.x+edge.nx*4,z:edge.z+edge.nz*4};
  put(player(1),spot.x,spot.z);
  run(2);
  assert.notEqual(lurker().mode,'hunt','still and 8 m off: unheard');
  // Pace up and down the bank.
  for (let i=0;i<60;i++) { sim.inputs.set(1,{forward:i % 30 < 15 ? 1 : -1,right:0,yaw:Math.atan2(spot.nz,spot.nx),pitch:0}); sim.tick(1/30); }
  assert.ok(['hunt','grab'].includes(lurker().mode),'heard: '+lurker().mode);
});

test('it goes to where it last heard someone after the sound stops, faces them while it waits, then patrols on', () => {
  const {sim,map,player,put,run,lurker,beside} = bank();
  const edge = beside(3)!, p = map.water.points, me = player(1);
  // Standing 4 m back from the water.
  const spot = {x:edge.x+edge.nx*4,z:edge.z+edge.nz*4};
  // It starts some 7 m along the river, within its stretch.
  const {lo,hi} = lurkerStretch(19), along = (step: number) => {
    let j = edge.k;
    while (j > lo && j < hi && Math.hypot(p[j].x-p[edge.k].x,p[j].z-p[edge.k].z) < 7) j += step;
    return Math.hypot(p[j].x-p[edge.k].x,p[j].z-p[edge.k].z) >= 7 ? j : undefined;
  };
  const j = along(1) ?? along(-1)!;
  Object.assign(lurker(),{x:p[j].x,z:p[j].z,y:p[j].level-0.7});
  put(me,spot.x,spot.z);
  run(1);
  assert.equal(lurker().mode,'lurk','unheard while still');
  // A few steps along the bank, then still again.
  for (let i=0;i<12;i++) { sim.inputs.set(1,{forward:0,right:i < 6 ? 1 : -1,yaw:0,pitch:0}); sim.tick(1/30); }
  assert.equal(lurker().mode,'hunt','heard');
  // Then gone, out of its hearing: all it has is where it heard them.
  const heardAt = {x:me.x,z:me.z};
  put(me,map.exit.x+1,map.exit.z);
  const start = Math.hypot(lurker().x-p[edge.k].x,lurker().z-p[edge.k].z);
  assert.ok(start > 5,'starts '+start.toFixed(1)+' m off');
  run(5);
  const l = lurker();
  assert.equal(l.mode,'hunt','still searching');
  assert.ok(Math.hypot(l.x-heardAt.x,l.z-heardAt.z) < grabReach,'came to the spot: '+Math.hypot(l.x-heardAt.x,l.z-heardAt.z).toFixed(1)+' m from it');
  assert.ok(facingToward(l,heardAt.x,heardAt.z) > 0.8,'facing the sound');
  // It waits a while, then moves on.
  const there = {x:l.x,z:l.z};
  run(linger+5);
  assert.equal(lurker().mode,'lurk','patrolling again');
  assert.ok(Math.hypot(lurker().x-there.x,lurker().z-there.z) > 1,'moved on');
});

test('it comes right to the water\'s edge and up the bank: someone walking well back from the water is grabbed', () => {
  // Most of its reach back from the water's edge, on low, dry ground: it
  // used to take wading in to be grabbed. The first seed with such a bank.
  const back = grabReach-1;
  let found;
  for (let seed=1;seed<60 && !found;seed++) { const b = bank(seed), edge = b.beside(3,back); if (edge) found = {...b,edge,seed}; }
  assert.ok(found,'a low bank dry '+back+' m back');
  const {sim,mission,map,player,put,lurker,dryAt,edge} = found, me = player(1);
  const along = Math.atan2(-edge.nz,edge.nx);
  put(me,edge.x+edge.nx*back,edge.z+edge.nz*back);
  for (let i=0;i<300 && !heldBy(mission,1);i++) { sim.inputs.set(1,{forward:i % 16 < 8 ? 1 : -1,right:0,yaw:along,pitch:0}); sim.tick(1/30); }
  assert.equal(heldBy(mission,1)?.id,lurker().id,'grabbed from '+back.toFixed(1)+' m back');
  assert.ok(dryAt(me.x,me.z),'grabbed on dry ground');
  void map;
});

test('a grab hurts and holds: the victim can\'t walk away, is dragged in, and drowns if nobody helps', () => {
  const {sim,mission,player,put,run,lurker,beside} = bank();
  const spot = beside(3)!, p = player(1);
  put(p,spot.x,spot.z);
  for (let i=0;i<180 && !heldBy(mission,1);i++) sim.tick(1/30);
  assert.equal(heldBy(mission,1)?.id,lurker().id,'grabbed');
  assert.equal(healthOf(p),maxHealth-grabDamage);
  // Walking away does nothing; it pulls them toward the river.
  const grabbedAt = {x:p.x,z:p.z};
  sim.inputs.set(1,{forward:-1,right:0,yaw:Math.atan2(spot.nx,spot.nz),pitch:0});
  run(1);
  assert.ok(Math.hypot(p.x-grabbedAt.x,p.z-grabbedAt.z) > 0.6,'dragged in');
  // Some seconds pass before it is under, then the breath runs out.
  run(4);
  assert.equal(mission.dead?.includes(1) ?? false,false,'still alive five seconds in');
  run(14);
  assert.deepEqual(mission.dead,[1],'drowned');
});

test('a baton hit, a thrown item or a lit flare near it frees the victim back on the bank, and it stays down for a while', () => {
  for (const how of ['baton','throw','flare'] as const) {
    const {sim,mission,player,put,run,lurker,beside} = bank();
    const spot = beside(3)!, p = player(1), partner = player(2);
    put(p,spot.x,spot.z);
    for (let i=0;i<180 && !heldBy(mission,1);i++) sim.tick(1/30);
    assert.ok(heldBy(mission,1),how+': grabbed');
    const grabbedAt = {x:spot.x,z:spot.z};
    run(0.5);
    // The partner comes to the bank just behind the victim.
    const help = {x:spot.x+spot.nx*1.5,z:spot.z+spot.nz*1.5};
    if (how === 'baton') {
      mission.haul.push({id:'bought-1',kind:'baton',owner:2,x:0,y:0,z:0,place:'outside'});
      partner.slots = ['bought-1',null,null,null]; partner.hand = 0;
      put(partner,help.x,help.z,Math.atan2(-(p.x-help.x),-(p.z-help.z)));
      sim.act(2,'swing');
    } else if (how === 'flare') {
      mission.haul.push({id:'bought-2',kind:'flare',owner:null,x:p.x,y:p.feetY ?? 0,z:p.z,place:'outside',burn:40});
      sim.tick(1/30);
    } else {
      mission.haul.push({id:'bought-3',kind:'cell',owner:2,x:0,y:0,z:0,place:'outside'});
      partner.slots = ['bought-3',null,null,null]; partner.hand = 0;
      put(partner,help.x,help.z,Math.atan2(-(lurker().x-help.x),-(lurker().z-help.z)));
      sim.act(2,'throw',{aim:{yaw:partner.yaw,pitch:0.1,power:0.15}});
      for (let i=0;i<60 && heldBy(mission,1);i++) sim.tick(1/30);
    }
    assert.equal(heldBy(mission,1),undefined,how+': let go');
    assert.equal(lurker().mode,'sunk');
    assert.ok(Math.hypot(p.x-grabbedAt.x,p.z-grabbedAt.z) < 0.5,how+': back on the bank');
    // Down for a while: standing right there, nobody is grabbed again soon.
    put(p,spot.x,spot.z);
    run(sinkTime-2);
    assert.equal(heldBy(mission,1),undefined,how+': not again so soon');
  }
});

test('struggling slows the drag', () => {
  const dragged = (mash: boolean) => {
    const {sim,mission,player,put,run,lurker,beside} = bank();
    const spot = beside(3)!, p = player(1);
    put(p,spot.x,spot.z);
    for (let i=0;i<180 && !heldBy(mission,1);i++) sim.tick(1/30);
    assert.ok(heldBy(mission,1));
    const start = Math.hypot(p.x-lurker().x,p.z-lurker().z);
    for (let i=0;i<45;i++) { sim.inputs.set(1,{forward:0,right:0,yaw:0,pitch:0,jump:mash && i % 4 < 2}); sim.tick(1/30); }
    return start-Math.hypot(p.x-lurker().x,p.z-lurker().z);
  };
  const free = dragged(false), fighting = dragged(true);
  assert.ok(fighting < free*0.6,'struggling: '+fighting.toFixed(2)+' m against '+free.toFixed(2)+' m');
});

test('the fords are safe: someone wading across is never grabbed', () => {
  for (const seed of [19,77,101]) {
    const {sim,mission,map,player,put} = bank(seed);
    for (const f of map.fords) {
      put(player(1),f.x,f.z);
      for (let i=0;i<300;i++) { sim.inputs.set(1,{forward:i % 40 < 20 ? 1 : -1,right:0,yaw:0,pitch:0}); sim.tick(1/30); }
      assert.equal(heldBy(mission,1),undefined,'seed '+seed+': grabbed at the ford '+f.x.toFixed(0)+','+f.z.toFixed(0));
    }
  }
});
