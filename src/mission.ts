import { anchor, connections, type Layout } from './layout.ts';
import { roomTemplates } from './room-templates.ts';
import { canTake, clearAt, freeSlot } from './room.ts';
import type { Flight } from './flight.ts';
import { doorReach, home, outdoors, placeOf } from './places.ts';
import type { Place } from './places.ts';
import type { Player, Point, Snapshot, Ware } from './room.ts';
import type { Point3 } from './room-templates.ts';
import type { Rect } from './layout.ts';
import { itemKinds, spawnSalvage } from './salvage.ts';
import type { ItemKind, Salvage } from './salvage.ts';

// A contract runs several expeditions. Each one is explored, hauled back to
// the lift in Intake, and sold on extraction. `settled` waits between
// expeditions; `won` and `lost` end the contract.
// `home` waits in the home dimension for the crew to step into the rift.
export type Stage = 'home' | 'explore' | 'settled' | 'won' | 'lost';
export type Outcome = 'quota' | 'deadline' | 'wipe' | 'left';
export interface Receipt {
  expedition: number; items: {kind: ItemKind; value: number}[];
  gross: number; deduction: number; credited: number; lost: number;
}
// `spent` is what the crew has bought; the wallet is credited - spent, while
// the quota counts credited sales only. `bought` numbers bought items.
export interface Contract { seed: number; expeditions: number; index: number; layout: number; quota: number; credited: number; receipts: Receipt[]; spent?: number; bought?: number }
export const wallet = (c: Contract) => c.credited-(c.spent ?? 0);
// The home terminal's prices, and what each ware is for.
export const prices: Record<Ware,number> = {cell:40,flare:20,lamp:80,baton:100};
export const wareInfo: Record<Ware,{name: string; about: string}> = {
  cell:{name:'Spare cell',about:'Refills the flashlight. Select it while carrying the flashlight and press F.'},
  flare:{name:'Flare',about:'Throw or drop it to light: a red light for 60 seconds.'},
  lamp:{name:'Replacement flashlight',about:'Only when the flashlight was left behind. Arrives with a full battery.'},
  baton:{name:'Stun baton',about:'Swing it (T or click) to stun the Bell Diver for 6 s when it is within reach.'},
};
// Salvage that has left its spawn: carried (`owner`), dropped, thrown, or
// banked in the exit rift. A thrown item's x, y and z are where it will come
// to rest; `flight` is set until it gets there. A banked item went into the
// rift, thrown or carried by an operator who escaped.
// `used`: a spare cell loaded into the flashlight, gone for good. `kind`: a
// bought item, which has no spawn spot in the facility to say what it is.
// `burn`: a lit flare's seconds left. `homeward`: bought gear thrown into the
// exit rift, which turns up at home when its flight ends.
// `sinks`: thrown or dropped into deep water, it is lost once it lands.
// `gnawer`: being dragged off by that Gnawer.
export interface Haul extends Point3 { gnawer?: number; id: string; owner: number | null; banked?: boolean; flight?: Flight; place?: Place; used?: boolean; kind?: ItemKind; burn?: number; homeward?: boolean; sinks?: boolean }
export const flareTime = 60;
// Seconds of breath with the head under water.
export const breathTime = 4;
// Where bought gear is laid out at home: a row in front of the terminal.
export function deliverySpot(mission: Mission) {
  const t = home().terminal;
  for (let i=0;i<12;i++) {
    const spot = {x:t.x+1.4+Math.floor(i/5)*0.55,y:0,z:t.z-1+(i%5)*0.5};
    if (!mission.haul.some(h => h.owner === null && placeOf(h) === 'home' && Math.hypot(h.x-spot.x,h.z-spot.z) < 0.3)) return spot;
  }
  return {x:t.x+1.4,y:0,z:t.z};
}
// Where the Bell Diver's bell hangs now, from the ceiling or lowered on its
// chain, as drawn: the stun baton has to reach it.
export function bellSpan(layout: Layout, diver: Diver, mission: Mission) {
  const room = layout.rooms.find(r => r.id === diver.bay);
  if (!room || diver.mode === 'dormant') return;
  const a = anchor(room), top = room.y+roomTemplates[room.template].height, floor = diver.y ?? a.y, p = pace(mission);
  const reach = Math.max(0.3,Math.min(1,(top-floor-2.1-0.62)/1.2)), depth = Math.max(0,top-floor-0.62-1.2*reach);
  let lowered = 0;
  if (diver.mode === 'falling') lowered = depth*(1-Math.max(0,diver.seconds)/p.fall)**2;
  else if (diver.mode === 'strike') lowered = depth;
  else if (diver.mode === 'rising') { const f = Math.min(1,Math.max(0,diver.seconds)/p.rise); lowered = depth*f*f*(3-2*f); }
  return {x:diver.x ?? a.x,z:diver.z ?? a.z,bottom:top-0.7-lowered,top:top-lowered};
}
// A baton swing reaches 1.7 m ahead and 2.1 m above the swinger's feet. It
// takes `swingTime` seconds, and the next can start only once it's done.
export const batonReach = {ahead:1.7,up:2.1};
export const swingTime = 0.45;
export interface Mission {
  solo?: boolean;
  stage: Stage;
  // The rift the crew arrived through stays open until everyone is outside.
  arrival?: 'open' | 'closed';
  // Ringing the bell (by an operator) opens the exit rift for `seconds` and
  // enrages every creature for the rest of the expedition.
  bell?: number;
  // `y`: the ground under the exit rift (missing means 0).
  rift?: {x: number; y?: number; z: number; seconds: number};
  // Whole seconds since the expedition left home; the outdoors darkens with it.
  clock?: number;
  enraged?: boolean;
  // Operators who went into the exit rift, and those who died.
  escaped?: number[];
  dead?: number[];
  // Operators with their head under water, and the breath they have left.
  drowning?: {id: number; seconds: number}[];
  outcome?: Outcome;
  contract: Contract;
  haul: Haul[];
  awake?: boolean;
  diver: Diver;
  down: { id: number; seconds: number }[];
  // Scavengers in the facility, spawned when the expedition starts.
  gnawers?: Gnawer[];
  // The river's Lurker, outside from the start.
  lurkers?: Lurker[];
  // Stalkers roaming outside: none at first, more the longer the crew spends
  // outside (`prowl`, whole seconds with anyone outside), one more at the bell.
  stalkers?: Stalker[];
  prowl?: number;
  // Operators knocked flat by a stalker's charge, and for how much longer.
  flat?: {id: number; seconds: number}[];
}
// A stalker: a tall, gaunt thing on four long legs that roams outside, hunts
// by sight (cover breaks it), and charges anyone it sees within range: a
// wind-up (`windup`), a straight rush (`charge`) that knocks flat and hurts
// whoever it hits, then a stumble round (`recover`) before it comes again.
// `charges` counts its charges, so every client hears each wind-up once.
export interface Stalker { id: number; x: number; y: number; z: number; yaw: number; mode: 'roam' | 'stalk' | 'search' | 'windup' | 'charge' | 'recover' | 'stunned' | 'flee'; charges?: number }
// Whether this operator is lying knocked flat.
export const flatOn = (mission: Mission | undefined, id: number) => !!mission?.flat?.some(f => f.id === id);
// The Lurker: a long dark thing under the river's deep water. It patrols the
// channel, comes along the river toward anyone it hears moving nearby, and
// grabs anyone within reach (`grab`: the operator it holds), dragging them
// toward the deep water to drown. A hit (baton, thrown item, lit flare) near
// it or its victim makes it let go and sink away for a while (`sunk`).
// `grabs` counts its grabs, so every client hears each once.
export interface Lurker { id: number; x: number; y: number; z: number; yaw: number; mode: 'lurk' | 'hunt' | 'grab' | 'sunk'; grab?: number; grabs?: number }
// The Lurker holding this operator, if any.
export const heldBy = (mission: Mission | undefined, id: number) => mission?.lurkers?.find(l => l.mode === 'grab' && l.grab === id);
// Health: 100, recovering slowly once unhurt for a while, but only back to
// `recoverTo`. At none, an operator goes down; a revive brings them back with
// `revivedHealth`. Home restores everyone.
export const maxHealth = 100, recoverTo = 50, recoverAfter = 8, recoverRate = 4, revivedHealth = 35;
export const healthOf = (p: {hp?: number}) => p.hp ?? maxHealth;
// The Gnawer: a dog-sized scavenger that skitters along the facility's
// floors. It drags loose salvage off to its nest (`carry`), and bites anyone
// who comes close, knocking salvage out of their hands to take it. A baton
// hit, a thrown item or a lit flare drives it off (`flee`) and makes it drop
// what it carries. `bites` counts its bites, so every client hears each once.
export interface Gnawer {
  id: number; x: number; y: number; z: number; yaw: number;
  mode: 'roam' | 'seek' | 'chase' | 'carry' | 'flee';
  carry?: string; bites?: number; nest: Point3;
}
// The Bell Diver clings to the ceiling of one room (`bay`), above x, z, over
// the storey whose floor is at y. It drags itself one room connection at a
// time through the ceiling wiring: each move starts at `from` and takes
// `travel` seconds, counting down. Once it has arrived and an operator stands
// on its storey of its room, `drop` counts down (the wait); leaving resets it.
// At zero it falls on its chain (`falling`), committed: whoever is beneath it
// when it lands goes down (`strike`, on the floor), then it climbs back
// (`rising`) and rests (`quiet`). `seconds` is the time to its next move
// while it hangs, or what remains of the current mode. Every move to a new
// room or zone counts in `moves`, with the chain clip the host chose for it in
// `clip`. It strikes only its zone of the room (`zoneAt`). A thrown item that
// reaches it lands after `incoming` seconds and stuns it for `stun` seconds:
// no drops, no moves, and a fall in progress turns into a climb.
export interface Diver {
  mode: 'dormant' | 'hanging' | 'falling' | 'strike' | 'rising' | 'quiet';
  bay: string; seconds: number;
  x?: number; y?: number; z?: number;
  from?: {bay: string; x: number; y: number; z: number}; travel?: number;
  drop?: number; moves?: number; clip?: number;
  stun?: number; incoming?: number;
}
export const stunTime = 6;
// The volume a thrown item has to reach to hit it: its bell and upper tines
// under the ceiling, or the whole drop while it falls, lies or climbs.
export function diverBody(layout: Layout, diver: Diver) {
  const room = layout.rooms.find(r => r.id === diver.bay);
  if (!room || diver.mode === 'dormant') return;
  const a = anchor(room), top = room.y+roomTemplates[room.template].height;
  const low = diver.mode === 'falling' || diver.mode === 'strike' || diver.mode === 'rising';
  return {x:diver.x ?? a.x,z:diver.z ?? a.z,r:0.7,bottom:low ? diver.y ?? a.y : top-1.3,top};
}
// Once the bell rings, every creature is enraged: the Diver waits and falls
// sooner, moves faster, rests less, and chases from one connection farther.
// From someone stepping beneath it to the impact takes wait + fall.
export const pace = (mission: Mission) => mission.enraged ?
  {wait:1.75,fall:0.75,step:1.4,travel:0.9,wander:5.6,rise:2.5,quiet:1.5,reach:3} :
  {wait:3,fall:1,step:2,travel:1.2,wander:8,rise:2.5,quiet:3.5,reach:2};
