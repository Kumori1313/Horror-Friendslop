import { anchor, distances, nextWiredBay, type Layout } from '../layout.ts';
import { distance, gone, items, kept, pace, sameStorey } from '../mission.ts';
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
  mission.diver = {mode:'warning',bay,seconds:pace(mission).warning};
}

// A fresh contract after a wipe: new facilities and quota, nothing credited.
// Its seed follows from the old one, so a reported wipe can be replayed.
export const wipeSeed = (seed: number) => expeditionSeed(seed,7919);

// The first salvage lifted wakes the Bell Diver in the room farthest from it.
export function wake(layout: Layout, mission: Mission, room: string) {
  if (mission.awake) return;
  mission.awake = true;
  const steps = distances(layout.rooms,layout.passages,room);
  const far = layout.rooms.reduce((a,b) => (steps.get(b.id) ?? 0) > (steps.get(a.id) ?? 0) ? b : a);
  mission.diver = {mode:'quiet',bay:far.id,seconds:6};
}

// Sell what went into the rift. Every operator who didn't escape, whether
// dead, downed, or outside when it closed, multiplies the haul by 0.8; what
// they carried is lost.
export function settle(layout: Layout, state: Snapshot, mission: Mission) {
  const escaped = mission.escaped ?? [];
  const sold = items(layout,mission).filter(i => i.banked);
  const gross = sold.reduce((sum,i) => sum+i.value,0);
  const lost = state.players.filter(p => !escaped.includes(p.id)).length;
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

// The expedition is over: sold if anyone escaped, otherwise a crew wipe.
// A wipe credits nothing; Continue starts a fresh contract.
export function endExpedition(layout: Layout, state: Snapshot, mission: Mission) {
  if (mission.escaped?.length) return settle(layout,state,mission);
  mission.stage = 'settled'; mission.outcome = 'wipe';
  mission.haul = []; mission.down = [];
  mission.diver = {mode:'dormant',bay:'',seconds:0};
  Object.assign(state.lamp,{owner:null,stowed:false});
}

// A downed operator nobody reached in time dies. They drop what they carry
// where they fell, so a partner can still recover it.
function die(state: Snapshot, mission: Mission, id: number) {
  mission.down = mission.down.filter(d => d.id !== id);
  (mission.dead ??= []).push(id);
  const p = state.players.find(q => q.id === id);
  if (!p) return;
  for (const h of mission.haul) if (h.owner === id) Object.assign(h,{owner:null,x:p.x,y:p.feetY ?? 0,z:p.z,place:p.place});
  if (state.lamp.owner === id) Object.assign(state.lamp,{owner:null,x:p.x,z:p.z,y:(p.feetY ?? 0)+0.14,pitch:0,stowed:false,place:p.place});
  p.slots = p.slots?.map(() => null);
}

// `locate` names the room whose floor an operator stands on.
export function advanceMission(layout: Layout, state: Snapshot, mission: Mission, dt: number, locate: (p: Player) => string | undefined) {
  for (const down of mission.down) down.seconds = Math.max(0,down.seconds-dt);
  for (const d of mission.down.filter(d => d.seconds === 0)) die(state,mission,d.id);
  if (mission.rift) {
    mission.rift.seconds = Math.max(0,mission.rift.seconds-dt);
    if (mission.rift.seconds === 0) { endExpedition(layout,state,mission); return; }
  }
  // Once nobody is left who could still act, the expedition ends at once.
  const active = state.players.filter(p => !gone(mission,p.id) && !mission.down.some(d => d.id === p.id));
  if (!active.length) { endExpedition(layout,state,mission); return; }
  const diver = mission.diver;
  if (diver.mode === 'dormant') return;
  diver.seconds -= dt;
  if (diver.seconds <= 0) {
    switch (diver.mode) {
      case 'warning':
        diver.mode = 'strike'; diver.seconds = 1.5;
        break;
      case 'strike':
        diver.mode = 'quiet'; diver.seconds = pace(mission).quiet;
        break;
      case 'quiet':
      case 'tracking': {
        // It hunts only inside the facility; operators elsewhere are out of reach.
        const crew = state.players.filter(p => p.connected && placeOf(p) === 'inside' && !gone(mission,p.id) && !mission.down.some(d => d.id === p.id));
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
            diver.seconds = pace(mission).step;
          }
        }
        return;
      }
    }
  }
  if (diver.mode !== 'strike') return;
  const bay = anchor(layout.rooms.find(r => r.id === diver.bay)!);
  for (const p of state.players) {
    if (placeOf(p) !== 'inside' || gone(mission,p.id) || distance(p,bay) > pace(mission).radius || !sameStorey(p,bay) || mission.down.some(d => d.id === p.id)) continue;
    mission.down.push({id:p.id,seconds:75});
    if (state.lamp.owner === p.id) Object.assign(state.lamp,{x:p.x,z:p.z,y:(p.feetY ?? 0)+0.14,owner:null,pitch:0,stowed:false});
  }
}
