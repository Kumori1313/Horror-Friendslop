import type { Layout, Module } from './layout.ts';
import { clearAt } from './room.ts';
import type { Player, Point, Snapshot } from './room.ts';
import type { Rect } from './layout.ts';

export type Stage = 'prime' | 'trace' | 'answer' | 'extract' | 'won' | 'lost';
export interface Mission {
  stage: Stage;
  diver: { mode: 'dormant' | 'warning' | 'strike' | 'quiet' | 'tracking'; bay: string; seconds: number };
  down: { id: number; seconds: number }[];
}
export const strikeRadius = 2.4;
export const distance = (a: Point, b: Point) => Math.hypot(a.x-b.x,a.z-b.z);
export const finished = (stage?: Stage) => stage === 'won' || stage === 'lost';
export function station(layout: Layout, kind: 'intake' | 'relay' | 'exit' | 'switchboard') {
  return layout.rooms.find(r => r.kind === kind)!;
}
export function answerStation(layout: Layout) {
  return station(layout,layout.callout === 'black-start' ? 'switchboard' : 'intake');
}
export function onPad(p: Point, bay: Module) { return distance(p,bay) <= 1.5; }

export function assignment(layout: Layout, state: Snapshot, player: Player, obstacles: Rect[]) {
  const mission = state.mission;
  if (!mission || finished(mission.stage) || !player.connected || mission.down.some(d => d.id === player.id)) return;
  const partner = state.players.find(p => p.id !== player.id && p.connected);
  if (partner && mission.down.some(d => d.id === partner.id) && distance(player,partner) <= 1.7 &&
      clearAt((player.x+partner.x)/2,(player.z+partner.z)/2,0.15,obstacles)) return 'Revive partner';
  const receiver = answerStation(layout);
  if (mission.stage === 'prime' && onPad(player,receiver)) return 'Charge switchboard';
  const relay = station(layout,'relay');
  const carrier = state.players.find(p => p.id === state.lamp.owner && p.connected);
  const transmitting = carrier && state.lamp.on && onPad(carrier,relay);
  if (mission.stage === 'trace' && transmitting && carrier.id === player.id) return 'Send test tone';
  if (mission.stage === 'answer' && transmitting && onPad(player,receiver)) return 'Answer relay';
  const exit = station(layout,'exit');
  if (mission.stage === 'extract' && partner && !mission.down.length && onPad(partner,exit) && onPad(player,exit)) return 'Extract crew';
}
