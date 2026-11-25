import { clearAt } from './room.ts';
import type { Point } from './room.ts';

import { assembleTemplates, cell, corridorKinds, destinationPool, isCorridor, orient, roomTemplates, socketAt, storey, surfaceAt, surfaceHeight, obstaclesAt } from './room-templates.ts';
import type { PlacedSurface, Placement, Point3, Solid, TemplateGeometry, TemplateKind, TemplateLink } from './room-templates.ts';

export const generatorVersion = 6;
export const playerRadius = 0.25;
export interface Rect extends Point { w: number; d: number }
export type Kind = Exclude<TemplateKind,typeof corridorKinds[number]> | 'corridor';
export interface Module extends Placement { kind: Kind }
export interface Passage extends TemplateLink { id: string; bulkhead: boolean }
export interface Layout {
  seed: number; version: number; fallback: boolean; tour?: boolean;
  rooms: Module[]; passages: Passage[];
  lampId: 'inspection-light';
}
export type Geometry = TemplateGeometry;

export const kindOf = (template: TemplateKind): Kind => isCorridor(template) ? 'corridor' : template as Kind;

// Destinations are unique per facility; repeated stairwells carry a letter.
export function roomLabel(room: Module) {
  if (room.kind === 'stairwell') return 'Stairwell '+room.id.replace(/^stairwell-?/,'').toUpperCase();
  return roomTemplates[room.template].name;
}

// The floor point that stands for the room: its station pad, diver drop and map marker.
export function anchor(room: Module): Point3 {
  const pad = orient(room.template,room.turn).pad ?? {x:0,y:0,z:0};
  return {x:room.x+pad.x,y:room.y+pad.y,z:room.z+pad.z};
}

// A repeatable two-storey walkthrough: up the stairs, across the hall gallery to
// the closet, down the ramp, and back to Intake through the tunnel beneath it.
export function stairwellLayout(): Layout {
  const rooms: Module[] = ([
    {id:'intake',template:'intake',x:-4,y:0,z:0,turn:0}, {id:'stairwell-a',template:'stairwell',x:0,y:0,z:-16,turn:0},
    {id:'hall',template:'hall',x:8,y:0,z:-12,turn:0}, {id:'closet',template:'closet',x:16,y:4,z:-16,turn:0},
    {id:'tunnel',template:'tunnel',x:8,y:0,z:0,turn:0},
  ] as Placement[]).map(r=>({...r,kind:kindOf(r.template)}));
  const passages: Passage[] = ([
    {a:'intake',from:'north1',b:'stairwell-a',to:'lower-south'},
    {a:'stairwell-a',from:'upper-east',b:'hall',to:'gallery-west'},
    {a:'hall',from:'gallery-east',b:'closet',to:'west0'},
    {a:'hall',from:'floor-east-4',b:'tunnel',to:'side'},
    {a:'tunnel',from:'mouth',b:'intake',to:'east0'},
  ] as TemplateLink[]).map(e=>({...e,id:e.a+'-'+e.b,bulkhead:false}));
  return {version:generatorVersion,seed:0,fallback:false,tour:true,lampId:'inspection-light',rooms,passages};
}

// Both collision and rendering use these exact slabs.
const geometries = new WeakMap<Layout,Geometry>();
export function geometryFor(layout: Layout): Geometry {
  let g = geometries.get(layout);
  if (!g) {
    g = assembleTemplates(layout.rooms,layout.passages.map(p=>p.bulkhead ? {...p,door:p.id} : p));
    geometries.set(layout,g);
  }
  return g;
}

export function solidsAt(geometry: Geometry, feet: number, opened: readonly string[] = []) {
  return obstaclesAt(geometry,feet,opened);
}

export function roomAt(layout: Layout, geometry: Geometry, p: Point & {feetY?: number}) {
  const id = surfaceAt(geometry,p.x,p.z,p.feetY ?? 0)?.room;
  return layout.rooms.find(r => r.id === id);
}

export function nearbyDoor(p: Point & {feetY?: number}, geometry: Geometry, opened: readonly string[]) {
  const feet = p.feetY ?? 0;
  return geometry.doors.find(d => !opened.includes(d.id) && Math.abs(d.y-feet) < 1 && Math.hypot(d.x-p.x,d.z-p.z) < 1.9 &&
    clearAt((d.x+p.x)/2,(d.z+p.z)/2,0.1,geometry.walls.filter(w => w.y+w.h>feet+0.01 && w.y<feet+1.75)));
}

