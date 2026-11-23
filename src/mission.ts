import type { Layout } from './layout.ts';
import { canTake, clearAt, freeSlot } from './room.ts';
import type { Flight } from './flight.ts';
import { doorReach, outdoors, placeOf } from './places.ts';
import type { Place } from './places.ts';
import type { Player, Point, Snapshot } from './room.ts';
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
export interface Contract { seed: number; expeditions: number; index: number; layout: number; quota: number; credited: number; receipts: Receipt[] }
// Salvage that has left its spawn: carried (`owner`), dropped, thrown, or
// banked in the exit rift. A thrown item's x, y and z are where it will come
// to rest; `flight` is set until it gets there. A banked item went into the
// rift, thrown or carried by an operator who escaped.
export interface Haul extends Point3 { id: string; owner: number | null; banked?: boolean; flight?: Flight; place?: Place }
export interface Mission {
  solo?: boolean;
  stage: Stage;
  // The rift the crew arrived through stays open until everyone is outside.
  arrival?: 'open' | 'closed';
  // Ringing the bell (by an operator) opens the exit rift for `seconds` and
  // enrages every creature for the rest of the expedition.
  bell?: number;
  rift?: {x: number; z: number; seconds: number};
  enraged?: boolean;
  // Operators who went into the exit rift, and those who died.
  escaped?: number[];
  dead?: number[];
  outcome?: Outcome;
  contract: Contract;
  haul: Haul[];
  awake?: boolean;
  diver: { mode: 'dormant' | 'warning' | 'strike' | 'quiet' | 'tracking'; bay: string; seconds: number };
  down: { id: number; seconds: number }[];
}
export const strikeRadius = 2.4;
// Once the bell rings, every creature is enraged: the Diver warns sooner,
// rests less, moves through the wiring faster, and strikes a wider circle.
export const pace = (mission: Mission) => mission.enraged ?
  {warning:2.5,quiet:5,step:0.7,radius:3} : {warning:4,quiet:9,step:1.1,radius:strikeRadius};
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
export interface Item extends Salvage { owner: number | null; banked: boolean; flight?: Flight; place: Place }
export function items(layout: Layout, mission: Mission | undefined): Item[] {
  const moved = new Map(mission?.haul.map(h => [h.id,h]));
  return spawnSalvage(layout).map(s => {
    const h = moved.get(s.id);
    return h ? {...s,x:h.x,y:h.y,z:h.z,owner:h.owner,banked:!!h.banked,flight:h.flight,place:placeOf(h)} : {...s,owner:null,banked:false,place:'inside' as Place};
  });
}
// The salvage an operator carries, in the order it was collected.
export function pack(layout: Layout, mission: Mission, id: number) {
  const byId = new Map(spawnSalvage(layout).map(s => [s.id,s]));
  return mission.haul.filter(h => h.owner === id && byId.has(h.id)).map(h => byId.get(h.id)!);
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
  return items(layout,mission).filter(i => i.owner === null && !i.banked && !i.flight && canCollect(p,i,obstacles))
    .sort((a,b) => Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0];
}

// What **E** picks up: the flashlight or the nearest salvage, whichever is closer.
export function nearestPickup(layout: Layout | undefined, state: Snapshot, p: Player, obstacles: readonly Rect[]): {lamp: true} | {item: Item} | undefined {
  const mission = state.mission;
  const item = layout && mission && mission.stage === 'explore' ? collectable(layout,mission,p,obstacles) : undefined;
  const light = canTake(p,state.lamp,obstacles);
  if (light && (!item || distance(state.lamp,p) <= distance(item,p))) return {lamp:true};
  if (item) return {item};
}

export type Task = { kind: 'revive' | 'ring'; label: string };
// Out of the expedition: escaped through the rift, or dead.
export const gone = (mission: Mission, id: number) => !!mission.escaped?.includes(id) || !!mission.dead?.includes(id);
export function assignment(layout: Layout, state: Snapshot, player: Player, obstacles: readonly Rect[]): Task | undefined {
  const mission = state.mission;
  if (!mission || mission.stage !== 'explore' || !player.connected || mission.down.some(d => d.id === player.id) || gone(mission,player.id)) return;
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
