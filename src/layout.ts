import { clearAt } from './room.ts';
import type { Point } from './room.ts';

import { assembleTemplates, bayTemplates, roomTemplates, stairwellLinks, stairwellRooms } from './room-templates.ts';
import type { Placement, TemplateGeometry, TemplateKind, TemplateLink } from './room-templates.ts';

export const generatorVersion = 2;
export const playerRadius = 0.25;
export const pitch = 10;
export const opening = 2.4;
export interface Rect extends Point { w: number; d: number }
export type Kind = 'intake' | 'pump' | 'stores' | 'junction' | 'relay' | 'exit' | 'switchboard' | 'chiller';
export interface Module extends Point { id: string; kind: Kind; rotation: number; template?: TemplateKind }
export interface Passage { a: string; b: string; id: string; bulkhead: boolean }
export interface Layout {
  seed: number; version: number; fallback: boolean;
  rooms: Module[]; passages: Passage[];
  templatePlan?: { rooms:Placement[]; links:TemplateLink[] };
  callout: 'line-test' | 'black-start';
  lampId: 'inspection-light'; objectiveId: string; exitId: string;
}
export interface Door extends Rect { id: string }
export interface Geometry { floors: Rect[]; walls: Rect[]; equipment: Rect[]; doors: Door[]; templates?:TemplateGeometry }

// Repeated bays have a stencilled number crews can call out to each other.
export function roomLabel(room: Module) {
  if (room.template) return roomTemplates[room.template].name;
  const name = bayTemplates[room.kind].name;
  if (room.kind !== 'pump' && room.kind !== 'stores' && room.kind !== 'junction') return name;
  return name+' '+room.id.replace(/^bay-/,'').padStart(2,'0');
}

export function footprint(room: Module): Rect {
  if (room.template) {
    const patches=roomTemplates[room.template].footprint;
    const left=Math.min(...patches.map(p=>p.x-p.w/2)), right=Math.max(...patches.map(p=>p.x+p.w/2));
    const north=Math.min(...patches.map(p=>p.z-p.d/2)), south=Math.max(...patches.map(p=>p.z+p.d/2));
    return {x:room.x+(left+right)/2,z:room.z+(north+south)/2,w:right-left,d:south-north};
  }
  const {w:width,d:depth} = bayTemplates[room.kind].footprint[0];
  return { x: room.x, z: room.z, w: room.rotation % 2 ? depth : width, d: room.rotation % 2 ? width : depth };
}

// A repeatable solo walkthrough while the seeded generator is in development.
export function stairwellLayout():Layout {
  const kinds:Record<TemplateKind,Kind> = {intake:'intake',closet:'stores',hall:'relay',tunnel:'junction',stairwell:'junction'};
  return {version:generatorVersion,seed:0,fallback:false,callout:'line-test',lampId:'inspection-light',
    objectiveId:'hall',exitId:'intake',templatePlan:{rooms:stairwellRooms,links:stairwellLinks},
    rooms:stairwellRooms.map(r=>({...r,kind:kinds[r.template],rotation:0})),
    passages:stairwellLinks.map(e=>({a:e.a,b:e.b,id:e.a+'-'+e.b,bulkhead:false}))};
}

// Both collision and rendering use these exact slabs. Corridors bridge the
// gap between differently sized modules and meet both sockets at full width.
export function geometryFor(layout: Layout): Geometry {
  const result: Geometry = {floors:[], walls:[], equipment:[], doors:[]};
  if (layout.templatePlan) {
    result.templates = assembleTemplates(layout.templatePlan.rooms,layout.templatePlan.links);
    result.floors = result.templates.surfaces;
    return result;
  }
  const sides = new Map(layout.rooms.map(room => [room.id,new Set<string>()]));
  const footprints = new Map(layout.rooms.map(room => [room.id,footprint(room)]));
  for (const link of layout.passages) {
    const a = footprints.get(link.a)!, b = footprints.get(link.b)!;
    const dx = Math.sign(b.x-a.x), dz = Math.sign(b.z-a.z);
    sides.get(link.a)!.add(dx+','+dz);
    sides.get(link.b)!.add(-dx+','+-dz);
    const startX = a.x + dx*a.w/2, startZ = a.z + dz*a.d/2;
    const endX = b.x - dx*b.w/2, endZ = b.z - dz*b.d/2;
    const x = (startX+endX)/2, z = (startZ+endZ)/2;
    const w = dx ? Math.abs(endX-startX) : opening;
    const d = dz ? Math.abs(endZ-startZ) : opening;
    result.floors.push({x,z,w,d});
    for (const side of [-1,1]) result.walls.push({
      x:x+side*dz*opening/2, z:z+side*dx*opening/2, w:dx ? w+0.2 : 0.2, d:dz ? d+0.2 : 0.2,
    });
    if (link.bulkhead) result.doors.push({id:link.id,x,z,w:dx ? 0.18 : opening,d:dz ? 0.18 : opening});
  }
  for (const room of layout.rooms) {
    const f = footprints.get(room.id)!;
    result.floors.push(f);
    for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const x = f.x+dx*f.w/2, z = f.z+dz*f.d/2;
      const length = dx ? f.d : f.w;
      const gap = sides.get(room.id)!.has(dx+','+dz) ? opening : 0;
      const piece = gap ? (length-gap)/2 : length;
      for (const offset of gap ? [-(gap+piece)/2,(gap+piece)/2] : [0]) {
        result.walls.push({x:x+dz*offset,z:z+dx*offset,w:dx ? 0.2 : piece,d:dz ? 0.2 : piece});
      }
    }
    // Place the equipment in one rotated corner, leaving the cross-aisles clear.
    if (room.kind !== 'intake' && room.kind !== 'junction') {
      const xSign = [1,-1,-1,1][room.rotation], zSign = [1,1,-1,-1][room.rotation];
      result.equipment.push({x:f.x+xSign*(f.w/2-1.1),z:f.z+zSign*(f.d/2-1.1),w:1.25,d:1.25});
    }
  }
  return result;
}

