import type { Geometry } from './layout.ts';
import type { Point3, RoomWall } from './room-templates.ts';

// An operator, the flashlight or a piece of salvage is in one of three
// places, each with its own coordinates: the crew's home dimension, the
// outdoor map around the facility, or the facility interior. Anything
// without a place is inside, as before the home dimension existed.
export type Place = 'home' | 'outside' | 'inside';
export const placeOf = (thing: {place?: Place}): Place => thing.place ?? 'inside';
export const placeNames: Record<Place,string> = {home:'Home dimension',outside:'Outdoors',inside:'Facility'};

// A spot to stand, facing `yaw` (0 faces −z).
export interface Stand extends Point3 { yaw: number }

function emptyGeometry(): Geometry {
  return {surfaces:[],walls:[],roofs:[],rails:[],props:[],doors:[],openings:[]};
}
function wall(room: string, x0: number, z0: number, x1: number, z1: number, y: number, h: number): RoomWall {
  return {x:(x0+x1)/2,z:(z0+z1)/2,w:Math.abs(x1-x0),d:Math.abs(z1-z0),y,h,room,inward:1};
}

// The crew's own dimension: a floating platform with the contract terminal
// and the rift that starts each expedition. It never changes.
export interface Home { geometry: Geometry; spawns: Stand[]; rift: Point3; terminal: Point3; lamp: Point3 }
let homeWorld: Home | undefined;
export function home(): Home {
  if (homeWorld) return homeWorld;
  const g = emptyGeometry(), room = 'home';
  g.surfaces.push({x:0,z:0,w:14,d:10,y:0,room});
  // Railings at the platform's edge; the void beyond is not walkable.
  g.walls.push(wall(room,-7,-5.06,7,-5,0,3),wall(room,-7,5,7,5.06,0,3),wall(room,-7.06,-5,-7,5,0,3),wall(room,7,-5,7.06,5,0,3));
  g.props.push({x:-4.6,z:-1.5,w:1.4,d:0.7,y:0,h:1.15,kind:'terminal',room});
  homeWorld = {geometry:g,spawns:[{x:-0.8,y:0,z:2.6,yaw:0},{x:0.8,y:0,z:2.6,yaw:0}],rift:{x:0,y:0,z:-3.4},terminal:{x:-4.6,y:0,z:-1.5},lamp:{x:0.6,y:0,z:1.6}};
  return homeWorld;
}

