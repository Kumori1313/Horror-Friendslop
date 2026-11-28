import type { Patch, Point3 } from './room-templates.ts';

export interface Arc {
  inner: number;
  outer: number;
  square?: boolean;
  climb?: number;
  landing?: boolean;
  rotation?: number;
}

export const shaftRadius = 3.5;
export const shaftDepth = 30;
export const shaftKillDepth = 20;
export const stairOuter = 7;
export const towerRadius = 10;
export const turn = 2*Math.PI;
export const landingAngle = Math.PI/7;

// South is the seam. The first and last few treads meet at a level landing.
export function arcAngle(x: number,z: number,rotation = 0) {
  return (Math.atan2(x,z)+rotation+turn)%turn;
}

export function arcRise(arc: Arc, angle: number) {
  return (arc.climb ?? 0)*Math.max(0,Math.min(1,(angle-landingAngle)/(turn-2*landingAngle)));
}

export function arcEdge(arc: Arc, angle: number) {
  return arc.square ? arc.outer/Math.max(Math.abs(Math.sin(angle)),Math.abs(Math.cos(angle))) : arc.outer;
}

export function arcPoint(center: Point3, angle: number, radius: number, rise = 0): Point3 {
  return {x:center.x+Math.sin(angle)*radius,y:center.y+rise,z:center.z+Math.cos(angle)*radius};
}

export function inArc(arc: Arc, x: number, z: number) {
  return (!arc.landing || arcAngle(x,z,arc.rotation) <= landingAngle+1e-6) && x*x+z*z >= (arc.inner-1e-6)**2 &&
    (arc.square ? Math.max(Math.abs(x),Math.abs(z)) <= arc.outer+1e-6 : x*x+z*z <= (arc.outer+1e-6)**2);
}

// A round mass, approximated by horizontal slices
// so the outdoor pathfinder, movement and throws share its collision.
export function roundFootprint(radius: number, slices = 48): Patch[] {
  const d = 2*radius/slices;
  return Array.from({length:slices},(_,i) => {
    const z = -radius+(i+0.5)*d;
    const w = 2*Math.sqrt(radius*radius-z*z);
    return {x:0,z,w,d};
  });
}
