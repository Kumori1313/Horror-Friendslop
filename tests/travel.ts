import { groundAt, home, intakeDoor, outdoors, placeOf } from '../src/places.ts';
import { lampSlot, slotsOf } from '../src/room.ts';
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

const player = (sim: Simulation, id: number) => sim.state.players.find(p => p.id === id)!;

// Out through Intake's door to the façade.
export function goOutside(sim: Simulation, id: number) {
  const p = player(sim,id);
  if (placeOf(p) !== 'inside') return;
  Object.assign(p,{x:intakeDoor.x,z:intakeDoor.z-1,feetY:0});
  sim.act(id,'open-door');
}

// Walk up to the bell and ring it.
export function ring(sim: Simulation, id: number) {
  goOutside(sim,id);
  Object.assign(player(sim,id),{...outdoors(sim.layout!.seed).ringing,feetY:0});
  sim.act(id,'operate');
}

// Throw everything the operator carries into the open rift, from just in front of it.
export function bank(sim: Simulation, id: number) {
  const rift = sim.state.mission!.rift!, p = player(sim,id);
  goOutside(sim,id);
  for (let slot=0;slot<4;slot++) {
    const item = slotsOf(p)[slot];
    if (!item || item === lampSlot) continue;
    const map = outdoors(sim.layout!.seed);
    Object.assign(p,{x:rift.x,z:rift.z+2.5,feetY:groundAt(map,rift.x,rift.z+2.5)});
    sim.act(id,'select',{slot});
    sim.act(id,'throw',{aim:{yaw:0,pitch:0.1,power:0.25}});
  }
}

// Walk into the open rift.
export function escape(sim: Simulation, id: number) {
  goOutside(sim,id);
  const rift = sim.state.mission!.rift!;
  Object.assign(player(sim,id),{x:rift.x,z:rift.z,feetY:groundAt(outdoors(sim.layout!.seed),rift.x,rift.z)});
  sim.tick(1/60);
}
