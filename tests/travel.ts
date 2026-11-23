import { home, outdoors, placeOf } from '../src/places.ts';
import type { Simulation } from '../src/server/simulation.ts';

// Take every operator from the home dimension through the rift, across the
// outdoor map to the façade, and in through its door to Intake. Operators
// are placed beside each doorway rather than walked there.
export function goInside(sim: Simulation) {
  for (const p of sim.state.players) {
    if (placeOf(p) === 'home') { Object.assign(p,home().rift); sim.tick(1/60); }
  }
  const map = outdoors(sim.layout!.seed);
  for (const p of sim.state.players) {
    if (placeOf(p) !== 'outside') continue;
    Object.assign(p,{x:map.door.x,z:map.door.z+0.8,feetY:0});
    sim.act(p.id,'open-door');
  }
}
