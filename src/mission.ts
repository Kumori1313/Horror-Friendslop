import { anchor } from './layout.ts';
import type { Layout } from './layout.ts';
import { clearAt } from './room.ts';
import type { Player, Point, Snapshot } from './room.ts';
import type { Point3 } from './room-templates.ts';
import type { Rect } from './layout.ts';

export type Stage = 'prime' | 'trace' | 'answer' | 'extract' | 'won' | 'lost';
export interface Mission {
  solo?: boolean;
  stage: Stage;
  diver: { mode: 'dormant' | 'warning' | 'strike' | 'quiet' | 'tracking'; bay: string; seconds: number };
  down: { id: number; seconds: number }[];
}
export interface Station extends Point3 { id: string }
export const strikeRadius = 2.4;
export const distance = (a: Point, b: Point) => Math.hypot(a.x-b.x,a.z-b.z);
export const finished = (stage?: Stage) => stage === 'won' || stage === 'lost';
// Operators on the gallery above a pad, or the floor below a landing, are on another storey.
export const sameStorey = (p: {feetY?: number}, at: {y: number}) => Math.abs((p.feetY ?? 0)-at.y) < 1.5;
export function station(layout: Layout, kind: 'intake' | 'relay' | 'exit' | 'switchboard'): Station {
  const room = layout.rooms.find(r => r.kind === kind)!;
  return {id:room.id,...anchor(room)};
}
export function answerStation(layout: Layout) {
  return station(layout,layout.callout === 'black-start' ? 'switchboard' : 'intake');
}
export function onPad(p: Point & {feetY?: number}, pad: Station) { return distance(p,pad) <= 1.5 && sameStorey(p,pad); }

export function assignment(layout: Layout, state: Snapshot, player: Player, obstacles: readonly Rect[]) {
  const mission = state.mission;
  if (!mission || finished(mission.stage) || !player.connected || mission.down.some(d => d.id === player.id)) return;
  const partner = state.players.find(p => p.id !== player.id && p.connected);
  if (partner && mission.down.some(d => d.id === partner.id) && distance(player,partner) <= 1.7 &&
      Math.abs((player.feetY ?? 0)-(partner.feetY ?? 0)) < 1 &&
      clearAt((player.x+partner.x)/2,(player.z+partner.z)/2,0.15,obstacles)) return 'Revive partner';
  const receiver = answerStation(layout);
  if (mission.stage === 'prime' && onPad(player,receiver)) return 'Charge switchboard';
  const relay = station(layout,'relay');
  const carrier = state.players.find(p => p.id === state.lamp.owner && p.connected);
  const transmitting = carrier && state.lamp.on && onPad(carrier,relay);
  if (mission.stage === 'trace' && transmitting && carrier.id === player.id) return mission.solo ? 'Power exit circuit' : 'Send test tone';
  if (mission.stage === 'answer' && transmitting && onPad(player,receiver)) return 'Answer relay';
  const exit = station(layout,'exit');
  if (mission.stage === 'extract' && !mission.down.length && onPad(player,exit)) {
    if (mission.solo) return 'Extract';
    if (partner && onPad(partner,exit)) return 'Extract crew';
  }
}
