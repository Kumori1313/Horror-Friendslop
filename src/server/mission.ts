import { anchor, distances, nextWiredBay, type Layout } from '../layout.ts';
import { distance, items, kept, sameStorey, strikeRadius } from '../mission.ts';
import type { Contract, Mission, Receipt } from '../mission.ts';
import type { Player, Snapshot } from '../room.ts';
import { expeditionSeed, facilityValue } from '../salvage.ts';
import { generateLayout } from './generate-layout.ts';
import { placeOf } from '../places.ts';

export const expeditionsPerContract = 3;
// The quota asks for a little under half of everything the three facilities hold.
export const quotaShare = 0.45;

export function newContract(seed: number, expeditions = expeditionsPerContract): Contract {
  let total = 0;
  for (let i=0;i<expeditions;i++) total += facilityValue(generateLayout(expeditionSeed(seed,i)));
  return {seed:seed >>> 0,expeditions,index:0,layout:seed >>> 0,quota:Math.floor(total*quotaShare/10)*10,credited:0,receipts:[]};
}

export function newMission(layout: Layout, contract = newContract(layout.seed)): Mission {
  return {stage:'explore',contract,haul:[],down:[],diver:{mode:'dormant',bay:'',seconds:0}};
}

export function warn(mission: Mission, bay: string) {
  mission.diver = {mode:'warning',bay,seconds:4};
}

// The first salvage lifted wakes the Bell Diver in the room farthest from it.
export function wake(layout: Layout, mission: Mission, room: string) {
  if (mission.awake) return;
  mission.awake = true;
  const steps = distances(layout.rooms,layout.passages,room);
  const far = layout.rooms.reduce((a,b) => (steps.get(b.id) ?? 0) > (steps.get(a.id) ?? 0) ? b : a);
  mission.diver = {mode:'quiet',bay:far.id,seconds:6};
}

// Sell the lift and the packs of the operators extracting. Every operator
// left behind multiplies the haul by 0.8, and their pack is lost.
export function settle(layout: Layout, state: Snapshot, mission: Mission, leaving: number[]) {
  const sold = items(layout,mission).filter(i => i.loaded || (i.owner !== null && leaving.includes(i.owner)));
  const gross = sold.reduce((sum,i) => sum+i.value,0);
  const lost = state.players.filter(p => !leaving.includes(p.id)).length;
  const credited = kept(gross,lost);
  const c = mission.contract;
  const receipt: Receipt = {expedition:c.index,items:sold.map(i => ({kind:i.kind,value:i.value})),gross,deduction:gross-credited,credited,lost};
  c.receipts.push(receipt);
  c.credited += receipt.credited;
  mission.haul = [];
  mission.down = [];
  mission.diver = {mode:'dormant',bay:'',seconds:0};
  if (c.credited >= c.quota) { mission.stage = 'won'; mission.outcome = 'quota'; }
  else if (c.index+1 >= c.expeditions) { mission.stage = 'lost'; mission.outcome = 'deadline'; }
  else mission.stage = 'settled';
  Object.assign(state.lamp,{owner:null,stowed:false});
  return receipt;
}

// `locate` names the room whose floor an operator stands on.
export function advanceMission(layout: Layout, state: Snapshot, mission: Mission, dt: number, locate: (p: Player) => string | undefined) {
  for (const down of mission.down) down.seconds = Math.max(0,down.seconds-dt);
  if (mission.down.some(d => d.seconds === 0)) {
    mission.stage = 'lost'; mission.outcome = 'stranded';
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
        // It hunts only inside the facility; operators elsewhere are out of reach.
        const crew = state.players.filter(p => p.connected && placeOf(p) === 'inside' && !mission.down.some(d => d.id === p.id));
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
    if (placeOf(p) !== 'inside' || distance(p,bay) > strikeRadius || !sameStorey(p,bay) || mission.down.some(d => d.id === p.id)) continue;
    mission.down.push({id:p.id,seconds:75});
    if (state.lamp.owner === p.id) Object.assign(state.lamp,{x:p.x,z:p.z,y:(p.feetY ?? 0)+0.14,owner:null,pitch:0,stowed:false});
  }
  // A crew wipe ends the contract.
  if (mission.down.length === (mission.solo ? 1 : state.players.length)) { mission.stage = 'lost'; mission.outcome = 'wipe'; }
}
