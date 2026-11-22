import assert from 'node:assert/strict';
import { test } from 'node:test';
import { geometryFor, stairwellLayout } from '../src/layout.ts';
import { assembleTemplates, stairwellLinks, stairwellRooms, surfaceAt } from '../src/room-templates.ts';
import { Simulation } from '../src/server/simulation.ts';

test('stacked rooms have separate supports, and sockets must match in three dimensions',()=>{
  const geometry=geometryFor(stairwellLayout()).templates!;
  assert.equal(surfaceAt(geometry,16,-15,4)?.room,'closet');
  assert.equal(surfaceAt(geometry,16,-15,0)?.room,'tunnel');
  assert.equal(surfaceAt(geometry,10,-4,0),undefined,'inside corner of the tunnel must be solid');
  assert.equal(surfaceAt(geometry,12,-15,4)?.room,'hall');
  assert.equal(surfaceAt(geometry,12,-15,0)?.room,'hall');
  const moved=stairwellRooms.map(room=>room.id==='closet' ? {...room,y:3} : room);
  assert.throws(()=>assembleTemplates(moved,stairwellLinks),/Misaligned sockets/);
});

test('walk from Intake to the upper closet, descend to the tunnel and return',()=>{
  const sim=new Simulation(stairwellLayout(),'solo');
  assert.equal(sim.join(),1);
  assert.equal(sim.join(),undefined);
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
  walk('x',0); walk('z',-15);
  assert.equal(p.feetY,4);
  walk('x',16);
  assert.equal(sim.state.lamp.y,5.28);
  sim.act(1,'drop');
  assert.equal(sim.state.lamp.y,4.14);
  walk('x',9); walk('z',-7);
  assert.equal(p.feetY,0);
  walk('x',12); walk('z',-15); walk('x',16);
  sim.act(1,'take');
  assert.equal(sim.state.lamp.owner,null,'the closet floor blocks pickup from the tunnel');
  walk('z',0); walk('x',0);
  assert.equal(surfaceAt(sim.geometry!.templates!,p.x,p.z,p.feetY!)?.room,'intake');
  // Walk the route in reverse to verify both approach directions at the ramp toe.
  walk('x',16); walk('z',-15); walk('x',12); walk('z',-7); walk('x',9);
  walk('z',-15); walk('x',16);
  sim.act(1,'take');
  assert.equal(sim.state.lamp.owner,1);
  walk('x',0); walk('z',0);
  assert.equal(p.feetY,0);
});
