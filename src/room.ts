import type { Layout, Rect } from './layout.ts';
import type { Mission } from './mission.ts';
export const walls = [
  { x: -5, z: 0, w: 0.25, d: 14 }, { x: 5, z: 0, w: 0.25, d: 14 },
  { x: 0, z: -7, w: 10, d: 0.25 }, { x: 0, z: 7, w: 10, d: 0.25 },
  { x: -3, z: -1, w: 4, d: 0.35 }, { x: 3, z: -1, w: 4, d: 0.35 },
];
export interface Point { x: number; z: number }
export interface Input { forward: number; right: number; yaw: number; pitch: number }
export interface Player extends Point { connected: boolean; id: number; yaw: number; pitch: number }
export interface Lamp extends Point { owner: number | null; on: boolean; y: number; yaw: number; pitch: number }
export interface Snapshot { round: string; update: number; players: Player[]; lamp: Lamp; opened?: string[]; mission?: Mission }
export type Action = 'take' | 'drop' | 'toggle' | 'open-door' | 'operate';
export interface Ticket { round: string; token: string }
export interface Admission { lobby: string; round: number; token: string }
export type ClientMessage =
  | { type: 'join'; ticket: Ticket | null; admission?: Admission; layoutVersion?: number }
  | { type: 'input'; round: string; input: Input }
  | { type: 'action'; round: string; seq: number; action: Action }
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
  if (lamp.owner !== null || Math.hypot(p.x - lamp.x, p.z - lamp.z) > 2) return false;
  for (let i = 1; i <= 12; i++) {
    if (!clearAt(p.x + (lamp.x - p.x) * i / 12, p.z + (lamp.z - p.z) * i / 12, 0.04, obstacles)) return false;
  }
  return true;
}
