import assert from 'node:assert/strict';
import { test } from 'node:test';
import { geometryFor, socketGroups, stairwellLayout, walkable } from '../src/layout.ts';
import { assembleTemplates, orient, roomTemplates, surfaceAt, surfaceHeight } from '../src/room-templates.ts';
import type { TemplateKind } from '../src/room-templates.ts';
import { Simulation } from '../src/server/simulation.ts';
import { generateLayout } from '../src/server/generate-layout.ts';

test('stacked rooms have separate supports, and sockets must match in three dimensions',()=>{
  const plan=stairwellLayout(), geometry=geometryFor(plan);
  assert.equal(surfaceAt(geometry,16,-16,4)?.room,'closet');
  assert.equal(surfaceAt(geometry,16,-16,0)?.room,'tunnel');
  assert.equal(surfaceAt(geometry,10,-4,0),undefined,'inside corner of the tunnel must be solid');
  assert.equal(surfaceAt(geometry,12,-16,4)?.room,'hall');
  assert.equal(surfaceAt(geometry,12,-16,0)?.room,'hall');
  const moved=plan.rooms.map(room=>room.id==='closet' ? {...room,y:3} : room);
  assert.throws(()=>assembleTemplates(moved,plan.passages),/Misaligned sockets/);
});

test('rotated templates keep their walking routes, ramps and sockets',()=>{
  for (const kind of Object.keys(roomTemplates) as TemplateKind[]) {
    const groups=socketGroups(kind);
    assert.ok([...groups.values()].every(group=>group===0),kind+' has a doorway that cannot be reached from the others');
    for (const turn of [1,2,3]) {
      const t=orient(kind,turn), base=roomTemplates[kind];
      const g=assembleTemplates([{id:'probe',template:kind,x:0,y:0,z:0,turn}],[],true);
      const inward=(s:typeof t.sockets[number])=>{
        const [dx,dz]={north:[0,0.5],east:[-0.5,0],south:[0,-0.5],west:[0.5,0]}[s.side];
        return {x:s.x+dx,y:s.y,z:s.z+dz};
      };
      const reached=walkable(g,inward(t.sockets[0]));
      // Shaft links join two decks and are exercised in the assembled tower.
      for (const s of t.sockets.filter(s => !s.shaft)) assert.ok(reached(inward(s)),kind+' turned '+turn+': '+s.name);
      // A turned ramp climbs between the same two heights at the matching ends.
      base.surfaces.forEach((s,i)=>{
        if (!s.rise) return;
        const r=t.surfaces[i];
        const ends=(p:typeof r)=>p.along ? [surfaceHeight(p,p.x-p.w/2,p.z),surfaceHeight(p,p.x+p.w/2,p.z)] : [surfaceHeight(p,p.x,p.z-p.d/2),surfaceHeight(p,p.x,p.z+p.d/2)];
        assert.deepEqual(ends(r).sort(),ends(s).sort());
      });
    }
  }
});

