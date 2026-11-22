import assert from 'node:assert/strict';
import { nearbyDoor } from '../src/layout.ts';
import { route } from '../src/route.ts';
import type { Simulation } from '../src/server/simulation.ts';

// Hold one key at a time along each leg, opening bulkheads on the way.
export function walkRoute(sim: Simulation, id: number, to: {x:number; y:number; z:number}) {
  const p = sim.state.players.find(player => player.id === id)!;
  const legs = route(sim.layout!,{x:p.x,y:p.feetY ?? 0,z:p.z},to);
  assert.ok(legs,'no route to '+JSON.stringify(to));
  for (const leg of legs) for (const axis of ['x','z'] as const) {
    for (let n=0;Math.abs(leg[axis]-p[axis])>0.01;n++) {
      assert.ok(n<900,'blocked walking to '+JSON.stringify(leg)+' at '+JSON.stringify(p));
      const delta = leg[axis]-p[axis], direction = Math.sign(delta);
      if (sim.geometry && nearbyDoor(p,sim.geometry,sim.state.opened!)) sim.act(id,'open-door');
      sim.inputs.set(id,{forward:axis==='z'?-direction:0,right:axis==='x'?direction:0,yaw:0,pitch:0});
      sim.tick(Math.min(1/30,Math.abs(delta)/3.3));
    }
  }
  sim.inputs.set(id,{forward:0,right:0,yaw:0,pitch:0});
  return p;
}
