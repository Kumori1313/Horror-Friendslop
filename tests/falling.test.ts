import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gravity } from '../src/flight.ts';
import type { Geometry } from '../src/layout.ts';
import { Prediction } from '../src/prediction.ts';
import type { Input, Player } from '../src/room.ts';
import { moveOperator } from '../src/server/simulation.ts';

// A floor, a solid 3 m platform on it, and a gentle ramp (1 m over 6 m) beside.
const room = 'test';
const g: Geometry = {
  surfaces:[
    {x:0,z:0,w:40,d:40,y:0,room},
    {x:0,z:0,w:4,d:4,y:3,room},
    {x:10,z:0,w:6,d:3,y:0,rise:1,along:'x',room},
  ],
  walls:[{x:0,z:0,w:4,d:4,y:0,h:3,room,inward:1}],roofs:[],rails:[],props:[],doors:[],openings:[],
};
const dt = 1/30, east: Input = {forward:0,right:1,yaw:0,pitch:0}, idle: Input = {forward:0,right:0,yaw:0,pitch:0}, west: Input = {forward:0,right:-1,yaw:0,pitch:0};
const at = (x: number, z: number, feetY: number): Player => ({id:1,connected:true,x,z,feetY,yaw:0,pitch:0});

test('walking off a ledge falls under gravity instead of dropping to the floor at once', () => {
  const p = at(1.8,0,3);
  while (p.vy === undefined) moveOperator(p,east,dt,g);
  assert.ok((p.feetY ?? 0) > 2.9,'still near the ledge as the fall begins');
  // Let go: the fall carries on, and lands when the time to fall 3 m is up.
  let t = 0;
  while (p.vy !== undefined && t < 3) { moveOperator(p,idle,dt,g); t += dt; }
  assert.equal(p.feetY,0);
  assert.equal(p.vy,undefined,'landed');
  const expected = Math.sqrt(2*3/gravity);
  assert.ok(Math.abs(t-expected) < 0.1,'fell 3 m in '+t.toFixed(2)+' s, expected about '+expected.toFixed(2));
});

test('in the air an operator can steer, but the platform\'s side is a wall: they come down beside it', () => {
  const late = at(1.8,0,3);
  while (late.vy === undefined) moveOperator(late,east,dt,g);
  const x0 = late.x;
  for (let i=0;i<5;i++) moveOperator(late,east,dt,g);
  assert.ok(late.x > x0+0.4,'still moving east while falling');
  for (let i=0;i<40 && late.vy !== undefined;i++) moveOperator(late,west,dt,g);
  assert.equal(late.feetY,0);
  assert.ok(late.x >= 2.25-1e-9,'clear of the platform\'s side at x '+late.x.toFixed(2));
});

test('walking down a gentle ramp keeps the operator on their feet the whole way', () => {
  const p = at(12.8,0,surfaceAtRampTop());
  for (let i=0;i<60;i++) { moveOperator(p,west,dt,g); assert.equal(p.vy,undefined,'on the ramp at x '+p.x.toFixed(2)); }
  assert.ok(p.x < 7.5 && p.feetY === 0,'down on the floor');
});
function surfaceAtRampTop() { return 1*(12.8-7)/6; }

test('the guest\'s prediction falls exactly as the host does', () => {
  const host = at(1.8,0,3), prediction = new Prediction();
  prediction.reset(host,0);
  for (let i=0;i<40;i++) {
    const input = i < 12 ? east : idle;
    moveOperator(host,input,dt,g);
    prediction.step(i*dt*1000,dt,input,g,[],false);
    assert.deepEqual([prediction.self!.x,prediction.self!.feetY,prediction.self!.vy],[host.x,host.feetY,host.vy]);
  }
  assert.equal(host.feetY,0);
});

// Jumping and long falls.
import { jumpHeight, Simulation } from '../src/server/simulation.ts';
import { generateLayout } from '../src/server/generate-layout.ts';
import { geometryFor, socketGroups } from '../src/layout.ts';
import { pitKill, roomTemplates } from '../src/room-templates.ts';
import { items } from '../src/mission.ts';
import { spawnSalvage } from '../src/salvage.ts';

