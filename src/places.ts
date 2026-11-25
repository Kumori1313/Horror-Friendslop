import { connections, geometryFor, walkable, type Geometry, type Layout } from './layout.ts';
import { fieldHeight, obstaclesAt, orient, outward, socketAt, surfaceAt } from './room-templates.ts';
import { clearAt } from './room.ts';
import type { Heightfield, Point3, RoomWall } from './room-templates.ts';

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
// salvage, so it costs nothing on the network. The facility stands in the
// middle on a level plot, with its main door in the south face and the bell
// in front of it, and one or two fire exits in other faces. The arrival rift
// opens on any side, well out. Around them the ground rolls: hills, ditches
// and slopes from a height map, rising to cliffs at the edge.
export type Face = 'south' | 'east' | 'west' | 'north';
export interface Doorway { id: string; face: Face; door: Point3; exit: Stand }
export interface Outdoors {
  seed: number; geometry: Geometry; size: number; ground: Heightfield;
  arrival: Point3; spawns: Stand[];
  // The building: its footprint, its doors (the main door first), and the
  // main door and where an operator leaving through it stands.
  building: {x: number; z: number; w: number; d: number; h: number};
  doors: Doorway[]; door: Point3; exit: Stand;
  // The bell in front of the main door, and where to stand to ring it.
  bell: Point3; ringing: Stand;
  rocks: {x: number; y: number; z: number; w: number; d: number; h: number}[];
}
export const outdoorSize = 160;
const outdoorCache = new Map<number,Outdoors>();

// Smooth value noise in [-1, 1], from the seed, in plain arithmetic.
function noise(seed: number) {
  const corner = (i: number, k: number) => {
    let h = (Math.imul(i,0x27d4eb2d) ^ Math.imul(k,0x165667b1) ^ seed) >>> 0;
    h = Math.imul(h ^ (h >>> 15),0x85ebca6b) >>> 0; h ^= h >>> 13;
    return (h >>> 0)/2147483648-1;
  };
  return (x: number, z: number) => {
    const i = Math.floor(x), k = Math.floor(z), u = x-i, v = z-k;
    const su = u*u*(3-2*u), sv = v*v*(3-2*v);
    const a = corner(i,k), b = corner(i+1,k), c = corner(i,k+1), d = corner(i+1,k+1);
    return (a+(b-a)*su)*(1-sv)+(c+(d-c)*su)*sv;
  };
}
const smooth = (t: number) => { const c = Math.max(0,Math.min(1,t)); return c*c*(3-2*c); };

