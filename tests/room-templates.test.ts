import assert from 'node:assert/strict';
import { test } from 'node:test';
import { geometryFor, socketGroups, stairwellLayout, walkable } from '../src/layout.ts';
import { assembleTemplates, orient, roomTemplates, surfaceAt, surfaceHeight } from '../src/room-templates.ts';
import type { TemplateKind } from '../src/room-templates.ts';
import { Simulation } from '../src/server/simulation.ts';

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
      for (const s of t.sockets) assert.ok(reached(inward(s)),kind+' turned '+turn+': '+s.name);
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