// Lying on the floor after a strike.
export const sprawl = 1.5;
// The chains of each move carry up to two room connections from the room it
// enters, that room included, and no farther.
export const hearingRange = 2;
export const hears = (layout: Layout, room: string | undefined, diver: Diver) =>
  diver.mode !== 'dormant' && room !== undefined && connections(layout)(room,diver.bay) <= hearingRange;
// A listener in `room` who has heard the Diver's moves up to `heard` hears
// the clip of a newer move once. Undefined `heard` means the listener just
// joined or refreshed, so nothing replays.
export function listen(layout: Layout, room: string | undefined, diver: Diver, heard: number | undefined) {
  const moves = diver.moves ?? 0;
  const clip = heard !== undefined && moves > heard && hears(layout,room,diver) ? diver.clip ?? 0 : undefined;
  return {clip,heard:moves};
}
// Each operator who doesn't make it out keeps 80% of what remains, so the
// crew keeps gross × 0.8^lost and never falls to nothing in a larger lobby.
export const keptPerLoss = 0.8;
export const kept = (gross: number, lost: number) => Math.round(gross*keptPerLoss**lost);
export const lossPercent = (lost: number) => Math.round((1-keptPerLoss**lost)*100);
export const distance = (a: Point, b: Point) => Math.hypot(a.x-b.x,a.z-b.z);
export const finished = (stage?: Stage) => stage === 'won' || stage === 'lost';
// Operators on the gallery above a pad, or the floor below a landing, are on another storey.
export const sameStorey = (p: {feetY?: number}, at: {y: number}) => Math.abs((p.feetY ?? 0)-at.y) < 1.5;
export function onPad(p: Point & {feetY?: number; place?: Place}, pad: Point3) { return placeOf(p) === 'inside' && distance(p,pad) <= 1.5 && sameStorey(p,pad); }