export function outdoors(seed: number): Outdoors {
  const found = outdoorCache.get(seed);
  if (found) return found;
  const next = random(seed ^ 0x0d7e1a), half = outdoorSize/2, room = 'outside';
  const building = {x:0,z:0,w:24,d:18,h:9};
  // Doors: the main door in the south face; one or two fire exits in others.
  const faces: Face[] = ['east','west','north'];
  for (let i=faces.length-1;i>0;i--) { const k = Math.floor(next()*(i+1)); [faces[i],faces[k]] = [faces[k],faces[i]]; }
  const doorway = (id: string, face: Face, along: number): Doorway => {
    const x = face === 'east' ? building.w/2 : face === 'west' ? -building.w/2 : along;
    const z = face === 'south' ? building.d/2 : face === 'north' ? -building.d/2 : along;
    const [ox,oz] = face === 'east' ? [1,0] : face === 'west' ? [-1,0] : face === 'south' ? [0,1] : [0,-1];
    // Leaving, an operator stands 1.4 m out, facing away from the building.
    const yaw = {south:Math.PI,north:0,east:-Math.PI/2,west:Math.PI/2}[face];
    return {id,face,door:{x,y:0,z},exit:{x:x+ox*1.4,y:0,z:z+oz*1.4,yaw}};
  };
  const fire = faces.slice(0,next() < 0.5 ? 1 : 2).map((face,i) =>
    doorway('fire-'+(i+1),face,(next()-0.5)*((face === 'north' ? building.w : building.d)-6)));
  const doors = [doorway('main','south',0),...fire];
  const door = doors[0].door, bell = {x:door.x+5,y:0,z:door.z+7};
  // The arrival rift opens on any side of the building, 55 to 65 m out.
  const angle = next()*Math.PI*2, reach = 55+next()*10;
  const ax = Math.round(Math.sin(angle)*reach), az = Math.round(Math.cos(angle)*reach);
  const offsets = [next(),next(),next(),next()].map(v => v*1000);
  const rockSeeds = Array.from({length:400},() => [next(),next(),next(),next(),next()]);
  // Try gentler ground until every door and the bell can be reached on foot.
  for (let attempt=0;;attempt++) {
    const scale = attempt < 5 ? 1-attempt*0.18 : 0;
    const hills = noise(seed ^ 0x9e3779b9), creases = noise(seed ^ 0x7f4a7c15);
    const base = (x: number, z: number) => scale*(6*hills(x/46+offsets[0],z/46+offsets[1])+2.2*hills(x/19+offsets[2],z/19+offsets[3])+0.7*hills(x/8,z/8+offsets[0]))
      // Ditches: troughs along the zero lines of a second noise, rounded at
      // the rim and the bottom so the slope eases in instead of jumping.
      -scale*2.8*smooth(1-Math.abs(creases(x/34+offsets[1],z/34+offsets[2]))/0.14);
    const arrivalLevel = base(ax,az);
    const n = outdoorSize+1, h: number[] = new Array(n*n);
    for (let k=0;k<n;k++) for (let i=0;i<n;i++) {
      const x = i-half, z = k-half;
      let y = base(x,z);
      // The building's plot, with the bell in front, is level at 0.
      const plot = Math.max(Math.abs(x-building.x)-building.w/2-8,Math.abs(z-building.z-2)-building.d/2-9,0);
      y *= smooth(plot/12);
      // The arrival area is level too, at the height of the ground there.
      const near = Math.hypot(x-ax,z-az);
      y += (arrivalLevel-y)*(1-smooth((near-7)/8));
      // Cliffs ring the map: the ground rises too steeply to climb.
      const out = Math.max(Math.abs(x),Math.abs(z))-(half-12);
      if (out > 0) y += out*1.6;
      h[k*n+i] = Math.round(y*100)/100;
    }
    const ground: Heightfield = {x0:-half,z0:-half,step:1,n,h};
    const low = Math.min(...h), height = (x: number, z: number) => fieldHeight(ground,x,z);
    const g = emptyGeometry();
    g.surfaces.push({x:0,z:0,w:outdoorSize,d:outdoorSize,y:low-2,room,field:ground});
    // Invisible walls just inside the cliffs, in case anything gets that far.
    for (const [x0,z0,x1,z1] of [[-half,-half,half,-half+0.5],[-half,half-0.5,half,half],[-half,-half,-half+0.5,half],[half-0.5,-half,half,half]]) g.walls.push(wall(room,x0,z0,x1,z1,low-5,80));
    g.walls.push(wall(room,building.x-building.w/2,building.z-building.d/2,building.x+building.w/2,building.z+building.d/2,0,building.h));
    g.props.push({x:bell.x,z:bell.z,w:1.3,d:1.3,y:0,h:2.7,kind:'bell',room});
    // Boulders, sitting in the ground, clear of the plots and of each other.
    const rocks: Outdoors['rocks'] = [];
    for (const [a,b,c,d,e] of rockSeeds) {
      if (rocks.length >= 60) break;
      const w = 0.8+a*2, dd = 0.8+b*2, rh = 0.6+c*2, x = (d-0.5)*(outdoorSize-28), z = (e-0.5)*(outdoorSize-28);
      if (Math.abs(x-building.x) < building.w/2+12 && Math.abs(z-building.z-2) < building.d/2+13) continue;
      if (Math.hypot(x-ax,z-az) < 12 || rocks.some(r => Math.abs(r.x-x) < (r.w+w)/2+2 && Math.abs(r.z-z) < (r.d+dd)/2+2)) continue;
      const y = Math.min(height(x-w/2,z-dd/2),height(x+w/2,z-dd/2),height(x-w/2,z+dd/2),height(x+w/2,z+dd/2))-0.15;
      rocks.push({x,y,z,w,d:dd,h:rh});
      g.props.push({x,z,w,d:dd,y,h:rh,kind:'rock',room});
    }
    const stand = (x: number, z: number, yaw: number): Stand => ({x,y:height(x,z),z,yaw});
    // Spawns side by side, facing the building.
    const face = Math.atan2(ax,az);
    const spawns = [-1.2,1.2].map(side => stand(ax+Math.cos(face)*side,az-Math.sin(face)*side,face));
    const world: Outdoors = {
      seed,geometry:g,size:outdoorSize,ground,arrival:{x:ax,y:arrivalLevel,z:az},spawns,building,doors,door,exit:doors[0].exit,rocks,bell,
      ringing:{x:bell.x,y:0,z:bell.z+1.5,yaw:0},
    };
    const reached = walkable(g,spawns[0],[],0.5);
    if (scale === 0 || ([...doors.map(d => d.exit),world.ringing,spawns[1]].every(p => reached(p)))) {
      if (outdoorCache.size > 4) outdoorCache.clear();
      outdoorCache.set(seed,world);
      return world;
    }
  }
}
// Where the doors of a facility come out inside. The main door is Intake's
// outer door. Each fire exit is a door in a wall where a room has a doorway
// left unused, in a room deep inside: as far from Intake as the facility
// allows, from the seed. `door` is on the wall; `entry` is where an operator
// coming in stands, facing into the room.
export interface InsideDoor { id: string; room: string; door: Point3; entry: Stand; outward: [number,number] }
const insideCache = new WeakMap<Layout,InsideDoor[]>();
export function insideDoors(layout: Layout): InsideDoor[] {
  let found = insideCache.get(layout);
  if (found) return found;
  found = [{id:'main',room:'intake',door:intakeDoor,entry:intakeEntry,outward:[0,1]}];
  if (!layout.tour) {
    const fire = outdoors(layout.seed).doors.slice(1), used = new Set(layout.passages.flatMap(l => [l.a+'/'+l.from,l.b+'/'+l.to]));
    const hops = connections(layout), g = geometryFor(layout), next = random(layout.seed ^ 0x2f6b1c);
    const deep = layout.rooms.filter(r => r.kind !== 'intake' && r.kind !== 'corridor' && r.kind !== 'stairwell')
      .sort((a,b) => hops('intake',b.id)-hops('intake',a.id) || (a.id < b.id ? -1 : 1));
    for (const d of fire) {
      for (const r of deep.slice(0,Math.max(4,Math.ceil(deep.length/2))).sort(() => next()-0.5)) {
        if (found.some(e => e.room === r.id)) continue;
        const spot = orient(r.template,r.turn).sockets.filter(s => !used.has(r.id+'/'+s.name)).map(s => ({s,at:socketAt(r,s.name)!})).find(({s,at}) => {
          const [dx,dz] = outward(s.side), entry = {x:at.x-dx*1.3,z:at.z-dz*1.3};
          return !!surfaceAt(g,entry.x,entry.z,at.y) && clearAt(entry.x,entry.z,0.45,obstaclesAt(g,at.y));
        });
        if (!spot) continue;
        const [dx,dz] = outward(spot.s.side);
        found.push({id:d.id,room:r.id,door:{x:spot.at.x,y:spot.at.y,z:spot.at.z},entry:{x:spot.at.x-dx*1.3,y:spot.at.y,z:spot.at.z-dz*1.3,yaw:Math.atan2(dx,dz)},outward:[dx,dz]});
        break;
      }
    }
  }
  insideCache.set(layout,found);
  return found;
}