test('walk from Intake to the upper closet, descend to the tunnel and return',()=>{
  const sim=new Simulation(stairwellLayout(),'solo');
  assert.equal(sim.join(),1);
  assert.equal(sim.join(),undefined);
  assert.equal(sim.state.mission,undefined);
  const p=sim.state.players[0];
  function walk(axis:'x'|'z',target:number) {
    for (let n=0;n<300;n++) {
      const delta=target-p[axis];
      if (Math.abs(delta)<0.001) return;
      const direction=Math.sign(delta);
      sim.inputs.set(1,{forward:axis==='z'?-direction:0,right:axis==='x'?direction:0,yaw:0,pitch:0});
      sim.tick(Math.min(1/30,Math.abs(delta)/3.3));
    }
    assert.fail('Blocked while walking to '+axis+'='+target+' at '+JSON.stringify(p));
  }
  sim.act(1,'take');
  walk('x',0); walk('z',-16);
  assert.equal(p.feetY,4);
  walk('x',16);
  assert.equal(sim.roomOf(p),'closet');
  assert.equal(sim.state.lamp.y,5.28);
  sim.act(1,'drop');
  assert.equal(sim.state.lamp.y,4.14);
  walk('x',9); walk('z',-7);
  assert.equal(p.feetY,0);
  walk('x',12); walk('z',-16); walk('x',16);
  assert.equal(sim.roomOf(p),'tunnel');
  sim.act(1,'take');
  assert.equal(sim.state.lamp.owner,null,'the closet floor blocks pickup from the tunnel');
  walk('z',0); walk('x',0);
  assert.equal(sim.roomOf(p),'intake');
  // Walk the route in reverse to verify both approach directions at the ramp toe.
  walk('x',16); walk('z',-16); walk('x',12); walk('z',-7); walk('x',9);
  walk('z',-16); walk('x',16);
  sim.act(1,'take');
  assert.equal(sim.state.lamp.owner,1);
  walk('x',0); walk('z',0);
  assert.equal(p.feetY,0);
  assert.equal(sim.roomOf(p),'intake');
});

test('rooms never draw walls in the same place, so their materials cannot flicker through each other', () => {
  for (const seed of [0,19,20,77,715,4242]) {
    const walls = geometryFor(generateLayout(seed)).walls;
    const overlap = (a: typeof walls[number], b: typeof walls[number]) =>
      Math.min(a.x+a.w/2,b.x+b.w/2)-Math.max(a.x-a.w/2,b.x-b.w/2) > 1e-6 &&
      Math.min(a.z+a.d/2,b.z+b.d/2)-Math.max(a.z-a.d/2,b.z-b.d/2) > 1e-6 &&
      Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y) > 1e-6;
    for (let i=0;i<walls.length;i++) for (let j=i+1;j<walls.length;j++) {
      if (walls[i].room !== walls[j].room) assert.ok(!overlap(walls[i],walls[j]),'seed '+seed+': '+walls[i].room+' and '+walls[j].room+' share wall volume');
    }
  }
  // Each room keeps its wall face 6 cm inside its boundary, as before.
  const g = geometryFor(stairwellLayout());
  const north = g.walls.find(w => w.room === 'intake' && w.w > 1 && Math.abs(w.z+2) < 0.1)!;
  assert.equal(+(north.z+north.d/2).toFixed(6),-1.94);
});

test('ramps are solid underneath: an operator can step off a ramp\'s side but not walk under it', async () => {
  const { moveOperator } = await import('../src/server/simulation.ts');
  const g = geometryFor(stairwellLayout()), ramp = g.surfaces.find(s => s.rise && !s.stairs)!;
  const walk = (p: Parameters<typeof moveOperator>[0], right: number, forward: number, seconds: number, geometry = g) => {
    for (let t=0;t<seconds;t+=1/30) moveOperator(p,{forward,right,yaw:0,pitch:0},1/30,geometry);
  };
  // Halfway up, step off the side: the operator lands on the hall floor below.
  const onRamp = {id:1,connected:true,x:ramp.x,z:ramp.z,feetY:surfaceHeight(ramp,ramp.x,ramp.z),yaw:0,pitch:0};
  assert.ok(onRamp.feetY > 1.5);
  walk(onRamp,-1,0,1);
  assert.equal(onRamp.feetY,0,'dropped to the floor');
  assert.ok(onRamp.x <= ramp.x-ramp.w/2-0.25+1e-9,'landed clear of the ramp\'s side at x='+onRamp.x);
  // From the floor, the ramp's side is a wall: the body stays out of it.
  walk(onRamp,1,0,1);
  assert.ok(Math.abs(onRamp.x-(ramp.x-ramp.w/2-0.25)) < 0.15,'stopped at arm\'s length, x='+onRamp.x);
  assert.equal(onRamp.feetY,0);
});