// Every item with its current place and holder.
export interface Item extends Salvage { owner: number | null; banked: boolean; flight?: Flight; place: Place; gnawer?: number }
// Every item the crew can handle: the facility's salvage plus anything bought.
export function catalog(layout: Layout, mission: Mission | undefined): Salvage[] {
  const bought = mission?.haul.filter(h => h.kind).map(h => ({id:h.id,kind:h.kind!,value:0,x:h.x,y:h.y,z:h.z,room:''})) ?? [];
  return bought.length ? [...spawnSalvage(layout),...bought] : spawnSalvage(layout);
}
export function items(layout: Layout, mission: Mission | undefined): Item[] {
  const moved = new Map(mission?.haul.map(h => [h.id,h]));
  return catalog(layout,mission).filter(s => !moved.get(s.id)?.used).map(s => {
    const h = moved.get(s.id);
    return h ? {...s,x:h.x,y:h.y,z:h.z,owner:h.owner,banked:!!h.banked,flight:h.flight,place:placeOf(h),...(h.gnawer !== undefined ? {gnawer:h.gnawer} : {})} : {...s,owner:null,banked:false,place:'inside' as Place};
  });
}
// The salvage an operator carries, in the order it was collected.
export function pack(layout: Layout, mission: Mission, id: number) {
  const byId = new Map(catalog(layout,mission).map(s => [s.id,s]));
  return mission.haul.filter(h => h.owner === id && !h.used && byId.has(h.id)).map(h => byId.get(h.id)!);
}

