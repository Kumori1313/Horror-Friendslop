export type FacilityKind = 'factory' | 'spire';

export const facilityNames: Record<FacilityKind,string> = {factory:'Abandoned factory',spire:'The Spire'};

function mix(h: number) {
  h = Math.imul(h ^ (h >>> 16),0x7feb352d);
  h = Math.imul(h ^ (h >>> 15),0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

// The facility, outdoor map, and Spire height have independent seeded draws.
export function facilityKind(seed: number): FacilityKind {
  return mix(seed ^ 0xa511e9b3) & 1 ? 'spire' : 'factory';
}

export function facilityStoreys(facility: FacilityKind, seed: number) {
  return facility === 'factory' ? 2 : 4+mix(seed ^ 0x6a09e668)%3;
}

export const spirePlaytestSeeds = {spire:1,'spire-5':3,'spire-6':2} as const;