export function blockers(geometry: Geometry, opened: readonly string[]) {
  return [...geometry.walls,...geometry.equipment,...geometry.doors.filter(d => !opened.includes(d.id))];
}

export function nearbyDoor(p: Point, geometry: Geometry, opened: readonly string[]) {
  return geometry.doors.find(d => !opened.includes(d.id) && Math.hypot(d.x-p.x,d.z-p.z) < 1.9 &&
    clearAt((d.x+p.x)/2,(d.z+p.z)/2,0.1,geometry.walls));
}

export function distances(rooms: Module[], passages: Passage[], start: string) {
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

// The Bell Diver follows ceiling wiring through the same passages as the crew.
export function nextWiredBay(layout: Layout, from: string, target: string) {
  if (from === target) return from;
  const steps = distances(layout.rooms,layout.passages,target);
  for (const {a,b} of layout.passages) {
    const next = a === from ? b : b === from ? a : undefined;
    if (next && steps.get(next)! < steps.get(from)!) return next;
  }
  return from;
}

export function validLayout(layout: Layout) {
  const {rooms,passages} = layout;
  const byId = new Map(rooms.map(r => [r.id,r]));
  const occupied = new Set(rooms.map(r => r.x+','+r.z));
  if (byId.size !== rooms.length || occupied.size !== rooms.length || rooms.length < 5) return false;
  if (rooms.some(r => !Number.isInteger(r.x/pitch) || !Number.isInteger(r.z/pitch) ||
      !Number.isInteger(r.rotation) || r.rotation<0 || r.rotation>3)) return false;
  const footprints = rooms.map(footprint);
  if (footprints.some((a,i) => footprints.slice(i+1).some(b =>
    Math.abs(a.x-b.x)<(a.w+b.w)/2 && Math.abs(a.z-b.z)<(a.d+b.d)/2))) return false;
  const entrance = rooms.find(r => r.kind === 'intake');
  if (!entrance || entrance.x !== 0 || entrance.z !== 0 || byId.get(layout.objectiveId)?.kind !== 'relay' ||
      byId.get(layout.exitId)?.kind !== 'exit') return false;
  if (!rooms.some(r => r.kind === 'switchboard') || !rooms.some(r => r.kind === 'chiller')) return false;
  const edges = new Set<string>();
  for (const {a,b} of passages) {
    const u = byId.get(a), v = byId.get(b);
    const key = [a,b].sort().join('/');
    if (!u || !v || edges.has(key) || Math.hypot(u.x-v.x,u.z-v.z) !== pitch) return false;
    edges.add(key);
  }
  if (edges.size < rooms.length || distances(rooms,passages,entrance.id).size !== rooms.length) return false;
  const g = geometryFor(layout);
  const walls = [...g.walls,...g.equipment];
  if (![-0.7,0.7].every(x => clearAt(x,3,playerRadius,walls)) || !clearAt(0,2,0.14,walls)) return false;
  for (const {a,b} of passages) {
    const u = byId.get(a)!, v = byId.get(b)!;
    for (let step=0; step<=40; step++) {
      const x = u.x+(v.x-u.x)*step/40, z = u.z+(v.z-u.z)*step/40;
      if (!g.floors.some(f => Math.abs(x-f.x)<=f.w/2 && Math.abs(z-f.z)<=f.d/2) ||
          !clearAt(x,z,playerRadius,walls)) return false;
    }
  }
  return true;
}