// The height of the ground anywhere on the outdoor map.
export const groundAt = (map: Outdoors, x: number, z: number) => fieldHeight(map.ground,x,z);

// Where the exit rift may open: open ground on a 2 m grid, reachable on foot
// from the bell, at least 30 m from where the crew arrived and 18 m from
// the façade and the bell, with room around it.
const zoneCache = new Map<number,Point3[]>();
export function riftZones(seed: number): Point3[] {
  const found = zoneCache.get(seed);
  if (found) return found;
  const map = outdoors(seed), g = map.geometry, reached = walkable(g,map.ringing,[],0.5), zones: Point3[] = [];
  const half = map.size/2-14, height = (x: number, z: number) => groundAt(map,x,z);
  for (let x=-half;x<=half;x+=2) for (let z=-half;z<=half;z+=2) {
    const y = height(x,z), here = {x,y,z}, far = (p: Point3, d: number) => Math.hypot(p.x-x,p.z-z) >= d;
    if (!far(map.arrival,30) || !far(map.door,18) || !far(map.bell,18)) continue;
    // Fairly level ground, clear for 2 m around.
    if ([[2,0],[-2,0],[0,2],[0,-2]].some(([dx,dz]) => Math.abs(height(x+dx,z+dz)-y) > 0.7)) continue;
    if (!clearAt(x,z,2,obstaclesAt(g,y)) || !reached(here)) continue;
    zones.push(here);
  }
  if (zoneCache.size > 4) zoneCache.clear();
  zoneCache.set(seed,zones);
  return zones;
}
// The spot a ring opens the rift at, fixed for each expedition's map.
export function riftSpot(seed: number): Point3 {
  const zones = riftZones(seed);
  return zones[Math.floor(random(seed ^ 0x51f7a3)()*zones.length)];
}
// How long the exit rift stays open, in seconds.
export const riftOpen = 180;

// Intake's door to the outside, in its south wall, and where an operator
// coming in from the façade stands.
export const intakeDoor: Point3 = {x:0,y:0,z:5.9};
export const intakeEntry: Stand = {x:0,y:0,z:4.6,yaw:0};

// How close an operator must stand to use a door or step into a rift.
export const doorReach = 1.6;
export const riftReach = 0.9;
