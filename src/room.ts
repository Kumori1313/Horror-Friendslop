import type { Layout, Rect } from './layout.ts';
import type { Mission } from './mission.ts';
import type { Flight } from './flight.ts';
import type { Place } from './places.ts';
export const walls = [
  { x: -5, z: 0, w: 0.25, d: 14 }, { x: 5, z: 0, w: 0.25, d: 14 },
  { x: 0, z: -7, w: 10, d: 0.25 }, { x: 0, z: 7, w: 10, d: 0.25 },
  { x: -3, z: -1, w: 4, d: 0.35 }, { x: 3, z: -1, w: 4, d: 0.35 },
];
export interface Point { x: number; z: number }
export interface Input { forward: number; right: number; yaw: number; pitch: number }
// `slots` is the hotbar: salvage ids, `lampSlot` for the flashlight, or null.
// `hand` is the selected slot.
// `place` is where the operator is (see places.ts). `transit` counts moves
// between places and gives the heading to face on arrival, so the client can
// turn its own view.
export interface Player extends Point { feetY?: number; connected: boolean; id: number; yaw: number; pitch: number; slots?: (string | null)[]; hand?: number; place?: Place; transit?: {n: number; yaw: number} }
// A carried flashlight is `stowed` (clipped to the chest, dimmer) when its
// holder has another slot selected. `flight` is set while it is thrown.
// `homeward` marks a flashlight thrown into the exit rift: it goes home once its flight ends.
// `charge` is the battery left, in whole seconds switched on (missing means full).
export interface Lamp extends Point { owner: number | null; on: boolean; y: number; yaw: number; pitch: number; stowed?: boolean; flight?: Flight; place?: Place; homeward?: boolean; charge?: number }
// A full battery lasts six minutes switched on; clipped on, it drains at half rate.
export const batteryLife = 360;
export const chargeOf = (lamp: Lamp) => lamp.charge ?? batteryLife;
export interface Snapshot { round: string; update: number; players: Player[]; lamp: Lamp; opened?: string[]; mission?: Mission }
// `take` picks up the nearest item, the flashlight included; `drop` and
// `throw` act on the selected slot; `select` chooses a slot.
// `load` puts the selected spare cell into the flashlight its holder carries.
export type Action = 'take' | 'drop' | 'throw' | 'select' | 'toggle' | 'load' | 'open-door' | 'operate' | 'next';
export const actions: Action[] = ['take','drop','throw','select','toggle','load','open-door','operate','next'];
// A throw's aim and strength (0 to 1), and the slot for `select`.
export interface Aim { yaw: number; pitch: number; power: number }
export interface Command { slot?: number; aim?: Aim }
export const hotbarSize = 4;
export const lampSlot = 'lamp';
export const slotsOf = (p: Player): (string | null)[] => p.slots ?? Array(hotbarSize).fill(null);
export const selected = (p: Player) => slotsOf(p)[p.hand ?? 0] ?? null;
// The selected slot when it is empty, or else the first empty slot; -1 when full.
export function freeSlot(p: Player) {
  const slots = slotsOf(p), hand = p.hand ?? 0;
  return slots[hand] === null ? hand : slots.indexOf(null);
}
// Keep only well-formed command fields from the network.
export function command(raw: {slot?: unknown; aim?: unknown}): Command {
  const out: Command = {};
  if (Number.isInteger(raw.slot) && (raw.slot as number) >= 0 && (raw.slot as number) < hotbarSize) out.slot = raw.slot as number;
  const aim = raw.aim as Aim | undefined;
  if (aim && [aim.yaw,aim.pitch,aim.power].every(Number.isFinite)) {
    out.aim = {yaw:aim.yaw,pitch:Math.max(-1.35,Math.min(1.35,aim.pitch)),power:Math.max(0,Math.min(1,aim.power))};
  }
  return out;
}
export interface Ticket { round: string; token: string }
export interface Admission { lobby: string; round: number; token: string }
export type ClientMessage =
  | { type: 'join'; ticket: Ticket | null; admission?: Admission; layoutVersion?: number }
  | { type: 'input'; round: string; input: Input }
  | ({ type: 'action'; round: string; seq: number; action: Action } & Command)
  | { type: 'ping'; time: number };
export type ServerMessage =
  | { type: 'joined'; id: number; ticket: Ticket; lastAction: number; layout?: Layout }
  | { type: 'state'; state: Snapshot }
  | { type: 'pong'; time: number };

export function newerSnapshot(s: Snapshot, round: string, latest: number) {
  return s.round === round && s.update > latest;
}

export function clearAt(x: number, z: number, radius: number, obstacles: readonly Rect[] = walls) {
  return obstacles.every(w => Math.abs(x - w.x) >= w.w / 2 + radius || Math.abs(z - w.z) >= w.d / 2 + radius);
}

export function canTake(p: Player, lamp: Lamp, obstacles: readonly Rect[] = walls) {
  if ((lamp.place ?? 'inside') !== (p.place ?? 'inside')) return false;
  if (p.feetY !== undefined && Math.abs(lamp.y-0.14-p.feetY)>1) return false;
  if (lamp.owner !== null || lamp.flight || Math.hypot(p.x - lamp.x, p.z - lamp.z) > 2 || freeSlot(p) < 0) return false;
  for (let i = 1; i <= 12; i++) {
    if (!clearAt(p.x + (lamp.x - p.x) * i / 12, p.z + (lamp.z - p.z) * i / 12, 0.04, obstacles)) return false;
  }
  return true;
}