export function distances(rooms: {id: string}[], passages: {a: string; b: string}[], start: string) {
  const neighbors = new Map(rooms.map(room => [room.id,[] as string[]]));
  for (const {a,b} of passages) { neighbors.get(a)!.push(b); neighbors.get(b)!.push(a); }
  const steps = new Map([[start,0]]), queue = [start];
  for (const id of queue) for (const next of neighbors.get(id)!) {
    if (steps.has(next)) continue;
    steps.set(next,steps.get(id)!+1);
    queue.push(next);
  }
  return steps;
}

// Room connections between every pair of rooms, worked out once per layout,
// so pursuit and hearing checks are a table lookup.
const tables = new WeakMap<Layout,{steps: Map<string,Map<string,number>>; next: Map<string,string[]>}>();
function table(layout: Layout) {
  let t = tables.get(layout);
  if (!t) {
    const next = new Map(layout.rooms.map(room => [room.id,[] as string[]]));
    for (const {a,b} of layout.passages) { next.get(a)!.push(b); next.get(b)!.push(a); }
    t = {steps:new Map(layout.rooms.map(r => [r.id,distances(layout.rooms,layout.passages,r.id)])),next};
    tables.set(layout,t);
  }
  return t;
}
export function connections(layout: Layout) {
  const {steps} = table(layout);
  return (a: string, b: string) => steps.get(a)?.get(b) ?? Infinity;
}
export const neighbours = (layout: Layout, room: string) => table(layout).next.get(room) ?? [];

// Which rooms have power, derived from the seed. Intake always does;
// corridors, stairwells and the service tunnel never do; about half of the
// other rooms do. Powered rooms are lit; the rest are dark but for the
// flashlight and their landmarks.
export function powered(layout: Layout, room: string) {
  const r = layout.rooms.find(m => m.id === room);
  if (!r || r.kind === 'corridor' || r.kind === 'stairwell' || r.template === 'tunnel') return false;
  if (r.kind === 'intake' || layout.tour) return true;
  let h = (layout.seed ^ 0x2545f491) >>> 0;
  for (let i=0;i<room.length;i++) h = Math.imul(h ^ room.charCodeAt(i),0x01000193) >>> 0;
  h ^= h >>> 15; h = Math.imul(h,0x2c1b3c6d) >>> 0; h ^= h >>> 12;
  return (h & 1) === 0;
}

// The Bell Diver strikes one zone of a room at a time: the room's bounding
// box split into equal tiles no more than `zoneSize` metres a side, so a long
// tunnel or a large hall can be escaped without crossing the whole room.
export const zoneSize = 8;
const boxes = new WeakMap<Layout,Map<string,{x0: number; z0: number; w: number; d: number; nx: number; nz: number}>>();
export function zoneAt(layout: Layout, room: string, x: number, z: number) {
  let all = boxes.get(layout);
  if (!all) boxes.set(layout,all = new Map());
  let b = all.get(room);
  if (!b) {
    const r = layout.rooms.find(m => m.id === room);
    if (!r) return room;
    const parts = orient(r.template,r.turn).footprint;
    const x0 = Math.min(...parts.map(p => r.x+p.x-p.w/2)), x1 = Math.max(...parts.map(p => r.x+p.x+p.w/2));
    const z0 = Math.min(...parts.map(p => r.z+p.z-p.d/2)), z1 = Math.max(...parts.map(p => r.z+p.z+p.d/2));
    const w = x1-x0, d = z1-z0;
    all.set(room,b = {x0,z0,w,d,nx:Math.max(1,Math.ceil(w/zoneSize-1e-6)),nz:Math.max(1,Math.ceil(d/zoneSize-1e-6))});
  }
  const i = Math.max(0,Math.min(b.nx-1,Math.floor((x-b.x0)/(b.w/b.nx)))), j = Math.max(0,Math.min(b.nz-1,Math.floor((z-b.z0)/(b.d/b.nz))));
  return room+'#'+i+','+j;
}

// The Bell Diver follows ceiling wiring through the same doors and stairs as the crew.
export function nextWiredBay(layout: Layout, from: string, target: string) {
  if (from === target) return from;
  const hops = connections(layout);
  return neighbours(layout,from).find(next => hops(next,target) < hops(from,target)) ?? from;
}

// Grid cells a placed room fills, one key per cell and storey.
export function cellsOf(room: Placement) {
  const t = orient(room.template,room.turn);
  const storeys = Math.max(1,Math.ceil(t.height/storey));
  const keys = new Set<string>();
  for (const f of t.footprint) {
    for (let x=Math.ceil((room.x+f.x-f.w/2)/cell); x*cell<room.x+f.x+f.w/2; x++) {
      for (let z=Math.ceil((room.z+f.z-f.d/2)/cell); z*cell<room.z+f.z+f.d/2; z++) {
        for (let level=0; level<storeys; level++) keys.add(x+','+z+','+(room.y/storey+level));
      }
    }
  }
  return [...keys];
}

