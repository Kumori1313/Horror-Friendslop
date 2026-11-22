import { anchor, nextWiredBay, type Layout } from '../layout.ts';
import { distance, sameStorey, strikeRadius } from '../mission.ts';
import type { Mission } from '../mission.ts';
import type { Player, Snapshot } from '../room.ts';

export function newMission(layout: Layout): Mission {
  return { stage:layout.callout === 'black-start' ? 'prime' : 'trace', down:[], diver:{mode:'dormant',bay:'',seconds:0} };
}

export function warn(mission: Mission, bay: string) {
  mission.diver = {mode:'warning',bay,seconds:4};
}

// `locate` names the room whose floor an operator stands on.
export function advanceMission(layout: Layout, state: Snapshot, mission: Mission, dt: number, locate: (p: Player) => string | undefined) {
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
          const bay = locate(target) ?? layout.rooms.reduce((a,b) => {
            const pa = anchor(a), pb = anchor(b), feet = target.feetY ?? 0;
            return Math.hypot(pa.x-target.x,pa.y-feet,pa.z-target.z) < Math.hypot(pb.x-target.x,pb.y-feet,pb.z-target.z) ? a : b;
          }).id;
          if (bay === diver.bay) warn(mission,bay);
          else {
            diver.bay = nextWiredBay(layout,diver.bay,bay);
            diver.mode = 'tracking';
            diver.seconds = 1.1;
          }
        }
        return;
      }
    }
  }
  if (diver.mode !== 'strike') return;
  const bay = anchor(layout.rooms.find(r => r.id === diver.bay)!);
  for (const p of state.players) {
    if (distance(p,bay) > strikeRadius || !sameStorey(p,bay) || mission.down.some(d => d.id === p.id)) continue;
    mission.down.push({id:p.id,seconds:75});
    if (state.lamp.owner === p.id) Object.assign(state.lamp,{x:p.x,z:p.z,y:(p.feetY ?? 0)+0.14,owner:null,pitch:0});
  }
  if (mission.down.length === (mission.solo ? 1 : 2)) mission.stage = 'lost';
}
