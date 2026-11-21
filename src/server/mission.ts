import { nextWiredBay, type Layout } from '../layout.ts';
import { distance, strikeRadius } from '../mission.ts';
import type { Mission } from '../mission.ts';
import type { Snapshot } from '../room.ts';

export function newMission(layout: Layout): Mission {
  return { stage:layout.callout === 'black-start' ? 'prime' : 'trace', down:[], diver:{mode:'dormant',bay:'',seconds:0} };
}

export function warn(mission: Mission, bay: string) {
  mission.diver = {mode:'warning',bay,seconds:4};
}

export function advanceMission(layout: Layout, state: Snapshot, mission: Mission, dt: number) {
  for (const down of mission.down) down.seconds = Math.max(0,down.seconds-dt);
  if (mission.down.some(d => d.seconds === 0)) {
    mission.stage = 'lost';
    return;
  }
  const diver = mission.diver;
  if (diver.mode === 'dormant') return;
  diver.seconds -= dt;
  if (diver.seconds <= 0) {
    switch (diver.mode) {
      case 'warning':
        diver.mode = 'strike'; diver.seconds = 1.5;
        break;
      case 'strike':
        diver.mode = 'quiet'; diver.seconds = 9;
        break;
      case 'quiet':
      case 'tracking': {
        const crew = state.players.filter(p => p.connected && !mission.down.some(d => d.id === p.id));
        const target = crew.find(p => p.id === state.lamp.owner && state.lamp.on) ?? crew[0];
        if (target) {
          const bay = layout.rooms.reduce((a,b) => distance(a,target) < distance(b,target) ? a : b);
          if (bay.id === diver.bay) warn(mission,bay.id);
          else {
            diver.bay = nextWiredBay(layout,diver.bay,bay.id);
            diver.mode = 'tracking';
            diver.seconds = 1.1;
          }
        }
        return;
      }
    }
  }
  if (diver.mode !== 'strike') return;
  const bay = layout.rooms.find(r => r.id === diver.bay)!;
  for (const p of state.players) {
    if (distance(p,bay) > strikeRadius || mission.down.some(d => d.id === p.id)) continue;
    mission.down.push({id:p.id,seconds:75});
    if (state.lamp.owner === p.id) Object.assign(state.lamp,{x:p.x,z:p.z,y:0.14,owner:null,pitch:0});
  }
  if (mission.down.length === (mission.solo ? 1 : 2)) mission.stage = 'lost';
}