// Which sockets of a template an operator can walk between, ignoring other rooms.
const reachCache = new Map<TemplateKind,Map<string,number>>();
export function socketGroups(kind: TemplateKind) {
  let groups = reachCache.get(kind);
  if (groups) return groups;
  groups = new Map();
  const room: Placement = {id:'probe',template:kind,x:0,y:0,z:0,turn:0};
  const g = assembleTemplates([room],[],true);
  const t = roomTemplates[kind];
  let component = 0;
  for (const s of t.sockets) {
    if (groups.has(s.name)) continue;
    const reached = walkable(g,inward(s));
    for (const other of t.sockets) if (!groups.has(other.name) && reached(inward(other))) groups.set(other.name,component);
    if (!groups.has(s.name)) groups.set(s.name,-1-component);
    component++;
  }
  reachCache.set(kind,groups);
  return groups;
}
function inward(s: {x:number; y:number; z:number; side:string}) {
  const [dx,dz] = ({north:[0,1],east:[-1,0],south:[0,-1],west:[1,0]} as Record<string,number[]>)[s.side];
  return {x:s.x+dx*0.5,y:s.y,z:s.z+dz*0.5};
}

// Surfaces and solids bucketed by grid cell, for searches that probe thousands
// of points. It applies the same support and clearance rules as `surfaceAt`
// and `clearAt` for any radius up to `reach`.
export function collisionIndex(g: Geometry, opened: readonly string[] = [], reach = 0.6) {
  const cellKey = (x: number, z: number) => (Math.floor(x/cell)+512)*1024+Math.floor(z/cell)+512;
  function bucket<T extends Rect>(items: T[], pad: number) {
    const map = new Map<number,T[]>();
    for (const item of items) {
      for (let x=Math.floor((item.x-item.w/2-pad)/cell); x<=Math.floor((item.x+item.w/2+pad)/cell); x++) {
        for (let z=Math.floor((item.z-item.d/2-pad)/cell); z<=Math.floor((item.z+item.d/2+pad)/cell); z++) {
          const key = (x+512)*1024+z+512;
          let list = map.get(key);
          if (!list) map.set(key,list = []);
          list.push(item);
        }
      }
    }
    return (x: number, z: number) => map.get(cellKey(x,z)) ?? [];
  }
  const surfaces = bucket(g.surfaces,0.01);
  const solids = new Map<number,ReturnType<typeof bucket<Solid>>>();
  return {
    // Same rule as `surfaceAt`, over the nearby surfaces only. A wider step
    // probes for support further along a slope.
    surface(x: number, z: number, feet: number, step = 0.32) {
      let best: PlacedSurface | undefined, difference = Infinity;
      for (const s of surfaces(x,z)) {
        if (Math.abs(x-s.x)>s.w/2+1e-6 || Math.abs(z-s.z)>s.d/2+1e-6) continue;
        const delta = Math.abs(surfaceHeight(s,x,z)-feet);
        if (delta<=step && delta<difference) { best = s; difference = delta; }
      }
      return best;
    },
    clear(x: number, z: number, feet: number, radius = playerRadius) {
      const key = Math.round(feet*8);
      let near = solids.get(key);
      if (!near) solids.set(key,near = bucket(obstaclesAt(g,feet,opened),reach));
      return clearAt(x,z,radius,near(x,z));
    },
  };
}

// Flood fill on a 0.25 m lattice with the simulation's own support and clearance
// rules. Points closer than a wall's clearance cannot straddle it at this spacing.
export function walkable(g: Geometry, from: Point3, opened: readonly string[] = []) {
  const step = 0.25, seen = new Set<number>();
  const node = (ix: number, iz: number, feet: number) => ((ix+4096)*8192+iz+4096)*128+Math.round(feet*4);
  const index = collisionIndex(g,opened);
  if (index.surface(from.x,from.z,from.y)) {
    const queue: [number,number,number][] = [[Math.round(from.x/step),Math.round(from.z/step),from.y]];
    seen.add(node(...queue[0]));
    for (let i=0;i<queue.length;i++) {
      const [ix,iz,feet] = queue[i];
      for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const x = (ix+dx)*step, z = (iz+dz)*step;
        const s = index.surface(x,z,feet);
        if (!s) continue;
        const nextFeet = surfaceHeight(s,x,z);
        const key = node(ix+dx,iz+dz,nextFeet);
        if (seen.has(key) || !index.clear(x,z,nextFeet)) continue;
        seen.add(key);
        queue.push([ix+dx,iz+dz,nextFeet]);
      }
    }
  }
  return (p: Point3) => {
    const s = surfaceAt(g,p.x,p.z,p.y);
    return seen.has(node(Math.round(p.x/step),Math.round(p.z/step),s ? surfaceHeight(s,p.x,p.z) : p.y));
  };
}