const jump: Input = {...idle,jump:true};
const yard: Geometry = {
  surfaces:[{x:0,z:0,w:40,d:40,y:0,room}],
  walls:[],roofs:[{x:-8,z:0,w:4,d:4,y:2.1,h:0.12,room}],rails:[],doors:[],openings:[],
  props:[{x:4,z:0,w:2,d:2,y:0,h:0.5,kind:'crate',room},{x:8,z:0,w:2,d:2,y:0,h:0.8,kind:'crate',room}],
};

test('a jump rises about 0.6 m and comes back down', () => {
  const p = at(0,6,0);
  let top = 0, t = 0;
  moveOperator(p,jump,dt,yard);
  while (p.vy !== undefined && t < 2) { moveOperator(p,idle,dt,yard); top = Math.max(top,p.feetY!); t += dt; }
  assert.ok(Math.abs(top-jumpHeight) < 0.08,'rose '+top.toFixed(2)+' m');
  assert.deepEqual([p.feetY,p.vy],[0,undefined]);
});

test('a jump clears a low crate, lands on it, walks along it and steps off; a taller one stays a wall', () => {
  // A running jump from 1.4 m short of the crate.
  const p = at(1.6,0,0);
  for (let i=0;i<30 && !(p.vy === undefined && p.feetY! > 0.4);i++) moveOperator(p,{...east,jump:i === 0},dt,yard);
  assert.ok(Math.abs(p.feetY!-0.5) < 1e-6,'on top of the crate, feet at '+p.feetY);
  for (let i=0;i<4;i++) moveOperator(p,east,dt,yard);
  assert.ok(Math.abs(p.feetY!-0.5) < 1e-6 && p.vy === undefined,'walking along it');
  for (let i=0;i<30 && !(p.vy === undefined && p.feetY === 0);i++) moveOperator(p,east,dt,yard);
  assert.equal(p.feetY,0,'off the far side');
  // Jumping at the 0.8 m crate only bumps into it.
  for (let i=0;i<40;i++) moveOperator(p,{...east,jump:true},dt,yard);
  assert.ok(p.x < 8-1-0.24,'held back at x '+p.x.toFixed(2));
});

test('a low ceiling cuts a jump short', () => {
  const p = at(-8,0,0);
  let top = 0;
  moveOperator(p,jump,dt,yard);
  for (let i=0;i<40;i++) { moveOperator(p,idle,dt,yard); top = Math.max(top,p.feetY!); }
  assert.ok(top <= 2.1-1.75+1e-9 && top > 0.3,'head stopped at the ceiling, feet up '+top.toFixed(2));
});

// A layout with a given room, and a sim with operator 1 standing somewhere in it.
function withRoom(template: 'pit' | 'foundry' | 'hall') {
  for (let seed=1;seed<400;seed++) {
    const layout = generateLayout(seed), room = layout.rooms.find(r => r.template === template);
    if (!room) continue;
    const sim = new Simulation(layout,'coop','inside');
    sim.join(); sim.join();
    return {sim,room,layout};
  }
  throw new Error('no layout with a '+template);
}
const run = (sim: Simulation, seconds: number) => { for (let i=0;i<Math.round(seconds*30);i++) sim.tick(1/30); };

