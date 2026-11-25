import { anchor, connections, nextWiredBay, neighbours, zoneAt, type Layout } from '../layout.ts';
import { storey } from '../room-templates.ts';
import { gone, items, kept, pace, sameStorey, sprawl, stunTime } from '../mission.ts';
import type { Contract, Diver, Mission, Receipt } from '../mission.ts';
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

// A fresh contract after a wipe: new facilities and quota, nothing credited.
// Its seed follows from the old one, so a reported wipe can be replayed.
export const wipeSeed = (seed: number) => expeditionSeed(seed,7919);

// The first salvage lifted wakes the Bell Diver in the room farthest from it.
export function wake(layout: Layout, mission: Mission, room: string) {
  if (mission.awake) return;
  mission.awake = true;
  const hops = connections(layout);
  const far = layout.rooms.reduce((a,b) => hops(room,b.id) > hops(room,a.id) ? b : a);
  const a = anchor(far);
  mission.diver = {mode:'quiet',bay:far.id,seconds:6,x:a.x,y:a.y,z:a.z,moves:0};
}

// The storey whose floor an operator stands on.
const storeyOf = (p: Player) => Math.round((p.feetY ?? 0)/storey)*storey;

// Drag into a room through the wiring, choosing this move's chain clip. It
// settles above an operator in that room, or above the room's pad, taking
// `travel` seconds to get there from where it was.
function enter(layout: Layout, diver: Diver, room: string, over: Player | undefined, travel: number, random: () => number) {
  const a = anchor(layout.rooms.find(r => r.id === room)!);
  const to = over ? {x:over.x,y:storeyOf(over),z:over.z} : {x:a.x,y:a.y,z:a.z};
  const zone = zoneAt(layout,diver.bay,diver.x ?? a.x,diver.z ?? a.z);
  diver.from = {bay:diver.bay,x:diver.x ?? a.x,y:diver.y ?? a.y,z:diver.z ?? a.z};
  diver.travel = travel;
  Object.assign(diver,to);
  // Crossing to another zone of the same room is a move too, and rattles.
  if (room === diver.bay && zoneAt(layout,room,to.x,to.z) === zone) return;
  diver.bay = room;
  diver.moves = (diver.moves ?? 0)+1;
  diver.clip = random() < 0.5 ? 0 : 1;
}

// A struck operator goes down and drops the flashlight; they keep their salvage.
function strike(state: Snapshot, mission: Mission, p: Player) {
  mission.down.push({id:p.id,seconds:75});
  if (state.lamp.owner === p.id) Object.assign(state.lamp,{x:p.x,z:p.z,y:(p.feetY ?? 0)+0.14,owner:null,pitch:0,stowed:false});
}

// A thrown item reached it: no drops or moves for `stunTime` seconds, and a
// fall in progress turns into a climb from where it is.
export function stun(mission: Mission) {
  const diver = mission.diver, p = pace(mission);
  if (diver.mode === 'dormant') return;
  diver.stun = stunTime;
  delete diver.drop;
  if (diver.mode === 'falling') {
    const lowered = (1-Math.max(0,diver.seconds)/p.fall)**2;
    diver.mode = 'rising'; diver.seconds = p.rise*lowered;
  }
}

// Once it has arrived and someone shares its zone and storey, the Diver waits
// `pace.wait` seconds, resetting if they all leave, then falls for
// `pace.fall` seconds whatever they do and strikes everyone beneath it when
// it lands. It lies there, climbs back and rests. Otherwise, every
// `pace.step` seconds it drags itself one room toward the nearest operator no
// more than `pace.reach` connections away, rechecking after each move; with
// nobody in reach it wanders to a random neighbouring room every
// `pace.wander` seconds.
function hunt(layout: Layout, state: Snapshot, mission: Mission, dt: number, locate: (p: Player) => string | undefined, random: () => number) {
  const diver = mission.diver, p = pace(mission);
  if (diver.mode === 'dormant') return;
  // It hunts only inside the facility; operators elsewhere are out of reach.
  const prey = state.players.filter(q => q.connected && placeOf(q) === 'inside' && !gone(mission,q.id) && !mission.down.some(d => d.id === q.id));
  const here = () => zoneAt(layout,diver.bay,diver.x ?? 0,diver.z ?? 0);
  const beneath = () => prey.filter(q => locate(q) === diver.bay && sameStorey(q,{y:diver.y ?? 0}) && zoneAt(layout,diver.bay,q.x,q.z) === here());
  if (diver.incoming !== undefined) {
    diver.incoming -= dt;
    if (diver.incoming <= 0) { delete diver.incoming; stun(mission); }
  }
  if (diver.stun !== undefined) {
    diver.stun -= dt;
    if (diver.stun <= 0) delete diver.stun;
  }
  if (diver.mode !== 'hanging') {
    diver.seconds -= dt;
    if (diver.seconds > 0) return;
    switch (diver.mode) {
      case 'falling':
        for (const q of beneath()) strike(state,mission,q);
        diver.mode = 'strike'; diver.seconds = sprawl; return;
      case 'strike': diver.mode = 'rising'; diver.seconds = p.rise; return;
      case 'rising': diver.mode = 'quiet'; diver.seconds = p.quiet; return;
      default: diver.mode = 'hanging'; diver.seconds = 0;
    }
  }
  // Still dragging itself into place.
  if (diver.travel !== undefined) {
    diver.travel -= dt; diver.seconds -= dt;
    if (diver.travel > 0) return;
    delete diver.travel; delete diver.from;
    return;
  }
  // Stunned: it hangs where it is until it comes round.
  if (diver.stun !== undefined) return;
  if (beneath().length) {
    diver.drop = (diver.drop ?? p.wait)-dt;
    if (diver.drop > 0) return;
    delete diver.drop;
    diver.mode = 'falling'; diver.seconds = p.fall;
    return;
  }
  delete diver.drop;
  diver.seconds -= dt;
  if (diver.seconds > 0) return;
  const hops = connections(layout);
  const chase = prey.map(q => ({q,room:locate(q)}))
    .filter((t): t is {q: Player; room: string} => t.room !== undefined && hops(diver.bay,t.room) <= p.reach)
    .sort((a,b) => hops(diver.bay,a.room)-hops(diver.bay,b.room) || Number(b.q.id === state.lamp.owner)-Number(a.q.id === state.lamp.owner))[0];
  if (chase) {
    const next = nextWiredBay(layout,diver.bay,chase.room);
    enter(layout,diver,next,next === chase.room ? chase.q : undefined,p.travel,random);
    diver.seconds = p.step;
  } else {
    const around = neighbours(layout,diver.bay);
    if (around.length) enter(layout,diver,around[Math.min(around.length-1,Math.floor(random()*around.length))],undefined,p.travel,random);
    diver.seconds = p.wander;
  }
}