export const spawnPoints = [{x:-0.7,z:3},{x:0.7,z:3}];
export const lampSpawn = {x:0,z:2};

// Structural checks for a generated facility. Room interiors are checked once
// per template by `socketGroups`, so walking routes follow from the link graph.
export function validLayout(layout: Layout) {
  const {rooms,passages} = layout;
  const byId = new Map(rooms.map(r => [r.id,r]));
  if (byId.size !== rooms.length || rooms.length < 5) return false;
  if (rooms.some(r => !(r.template in roomTemplates) || r.kind !== kindOf(r.template) || ![0,1,2,3].includes(r.turn) ||
      ![0,storey].includes(r.y) || !Number.isInteger(r.x/cell) || !Number.isInteger(r.z/cell))) return false;
  const intake = rooms.find(r => r.kind === 'intake');
  if (!intake || intake.x !== -4 || intake.y !== 0 || intake.z !== 0 || intake.turn !== 0) return false;
  const destinations = rooms.filter(r => r.kind !== 'corridor' && r.kind !== 'stairwell');
  if (new Set(destinations.map(r => r.kind)).size !== destinations.length) return false;
  if (destinations.some(r => r.kind !== 'intake' && !destinationPool.includes(r.template))) return false;
  const filled = new Set<string>();
  for (const r of rooms) for (const key of cellsOf(r)) {
    if (filled.has(key) || +key.split(',')[2] > 1) return false;
    filled.add(key);
  }
  let g: Geometry;
  try { g = assembleTemplates(rooms,passages); } catch { return false; }
  if (overlapping(rooms)) return false;
  // Every corridor piece is a junction or a run; a stairwell joins both storeys.
  const linked = new Map(rooms.map(r => [r.id,[] as string[]]));
  for (const p of passages) { linked.get(p.a)!.push(p.from); linked.get(p.b)!.push(p.to); }
  for (const r of rooms) {
    const ends = linked.get(r.id)!;
    if (r.kind === 'corridor' && ends.length !== roomTemplates[r.template].sockets.length) return false;
    if (r.kind === 'stairwell' && !(ends.some(e => e.startsWith('upper')) && ends.some(e => e.startsWith('lower')))) return false;
    if (!ends.length) return false;
  }
  if (!rooms.some(r => r.kind === 'stairwell') || !destinations.some(r => r.y === storey)) return false;
  // Walk the socket graph: enter a room at one socket, leave by any socket in the same group.
  const reach = routeReach(layout,intake.id,'north1');
  if (rooms.some(r => !reach.has(r.id))) return false;
  const solids = obstaclesAt(g,0);
  return [...spawnPoints,lampSpawn].every((p,i) => clearAt(p.x,p.z,i<2 ? playerRadius : 0.14,solids));
}

// Rooms reachable on foot from a socket, following template interiors and links.
export function routeReach(layout: Layout, room: string, socket: string) {
  const byId = new Map(layout.rooms.map(r => [r.id,r]));
  const ends = new Map<string,string[]>();
  for (const p of layout.passages) {
    ends.set(p.a+'/'+p.from,[p.b,p.to]);
    ends.set(p.b+'/'+p.to,[p.a,p.from]);
  }
  const seen = new Set<string>(), rooms = new Set<string>();
  const queue = [[room,socket]];
  for (const [id,name] of queue) {
    if (seen.has(id+'/'+name)) continue;
    seen.add(id+'/'+name);
    rooms.add(id);
    const groups = socketGroups(byId.get(id)!.template);
    for (const [other,group] of groups) if (group === groups.get(name) && group >= 0) {
      if (!seen.has(id+'/'+other)) queue.push([id,other]);
      const through = ends.get(id+'/'+other);
      if (through) queue.push(through);
    }
  }
  return rooms;
}

// No two rooms may share volume, whatever their footprint shapes.
function overlapping(rooms: Module[]) {
  const boxes = rooms.map(r => {
    const t = orient(r.template,r.turn);
    return t.footprint.map(f => ({x:r.x+f.x,z:r.z+f.z,w:f.w,d:f.d,y:r.y,h:t.height}));
  });
  for (let i=0;i<boxes.length;i++) for (let j=i+1;j<boxes.length;j++) {
    for (const a of boxes[i]) for (const b of boxes[j]) {
      if (Math.abs(a.x-b.x) < (a.w+b.w)/2-1e-6 && Math.abs(a.z-b.z) < (a.d+b.d)/2-1e-6 &&
          a.y < b.y+b.h-1e-6 && b.y < a.y+a.h-1e-6) return true;
    }
  }
  return false;
}

export { socketAt };