test('falling into the settling pit is fatal; dropping 4 m from the hall\'s gallery is not', () => {
  const {sim,room,layout} = withRoom('pit');
  const g = geometryFor(layout), girder = g.surfaces.find(s => s.room === room.id && s.y === 0 && Math.max(s.w,s.d) > 8 && Math.min(s.w,s.d) < 1.3)!;
  const p = sim.state.players[0], across = girder.w > girder.d ? {x:girder.x,z:girder.z} : {x:girder.x,z:girder.z};
  Object.assign(p,{x:across.x,z:across.z,feetY:0});
  // Sidestep off the girder.
  const side: Input = girder.w > girder.d ? {forward:1,right:0,yaw:0,pitch:0} : {forward:0,right:1,yaw:0,pitch:0};
  sim.inputs.set(1,side);
  run(sim,0.5);
  sim.inputs.set(1,idle);
  run(sim,2);
  assert.deepEqual(sim.state.mission!.dead,[1],'fell into the pit');
  assert.ok(p.feetY! < -pitKill,'down in the dark');
  // From the hall's gallery to the floor, 4 m, an operator lives.
  const hall = withRoom('hall'), q = hall.sim.state.players[0], hg = geometryFor(hall.layout);
  // In the air at the gallery's height over the hall's floor, then down.
  const clearOfProps = (s: {x: number; z: number}) => !hg.props.some(o => Math.abs(o.x-s.x) < o.w/2+0.5 && Math.abs(o.z-s.z) < o.d/2+0.5);
  const floor = hg.surfaces.filter(s => s.room === hall.room.id && s.y === hall.room.y && !s.rise && clearOfProps(s)).sort((a,b) => b.w*b.d-a.w*a.d)[0];
  Object.assign(q,{x:floor.x,z:floor.z,feetY:floor.y+4,vy:0});
  run(hall.sim,2);
  assert.equal(q.feetY,floor.y,'landed on the floor');
  assert.equal(hall.sim.state.mission!.dead?.includes(1) ?? false,false,'alive');
});

test('rails keep an operator on the hall\'s gallery', () => {
  const {sim,room,layout} = withRoom('hall'), g = geometryFor(layout), p = sim.state.players[0];
  const rail = g.rails.find(r => r.room === room.id)!;
  // Stand on the gallery side of the rail and walk into it.
  const alongX = rail.w > rail.d, gallery = g.surfaces.find(s => s.room === room.id && s.catwalk)!;
  const inward = alongX ? Math.sign(gallery.z-rail.z) : Math.sign(gallery.x-rail.x);
  Object.assign(p,alongX ? {x:rail.x,z:rail.z+inward*0.6,feetY:rail.y} : {x:rail.x+inward*0.6,z:rail.z,feetY:rail.y});
  // Walk toward the rail (yaw 0 faces -z; right is +x).
  sim.inputs.set(1,alongX ? {forward:inward,right:0,yaw:0,pitch:0} : {forward:0,right:-inward,yaw:0,pitch:0});
  run(sim,1.5);
  assert.equal(p.vy,undefined);
  assert.equal(p.feetY,rail.y,'still on the gallery');
});

test('the settling pit and the foundry join all their doorways, turn up in facilities, and never hold salvage in their pits', () => {
  for (const kind of ['pit','foundry'] as const) {
    assert.equal(new Set(socketGroups(kind).values()).size,1,kind+': one walkable group');
    assert.ok(roomTemplates[kind].depth! >= pitKill+8,kind+': walled deep into the dark, well past where a fall kills');
  }
  let pits = 0, foundries = 0;
  for (let seed=0;seed<60;seed++) {
    const layout = generateLayout(seed);
    for (const r of layout.rooms) if (r.template === 'pit' || r.template === 'foundry') {
      r.template === 'pit' ? pits++ : foundries++;
      assert.equal(r.y,0,'on the ground storey');
    }
    for (const item of spawnSalvage(layout)) assert.ok(item.y >= -0.01,'seed '+seed+': salvage at '+item.y);
  }
  assert.ok(pits > 20 && foundries > 20,'pits '+pits+', foundries '+foundries+' in 60 facilities');
});

test('a pit has nothing to land on: no floor or construct below the walkways, only solid blocks under the platform and stairs', () => {
  for (const kind of ['pit','foundry'] as const) {
    const {room,layout} = withRoom(kind), g = geometryFor(layout), below = room.y-0.5;
    assert.deepEqual(g.surfaces.filter(s => s.room === room.id && Math.min(s.y,s.y+(s.rise ?? 0)) < below).length,0,kind+': no floor down in the pit');
    assert.deepEqual(g.props.filter(o => o.room === room.id && o.y+o.h < below).length,0,kind+': nothing standing in the pit');
    // Blocks reach up to just under a walkable floor, never to stand on.
    for (const w of g.walls.filter(w => w.room === room.id && Math.min(w.w,w.d) > 0.1)) {
      const top = w.y+w.h;
      assert.ok(g.surfaces.some(s => s.room === room.id && s.solid && Math.abs(Math.min(s.y,s.y+(s.rise ?? 0))-0.13-top) < 1e-6),kind+': a block under a floor');
    }
  }
});