function random(seed: number) {
  let n = seed >>> 0;
  return () => {
    n = (n + 0x6d2b79f5) >>> 0;
    let t = Math.imul(n ^ (n >>> 15),1 | n);
    t ^= t + Math.imul(t ^ (t >>> 7),61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The open map around a facility, derived from the expedition seed like its
// salvage, so it costs nothing on the network. The facility stands at the
// north end behind its fixed façade; the arrival rift opens at the south end.
export interface Rise { x: number; z: number; w: number; d: number; h: number; ramp: {x: number; z: number; w: number; d: number; along?: 'x'; rise: number} }
export interface Outdoors {
  seed: number; geometry: Geometry; size: number;
  arrival: Point3; spawns: Stand[];
  // The façade: its footprint, its door, and where an operator leaving the
  // facility stands outside it.
  building: {x: number; z: number; w: number; d: number; h: number};
  door: Point3; exit: Stand;
  rises: Rise[];
  rocks: {x: number; z: number; w: number; d: number; h: number}[];
}
export const outdoorSize = 96;
const outdoorCache = new Map<number,Outdoors>();
export function outdoors(seed: number): Outdoors {
  const found = outdoorCache.get(seed);
  if (found) return found;
  const g = emptyGeometry(), room = 'outside', half = outdoorSize/2, next = random(seed ^ 0x0d7e1a);
  // Cliffs ring the map.
  g.walls.push(wall(room,-half,-half-1,half,-half,0,8),wall(room,-half,half,half,half+1,0,8),wall(room,-half-1,-half,-half,half,0,8),wall(room,half,-half,half+1,half,0,8));
  const building = {x:0,z:-35,w:24,d:18,h:9};
  g.walls.push({...wall(room,building.x-building.w/2,building.z-building.d/2,building.x+building.w/2,building.z+building.d/2,0,building.h)});
  const door = {x:0,y:0,z:building.z+building.d/2};
  const arrival = {x:0,y:0,z:32};
  // Keep the walk from the rift to the door, and the ground around both, clear.
  const keepClear = (x: number, z: number, w: number, d: number) =>
    Math.abs(x) < w/2+5 && z > door.z-1 && z < arrival.z+6 ||
    Math.abs(x-building.x) < building.w/2+w/2+4 && Math.abs(z-building.z) < building.d/2+d/2+4;
  const placed: {x: number; z: number; w: number; d: number}[] = [];
  const overlaps = (x: number, z: number, w: number, d: number, gap: number) => placed.some(o => Math.abs(o.x-x) < (o.w+w)/2+gap && Math.abs(o.z-z) < (o.d+d)/2+gap);
  // Two or three raised banks, each with a ramp up one side.
  const rises: Rise[] = [];
  for (let tries=0; rises.length < 2+Math.floor(next()*2) && tries < 60; tries++) {
    const w = 8+Math.floor(next()*3)*2, d = 8+Math.floor(next()*3)*2, h = 1.5;
    const x = Math.round((next()-0.5)*(outdoorSize-w-16)), z = Math.round((next()-0.5)*(outdoorSize-d-16));
    if (keepClear(x,z,w+8,d+8) || overlaps(x,z,w+8,d+8,2)) continue;
    const side = Math.floor(next()*4), run = 6, width = 3;
    // The ramp climbs toward the bank from the chosen side.
    const ramp = side === 0 ? {x,z:z+d/2+run/2,w:width,d:run,rise:-h} : side === 1 ? {x,z:z-d/2-run/2,w:width,d:run,rise:h} :
      side === 2 ? {x:x+w/2+run/2,z,w:run,d:width,along:'x' as const,rise:-h} : {x:x-w/2-run/2,z,w:run,d:width,along:'x' as const,rise:h};
    rises.push({x,z,w,d,h,ramp});
    placed.push({x,z,w:w+(ramp.along ? run*2 : 0),d:d+(ramp.along ? 0 : run*2)});
    g.surfaces.push({x,z,w,d,y:h,room});
    // A reversed ramp starts high: its base is the bank's top at the near end.
    g.surfaces.push(ramp.rise > 0 ? {x:ramp.x,z:ramp.z,w:ramp.w,d:ramp.d,y:0,rise:h,along:ramp.along,room} : {x:ramp.x,z:ramp.z,w:ramp.w,d:ramp.d,y:h,rise:-h,along:ramp.along,room});
    // The bank's sides, with a gap where the ramp meets it.
    const gap = (lo: number, hi: number, at: number) => [[lo,at-width/2],[at+width/2,hi]];
    const sides: [number,number,number,number][] = [];
    for (const [a,b] of side === 0 ? gap(x-w/2,x+w/2,x) : [[x-w/2,x+w/2]]) sides.push([a,z+d/2,b,z+d/2+0.06]);
    for (const [a,b] of side === 1 ? gap(x-w/2,x+w/2,x) : [[x-w/2,x+w/2]]) sides.push([a,z-d/2-0.06,b,z-d/2]);
    for (const [a,b] of side === 2 ? gap(z-d/2,z+d/2,z) : [[z-d/2,z+d/2]]) sides.push([x+w/2,a,x+w/2+0.06,b]);
    for (const [a,b] of side === 3 ? gap(z-d/2,z+d/2,z) : [[z-d/2,z+d/2]]) sides.push([x-w/2-0.06,a,x-w/2,b]);
    for (const [x0,z0,x1,z1] of sides) g.walls.push(wall(room,x0,z0,x1,z1,0,h));
  }
  // The ground is every part of the map that isn't a bank or a ramp. It must
  // not run underneath them: at a ramp's foot, ground and ramp are the same
  // height, and an operator would stay on the ground and walk into the bank.
  const holes = rises.flatMap(r => [{x:r.x,z:r.z,w:r.w,d:r.d},r.ramp]);
  for (const piece of without({x:0,z:0,w:outdoorSize,d:outdoorSize},holes)) g.surfaces.push({...piece,y:0,room});
  // Scattered boulders, clear of the path, the banks and each other.
  const rocks: Outdoors['rocks'] = [];
  for (let tries=0; rocks.length < 22 && tries < 400; tries++) {
    const w = 0.8+next()*1.8, d = 0.8+next()*1.8, h = 0.6+next()*1.8;
    const x = (next()-0.5)*(outdoorSize-6), z = (next()-0.5)*(outdoorSize-6);
    if (keepClear(x,z,w,d) || overlaps(x,z,w,d,1.5)) continue;
    rocks.push({x,z,w,d,h});
    placed.push({x,z,w,d});
    g.props.push({x,z,w,d,y:0,h,kind:'rock',room});
  }
  const world: Outdoors = {
    seed,geometry:g,size:outdoorSize,arrival,building,door,rises,rocks,
    spawns:[{x:-1.2,y:0,z:arrival.z-2,yaw:0},{x:1.2,y:0,z:arrival.z-2,yaw:0}],
    exit:{x:door.x,y:0,z:door.z+1.4,yaw:Math.PI},
  };
  if (outdoorCache.size > 4) outdoorCache.clear();
  outdoorCache.set(seed,world);
  return world;
}

type Area = {x: number; z: number; w: number; d: number};
// Rectangles covering `outer` except the `holes`: cut into strips at every
// hole's x edges, then each strip at the z edges of the holes crossing it.
function without(outer: Area, holes: Area[]): Area[] {
  const lo = (a: Area, k: 'x' | 'z') => a[k]-(k === 'x' ? a.w : a.d)/2, hi = (a: Area, k: 'x' | 'z') => a[k]+(k === 'x' ? a.w : a.d)/2;
  const cuts = (k: 'x' | 'z', within: Area[], from: number, to: number) =>
    [...new Set([from,to,...within.flatMap(h => [lo(h,k),hi(h,k)]).filter(v => v > from && v < to)])].sort((a,b) => a-b);
  const pieces: Area[] = [];
  const xs = cuts('x',holes,lo(outer,'x'),hi(outer,'x'));
  for (let i=1;i<xs.length;i++) {
    const x0 = xs[i-1], x1 = xs[i], crossing = holes.filter(h => lo(h,'x') < x1 && hi(h,'x') > x0);
    const zs = cuts('z',crossing,lo(outer,'z'),hi(outer,'z'));
    for (let j=1;j<zs.length;j++) {
      const z0 = zs[j-1], z1 = zs[j];
      if (crossing.some(h => lo(h,'z') < z1 && hi(h,'z') > z0)) continue;
      pieces.push({x:(x0+x1)/2,z:(z0+z1)/2,w:x1-x0,d:z1-z0});
    }
  }
  return pieces;
}

// Intake's door to the outside, in its south wall, and where an operator
// coming in from the façade stands.
export const intakeDoor: Point3 = {x:0,y:0,z:5.9};
export const intakeEntry: Stand = {x:0,y:0,z:4.6,yaw:0};

// How close an operator must stand to use a door or step into a rift.
export const doorReach = 1.6;
export const riftReach = 0.9;