// When an expedition ends, gear comes home only if it is there already or
// carried by an operator who escaped; the rest is lost, the flashlight too.
// The facility's salvage was sold or is lost with it.
function bringHome(state: Snapshot, mission: Mission) {
  const escaped = mission.escaped ?? [];
  const safe = (owner: number | null, place: string) => owner !== null ? escaped.includes(owner) : place === 'home';
  mission.haul = mission.haul.filter(h => h.kind && !h.used && !h.banked && safe(h.owner,placeOf(h)));
  const lamp = state.lamp;
  if (!lamp.lost && !lamp.homeward && !safe(lamp.owner,placeOf(lamp))) Object.assign(lamp,{lost:true,on:false});
}

// Sell what went into the rift. Every operator who didn't escape, whether
// dead, downed, or outside when it closed, multiplies the haul by 0.8; what
// they carried is lost.
export function settle(layout: Layout, state: Snapshot, mission: Mission) {
  const escaped = mission.escaped ?? [];
  // Spare cells are worth nothing and stay off the receipt.
  const sold = items(layout,mission).filter(i => i.banked && i.value > 0);
  const gross = sold.reduce((sum,i) => sum+i.value,0);
  const lost = state.players.filter(p => !escaped.includes(p.id)).length;
  const credited = kept(gross,lost);
  const c = mission.contract;
  const receipt: Receipt = {expedition:c.index,items:sold.map(i => ({kind:i.kind,value:i.value})),gross,deduction:gross-credited,credited,lost};
  c.receipts.push(receipt);
  c.credited += receipt.credited;
  bringHome(state,mission);
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
  bringHome(state,mission);
  mission.down = [];
  mission.diver = {mode:'dormant',bay:'',seconds:0};
  Object.assign(state.lamp,{owner:null,stowed:false});
}

// A downed operator nobody reached in time dies. They drop what they carry
// where they fell, so a partner can still recover it.
// Drowned in deep water, what they carried sinks and is lost with them.
export function die(state: Snapshot, mission: Mission, id: number, sunk = false) {
  mission.down = mission.down.filter(d => d.id !== id);
  mission.drowning = mission.drowning?.filter(d => d.id !== id);
  (mission.dead ??= []).push(id);
  const p = state.players.find(q => q.id === id);
  if (!p) return;
  for (const h of mission.haul) if (h.owner === id) Object.assign(h,{owner:null,x:p.x,y:p.feetY ?? 0,z:p.z,place:p.place},sunk ? {used:true} : {});
  if (state.lamp.owner === id) Object.assign(state.lamp,{owner:null,x:p.x,z:p.z,y:(p.feetY ?? 0)+0.14,pitch:0,stowed:false,place:p.place},sunk ? {lost:true,on:false} : {});
  p.slots = p.slots?.map(() => null);
}

// `locate` names the room whose floor an operator stands on.
export function advanceMission(layout: Layout, state: Snapshot, mission: Mission, dt: number, locate: (p: Player) => string | undefined, random: () => number = Math.random) {
  for (const down of mission.down) down.seconds = Math.max(0,down.seconds-dt);
  for (const d of mission.down.filter(d => d.seconds === 0)) die(state,mission,d.id);
  if (mission.rift) {
    mission.rift.seconds = Math.max(0,mission.rift.seconds-dt);
    if (mission.rift.seconds === 0) { endExpedition(layout,state,mission); return; }
  }
  // Once nobody is left who could still act, the expedition ends at once.
  const active = state.players.filter(p => !gone(mission,p.id) && !mission.down.some(d => d.id === p.id));
  if (!active.length) { endExpedition(layout,state,mission); return; }
  hunt(layout,state,mission,dt,locate,random);
}
