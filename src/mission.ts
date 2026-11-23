import type { Layout } from './layout.ts';
import { clearAt } from './room.ts';
import type { Player, Point, Snapshot } from './room.ts';
import type { Point3 } from './room-templates.ts';
import type { Rect } from './layout.ts';
import { itemKinds, liftOf, packSize, spawnSalvage } from './salvage.ts';
import type { ItemKind, Salvage } from './salvage.ts';

// A contract runs several expeditions. Each one is explored, hauled back to
// the lift in Intake, and sold on extraction. `settled` waits between
// expeditions; `won` and `lost` end the contract.
export type Stage = 'explore' | 'settled' | 'won' | 'lost';
export type Outcome = 'quota' | 'deadline' | 'wipe' | 'stranded' | 'left';
export interface Receipt {
  expedition: number; items: {kind: ItemKind; value: number}[];
  gross: number; deduction: number; credited: number; abandoned: boolean;
}
export interface Contract { seed: number; expeditions: number; index: number; layout: number; quota: number; credited: number; receipts: Receipt[] }
// Salvage that has left its spawn: carried (`owner`), dropped, or loaded on the lift.
export interface Haul extends Point3 { id: string; owner: number | null; loaded?: boolean }
export interface Mission {
  solo?: boolean;
  stage: Stage;
  outcome?: Outcome;
  contract: Contract;
  haul: Haul[];
  awake?: boolean;
  diver: { mode: 'dormant' | 'warning' | 'strike' | 'quiet' | 'tracking'; bay: string; seconds: number };
  down: { id: number; seconds: number }[];
}
export const strikeRadius = 2.4;
export const abandonCut = 0.2;
export const distance = (a: Point, b: Point) => Math.hypot(a.x-b.x,a.z-b.z);
export const finished = (stage?: Stage) => stage === 'won' || stage === 'lost';
// Operators on the gallery above a pad, or the floor below a landing, are on another storey.
export const sameStorey = (p: {feetY?: number}, at: {y: number}) => Math.abs((p.feetY ?? 0)-at.y) < 1.5;
export function onPad(p: Point & {feetY?: number}, pad: Point3) { return distance(p,pad) <= 1.5 && sameStorey(p,pad); }

// Every item with its current place and holder.
export interface Item extends Salvage { owner: number | null; loaded: boolean }
export function items(layout: Layout, mission: Mission | undefined): Item[] {
  const moved = new Map(mission?.haul.map(h => [h.id,h]));
  return spawnSalvage(layout).map(s => {
    const h = moved.get(s.id);
    return h ? {...s,x:h.x,y:h.y,z:h.z,owner:h.owner,loaded:!!h.loaded} : {...s,owner:null,loaded:false};
  });
}
// A pack lists items in the order they were collected.
export function pack(layout: Layout, mission: Mission, id: number) {
  const byId = new Map(spawnSalvage(layout).map(s => [s.id,s]));
  return mission.haul.filter(h => h.owner === id).map(h => byId.get(h.id)!);
}

// Within an arm's reach, on the same storey, with nothing solid in between.
export function canCollect(p: Player, item: Point3, obstacles: readonly Rect[]) {
  if (Math.abs(item.y-(p.feetY ?? 0)) > 1 || Math.hypot(p.x-item.x,p.z-item.z) > 1.8) return false;
  for (let i=1;i<=12;i++) {
    if (!clearAt(p.x+(item.x-p.x)*i/12,p.z+(item.z-p.z)*i/12,0.04,obstacles)) return false;
  }
  return true;
}
export function collectable(layout: Layout, mission: Mission, p: Player, obstacles: readonly Rect[]) {
  if (pack(layout,mission,p.id).length >= packSize) return;
  return items(layout,mission).filter(i => i.owner === null && !i.loaded && canCollect(p,i,obstacles))
    .sort((a,b) => Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0];
}

export type Task = { kind: 'revive' | 'load' | 'extract' | 'abandon'; label: string };
export function assignment(layout: Layout, state: Snapshot, player: Player, obstacles: readonly Rect[]): Task | undefined {
  const mission = state.mission;
  if (!mission || mission.stage !== 'explore' || !player.connected || mission.down.some(d => d.id === player.id)) return;
  const partner = state.players.find(p => p.id !== player.id);
  const partnerDown = !!partner && mission.down.some(d => d.id === partner.id);
  if (partner?.connected && partnerDown && distance(player,partner) <= 1.7 &&
      Math.abs((player.feetY ?? 0)-(partner.feetY ?? 0)) < 1 &&
      clearAt((player.x+partner.x)/2,(player.z+partner.z)/2,0.15,obstacles)) return {kind:'revive',label:'Revive partner'};
  if (!onPad(player,liftOf(layout))) return;
  const carried = pack(layout,mission,player.id).length;
  if (carried) return {kind:'load',label:'Load '+carried+(carried === 1 ? ' item' : ' items')};
  if (mission.solo) return {kind:'extract',label:'Extract'};
  // A brief disconnect is not a downed partner: nobody leaves without them.
  if (partner?.connected && partnerDown) return {kind:'abandon',label:'Extract alone (−'+abandonCut*100+'%)'};
  if (partner?.connected && onPad(partner,liftOf(layout))) return {kind:'extract',label:'Extract crew'};
}

export const itemName = (kind: ItemKind) => itemKinds[kind].name;