// Within an arm's reach, on the same storey, with nothing solid in between.
export function canCollect(p: Player, item: Point3 & {place?: Place}, obstacles: readonly Rect[]) {
  if (placeOf(item) !== placeOf(p)) return false;
  if (Math.abs(item.y-(p.feetY ?? 0)) > 1 || Math.hypot(p.x-item.x,p.z-item.z) > 1.8) return false;
  for (let i=1;i<=12;i++) {
    if (!clearAt(p.x+(item.x-p.x)*i/12,p.z+(item.z-p.z)*i/12,0.04,obstacles)) return false;
  }
  return true;
}
export function collectable(layout: Layout, mission: Mission, p: Player, obstacles: readonly Rect[]) {
  if (freeSlot(p) < 0) return;
  return items(layout,mission).filter(i => i.owner === null && !i.banked && !i.flight && i.gnawer === undefined && canCollect(p,i,obstacles))
    .sort((a,b) => Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0];
}

// What **E** picks up: the flashlight or the nearest salvage, whichever is closer.
export function nearestPickup(layout: Layout | undefined, state: Snapshot, p: Player, obstacles: readonly Rect[]): {lamp: true} | {item: Item} | undefined {
  const mission = state.mission;
  // Between expeditions, bought gear can be picked up at home.
  const item = layout && mission && (mission.stage === 'explore' || mission.stage === 'home') ? collectable(layout,mission,p,obstacles) : undefined;
  const light = canTake(p,state.lamp,obstacles);
  if (light && (!item || distance(state.lamp,p) <= distance(item,p))) return {lamp:true};
  if (item) return {item};
}

export type Task = { kind: 'revive' | 'ring' | 'shop'; label: string };
// Out of the expedition: escaped through the rift, or dead.
export const gone = (mission: Mission, id: number) => !!mission.escaped?.includes(id) || !!mission.dead?.includes(id);
export function assignment(layout: Layout, state: Snapshot, player: Player, obstacles: readonly Rect[]): Task | undefined {
  const mission = state.mission;
  if (!mission || !player.connected) return;
  // The home terminal sells gear between expeditions.
  if (mission.stage === 'home' && placeOf(player) === 'home' && distance(player,home().terminal) <= 2.1) return {kind:'shop',label:'Open the supply terminal'};
  if (mission.stage !== 'explore' || mission.down.some(d => d.id === player.id) || gone(mission,player.id)) return;
  const partner = state.players.find(p => p.id !== player.id);
  const partnerDown = !!partner && mission.down.some(d => d.id === partner.id);
  if (partner?.connected && partnerDown && placeOf(partner) === placeOf(player) && distance(player,partner) <= 1.7 &&
      Math.abs((player.feetY ?? 0)-(partner.feetY ?? 0)) < 1 &&
      clearAt((player.x+partner.x)/2,(player.z+partner.z)/2,0.15,obstacles)) return {kind:'revive',label:'Revive partner'};
  // The bell in front of the façade rings once per expedition, once the
  // whole crew has come through the arrival rift.
  if (mission.bell === undefined && mission.arrival === 'closed' && placeOf(player) === 'outside' && distance(player,outdoors(layout.seed).bell) <= doorReach+0.4) return {kind:'ring',label:'Ring the bell'};
}

export const itemName = (kind: ItemKind) => itemKinds[kind].name;
