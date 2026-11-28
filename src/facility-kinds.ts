export type FacilityKind = 'factory' | 'spire';

export const facilityNames: Record<FacilityKind,string> = {factory:'Abandoned factory',spire:'The Spire'};
export const facilityStoreys: Record<FacilityKind,number> = {factory:2,spire:4};

// Use a separate draw from the outdoor map, so either facility can appear in any weather.
export function facilityKind(seed: number): FacilityKind {
  let h = seed ^ 0xa511e9b3;
  h = Math.imul(h ^ (h >>> 16),0x7feb352d);
  h = Math.imul(h ^ (h >>> 15),0x846ca68b);
  return (h ^ (h >>> 16)) & 1 ? 'spire' : 'factory';
}

export const spirePlaytestSeed = 1;