test('salvage thrown into a pit, or dropped while falling, is lost', () => {
  const {sim,room,layout} = withRoom('pit'), g = geometryFor(layout), p = sim.state.players[0], mission = sim.state.mission!;
  const [a,b] = spawnSalvage(layout);
  for (const item of [a,b]) { Object.assign(p,{x:item.x,z:item.z,feetY:item.y,place:'inside'}); sim.act(1,'take'); }
  const girder = g.surfaces.find(s => s.room === room.id && s.y === room.y && Math.max(s.w,s.d) > 8 && Math.min(s.w,s.d) < 1.3)!;
  Object.assign(p,{x:girder.x,z:girder.z,feetY:room.y});
  // Thrown gently off the girder's side.
  const side = girder.w > girder.d ? 0 : -Math.PI/2;
  sim.act(1,'select',{slot:p.slots!.indexOf(a.id)});
  sim.act(1,'throw',{aim:{yaw:side,pitch:0,power:0.1}});
  run(sim,4);
  assert.equal(items(layout,mission).some(i => i.id === a.id),false,'thrown down the pit');
  // Stepping off with the other, and letting go on the way down.
  sim.inputs.set(1,girder.w > girder.d ? {forward:1,right:0,yaw:0,pitch:0} : {forward:0,right:1,yaw:0,pitch:0});
  for (let i=0;i<30 && p.vy === undefined;i++) sim.tick(1/30);
  assert.ok(p.vy !== undefined,'falling');
  sim.act(1,'select',{slot:p.slots!.indexOf(b.id)});
  sim.act(1,'drop');
  run(sim,4);
  assert.equal(items(layout,mission).some(i => i.id === b.id),false,'dropped down the pit');
});

test('jumping into a slope too steep to climb never puts an operator under the ground', async () => {
  const { outdoors } = await import('../src/places.ts');
  const { fieldGrade, fieldHeight, maxGrade } = await import('../src/room-templates.ts');
  let tried = 0, under = 0;
  for (const seed of [1,19,77]) {
    const map = outdoors(seed), f = map.ground;
    // Steep spots inside the boundary walls.
    for (let i=0;i<f.n*f.n && tried < 40*(seed === 77 ? 3 : seed === 19 ? 2 : 1);i+=37) {
      const x = f.x0+(i % f.n), z = f.z0+Math.floor(i/f.n);
      if (Math.max(Math.abs(x),Math.abs(z)) > 60 || fieldGrade(f,x,z) < (maxGrade*1.3)**2) continue;
      // Uphill: the way the ground rises fastest.
      const gx = fieldHeight(f,x+0.5,z)-fieldHeight(f,x-0.5,z), gz = fieldHeight(f,x,z+0.5)-fieldHeight(f,x,z-0.5), len = Math.hypot(gx,gz);
      const ux = gx/len, uz = gz/len;
      for (const [fx,fz] of [[ux,uz],[uz,-ux]]) {
        tried++;
        const sx = x-ux*0.8, sz = z-uz*0.8;
        const p: Player = {id:1,connected:true,x:sx,z:sz,feetY:fieldHeight(f,sx,sz),yaw:Math.atan2(-fx,-fz),pitch:0};
        for (let k=0;k<120;k++) {
          moveOperator(p,{forward:1,right:0,yaw:p.yaw,pitch:0,jump:true},dt,map.geometry);
          if (p.feetY! < fieldHeight(f,p.x,p.z)-0.01) { under++; break; }
        }
      }
    }
  }
  assert.ok(tried >= 60,'enough steep spots: '+tried);
  assert.equal(under,0,'under the ground in '+under+' of '+tried+' tries');
});
