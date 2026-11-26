// Outdoor map kinds and their weather. Each expedition's outdoor map is drawn
// from its seed, so every client agrees on it without being told. Like
// `Simulation`, no Node-only APIs.
export type MapKind = 'hills' | 'marsh' | 'quarry';
export const mapKinds: readonly MapKind[] = ['hills','marsh','quarry'];
export const mapNames: Record<MapKind,string> = {hills:'Rolling hills',marsh:'Fog-bound marsh',quarry:'Windswept quarry'};

// A test build or a solo testing session may force one kind everywhere.
let forced: MapKind | undefined;
export function forceMap(kind?: MapKind) { forced = kind; }
export const forcedMap = () => forced;
export const isMapKind = (v: unknown): v is MapKind => mapKinds.includes(v as MapKind);

export function mapKind(seed: number): MapKind {
  if (forced) return forced;
  let h = (seed ^ 0x5bd1e995) >>> 0;
  h = Math.imul(h ^ (h >>> 15),0x2c1b3c6d) >>> 0; h = Math.imul(h ^ (h >>> 12),0x297a2d39) >>> 0; h ^= h >>> 15;
  return mapKinds[(h >>> 0) % mapKinds.length];
}

// What the weather does. The look: fog colour and density, sky, the far
// plane. Play: `sight` scales how far creatures see an operator (and the fog
// hides as much from the crew); `carry` scales how far sounds carry, both
// the crew's to creatures and creatures' to the crew; `mud` slows anyone in
// shallow water; `wind` (m/s², or 0) pushes anything thrown, and comes in
// gusts that drown sound further.
export interface Weather {
  look: {background: number; fog: number; density: number; sky: number; skyGround: number; skyLevel: number; moon: number; moonLevel: number; far: number};
  sight: number; carry: number; mud: boolean; wind: number;
}
export const weather: Record<MapKind,Weather> = {
  hills:{look:{background:0x141d26,fog:0x18222b,density:0.017,sky:0x7f95b3,skyGround:0x3a352c,skyLevel:1.05,moon:0xb3c6ea,moonLevel:0.95,far:110},sight:1,carry:1,mud:false,wind:0},
  // Thick, low fog: under 15 m of sight, still air that carries sound.
  marsh:{look:{background:0x2b3532,fog:0x2e3935,density:0.11,sky:0x8a9a92,skyGround:0x2f3326,skyLevel:1.1,moon:0xb8c6bc,moonLevel:0.6,far:42},sight:0.45,carry:1.15,mud:true,wind:0},
  // Wind and blown dust: a little haze, sound carried off, throws pushed.
  quarry:{look:{background:0x26241f,fog:0x332f28,density:0.03,sky:0xa59a86,skyGround:0x3a342a,skyLevel:1.05,moon:0xc9bea6,moonLevel:0.85,far:80},sight:0.8,carry:0.7,mud:false,wind:2.6},
};
// The wind's push on a thrown item (m/s², horizontal) from the map's seed:
// one of eight compass directions, written out so every browser replays a
// throw with exactly the same numbers (as flight.ts, no trigonometry).
const compass = [[0,1],[0.71,0.71],[1,0],[0.71,-0.71],[0,-1],[-0.71,-0.71],[-1,0],[-0.71,0.71]];
export function windOf(seed: number) {
  const strength = weather[mapKind(seed)].wind;
  if (!strength) return undefined;
  const [x,z] = compass[((seed ^ 0x2545f491) >>> 0) % 8];
  return {x:Math.round(x*strength*100)/100,z:Math.round(z*strength*100)/100};
}
// Gusts, by the expedition's clock (whole seconds, on every client alike):
// about 7 s in every 30, at a moment of the cycle set by the seed.
export const gustEvery = 30, gustFor = 7, gustCarry = 0.5;
export function gusting(seed: number, clock: number) {
  if (!weather[mapKind(seed)].wind) return false;
  const phase = ((seed >>> 3) % gustEvery+gustEvery) % gustEvery;
  return (clock+phase) % gustEvery < gustFor;
}
// How far sound carries now: the weather's `carry`, less in a gust.
export const carrying = (seed: number, clock = 0) => weather[mapKind(seed)].carry*(gusting(seed,clock) ? gustCarry : 1);
