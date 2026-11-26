// Outdoor map kinds and their weather. Each expedition's outdoor map is drawn
// from its seed, so every client agrees on it without being told. Like
// `Simulation`, no Node-only APIs.
export type MapKind = 'hills' | 'marsh';
export const mapKinds: readonly MapKind[] = ['hills','marsh'];
export const mapNames: Record<MapKind,string> = {hills:'Rolling hills',marsh:'Fog-bound marsh'};

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
// shallow water.
export interface Weather {
  look: {background: number; fog: number; density: number; sky: number; skyGround: number; skyLevel: number; moon: number; moonLevel: number; far: number};
  sight: number; carry: number; mud: boolean;
}
export const weather: Record<MapKind,Weather> = {
  hills:{look:{background:0x141d26,fog:0x18222b,density:0.017,sky:0x7f95b3,skyGround:0x3a352c,skyLevel:1.05,moon:0xb3c6ea,moonLevel:0.95,far:110},sight:1,carry:1,mud:false},
  // Thick, low fog: under 15 m of sight, still air that carries sound.
  marsh:{look:{background:0x2b3532,fog:0x2e3935,density:0.11,sky:0x8a9a92,skyGround:0x2f3326,skyLevel:1.1,moon:0xb8c6bc,moonLevel:0.6,far:42},sight:0.45,carry:1.15,mud:true},
};
