import { collisionIndex, connections, geometryFor, walkable, type Geometry, type Layout } from './layout.ts';
import { landings, placeBridges, placeRuins, placeWrecks, riverCourse, riverCut, riverDepth, riverNearest, riverFloor, riverWater, trail, type Bridge, type River, type Ruin, type Wreck } from './outdoor-features.ts';
import { wadeDepth, waterLevel, type Water } from './room-templates.ts';
import { climbable, fieldGrade, fieldHeight, maxGrade, obstaclesAt, orient, outward, planningGrade, socketAt, surfaceAt } from './room-templates.ts';
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
  // Landmarks: the dry riverbed and its fords (the choke points), ruins and
  // wrecks (cover), and worn trails from the arrival to each door. `marks`
  // tags each height-map point: 1 trail, 2 riverbed.
  river: River; fords: Point3[]; ruins: Ruin[]; wrecks: Wreck[]; trails: Point3[][]; marks: Uint8Array;
  // Water in the riverbed (also on the geometry), and the bridges over it.
  water: Water; bridges: Bridge[];
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
  // The dry riverbed keeps well clear of the building and the arrival.
  const river = riverCourse(next,half,[{x:building.x,z:building.z,r:34},{x:ax,z:az,r:18}]) ?? {points:[],fords:[]};
  const featureSeed = Math.floor(next()*2**31);
  // Every door and the bell must be reachable on foot, and nowhere an
  // operator can get down to may leave them stranded. Try other ditches
  // first, then gentler ground.
  for (let attempt=0;;attempt++) {
    const scale = attempt < 4 ? 1 : attempt < 9 ? 1-(attempt-3)*0.16 : 0, shift = attempt*97.3;
    const hills = noise(seed ^ 0x9e3779b9), creases = noise(seed ^ 0x7f4a7c15), fade = noise(seed ^ 0x51a3c2e9);
    const base = (x: number, z: number) => scale*(6*hills(x/46+offsets[0],z/46+offsets[1])+2.2*hills(x/19+offsets[2],z/19+offsets[3])+0.7*hills(x/8,z/8+offsets[0]))
      // Ditches: troughs along the zero lines of a second noise, with a level
      // floor about 3 m wide between steep walls, so an operator who drops in
      // can walk along the floor to where the ditch fades out into a crossing.
      -scale*2.8*smooth((1-Math.abs(creases(x/34+offsets[1]+shift,z/34+offsets[2]))/0.16)/0.55)*smooth((fade(x/23+shift,z/23+offsets[3])+0.15)/0.5);
    const arrivalLevel = base(ax,az), fordLevels = river.fords.map(f => ({x:f.x,z:f.z,y:base(f.x,f.z)}));
    // Around each ford the hillside eases toward the ford's own height, so
    // its gentle banks aren't tipped too steep by the slope they sit on.
    const shaped = (x: number, z: number) => {
      let y = base(x,z);
      for (const f of fordLevels) { const d = Math.hypot(x-f.x,z-f.z); if (d < 22) y += (f.y-y)*(1-smooth((d-12)/10)); }
      return y;
    };
    const n = outdoorSize+1, h: number[] = new Array(n*n);
    for (let k=0;k<n;k++) for (let i=0;i<n;i++) {
      const x = i-half, z = k-half;
      let y = shaped(x,z);
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
    // Invisible walls just short of the cliffs' foot: the cliffs are scenery,
    // and where ground sloping toward the edge meets them it could pen
    // someone in.
    const edge = half-13;
    for (const [x0,z0,x1,z1] of [[-edge,-edge-0.5,edge,-edge],[-edge,edge,edge,edge+0.5],[-edge-0.5,-edge,-edge,edge],[edge,-edge,edge+0.5,edge]]) g.walls.push(wall(room,x0,z0,x1,z1,low-5,80));
    g.walls.push(wall(room,building.x-building.w/2,building.z-building.d/2,building.x+building.w/2,building.z+building.d/2,0,building.h));
    g.props.push({x:bell.x,z:bell.z,w:1.3,d:1.3,y:0,h:2.7,kind:'bell',room});
    // Nowhere to get stuck: fill any ground that has no way back out.
    for (let pass=0;pass<6 && unstrand(g,ground,{x:ax,y:arrivalLevel,z:az});pass++);
    // Then the riverbed, carved after: falling into it away from a ford is a
    // hazard by design. Never cut below the floor at the river's middle, so
    // its banks hold no deep pockets.
    if (river.points.length) {
      const before = {...ground,h:[...h]};
      for (let j=0;j<n*n;j++) {
        const x = ground.x0+(j % n), z = ground.z0+Math.floor(j/n), cut = riverCut(river,x,z);
        if (cut <= 0) continue;
        const c = riverNearest(river,x,z);
        h[j] = Math.round(Math.max(h[j]-cut,fieldHeight(before,c.x,c.z)-riverDepth)*100)/100;
      }
    }
    // Water in the riverbed, and dilapidated bridges over it.
    const water = riverWater(river,height);
    g.water = water;
    const bridges = river.points.length ? placeBridges(random(featureSeed ^ 0x6b43a9b5),river,water,ground,half) : [];
    // Level a pad of ground at each landing to the deck's height, a little
    // under it, so stepping on or off is one small step whichever way the
    // bank tilts, easing back into the hillside over a few metres.
    for (const b of bridges) for (const l of landings(b)) {
      const cross = b.along === 'x' ? b.z : b.x;
      for (let j=0;j<n*n;j++) {
        const x = ground.x0+(j % n), z = ground.z0+Math.floor(j/n), t = (b.along === 'x' ? x : z)-l.edge, c = Math.abs((b.along === 'x' ? z : x)-cross);
        const out = t*l.out, beyond = Math.max(0,c-1.8,out-3,-out-0.6);
        if (beyond >= 3) continue;
        const pad = l.y-0.06, w = 1-smooth(beyond/3);
        h[j] = Math.round((h[j]+(pad-h[j])*w)*100)/100;
      }
    }
    for (const b of bridges) {
      for (const pl of b.planks) g.surfaces.push({x:pl.x,z:pl.z,w:pl.w,d:pl.d,y:pl.y,rise:pl.rise,...(pl.along ? {along:pl.along} : {}),room});
      for (const r of b.rails) g.walls.push(wall(room,r.x-r.w/2,r.z-r.d/2,r.x+r.w/2,r.z+r.d/2,r.y,r.h));
    }
    // Ruins and wrecks, on gentle ground clear of the plots, the riverbed
    // and each other.
    const pick = random(featureSeed+attempt), taken: {x: number; z: number; r: number}[] = [];
    const clear = (x: number, z: number, r: number) =>
      !(Math.abs(x-building.x) < building.w/2+14+r && Math.abs(z-building.z-2) < building.d/2+15+r) && Math.hypot(x-ax,z-az) > 16+r &&
      Math.max(Math.abs(x),Math.abs(z))+r < half-16 && river.points.every(p => Math.hypot(p.x-x,p.z-z) > r+riverFloor+9) &&
      taken.every(t => Math.hypot(t.x-x,t.z-z) > t.r+r+1.5);
    const claim = (x: number, z: number, r: number) => { taken.push({x,z,r}); };
    // Keep the bridges' landings open.
    for (const b of bridges) for (const e of [b.planks[0],b.planks.at(-1)!]) claim(e.x,e.z,3);
    const ruins = placeRuins(pick,ground,half,clear,claim), wrecks = placeWrecks(pick,ground,half,clear,claim);
    for (const r of ruins) {
      for (const b of r.pieces) g.walls.push(wall(room,b.x-b.w/2,b.z-b.d/2,b.x+b.w/2,b.z+b.d/2,b.y,b.h));
      for (const b of r.rubble) g.props.push({x:b.x,z:b.z,w:b.w,d:b.d,y:b.y,h:b.h,kind:'rock',room});
    }
    for (const w of wrecks) for (const b of w.boxes) g.props.push({x:b.x,z:b.z,w:b.w,d:b.d,y:b.y,h:b.h,kind:'wreck',room});
    // Boulders, sitting in the ground, clear of the plots and of each other.
    const rocks: Outdoors['rocks'] = ruins.flatMap(r => r.rubble.map(b => ({x:b.x,y:b.y,z:b.z,w:b.w,d:b.d,h:b.h})));
    for (const [a,b,c,d,e] of rockSeeds) {
      if (rocks.length >= 60) break;
      const w = 0.8+a*2, dd = 0.8+b*2, rh = 0.6+c*2, x = (d-0.5)*(outdoorSize-28), z = (e-0.5)*(outdoorSize-28);
      if (Math.abs(x-building.x) < building.w/2+12 && Math.abs(z-building.z-2) < building.d/2+13) continue;
      if (Math.hypot(x-ax,z-az) < 12 || rocks.some(r => Math.abs(r.x-x) < (r.w+w)/2+2 && Math.abs(r.z-z) < (r.d+dd)/2+2)) continue;
      if (taken.some(t => Math.hypot(t.x-x,t.z-z) < t.r+Math.max(w,dd))) continue;
      // Out of the riverbed, its fords and its banks.
      if (river.points.some(p => Math.hypot(p.x-x,p.z-z) < riverFloor+15+Math.max(w,dd)/2)) continue;
      // Only on gentle ground, a metre clear of anything steep: a boulder
      // half buried in a ditch wall could pen someone in against it.
      let gentle = true;
      for (let px=x-w/2-1;px<=x+w/2+1 && gentle;px+=0.5) for (let pz=z-dd/2-1;pz<=z+dd/2+1 && gentle;pz+=0.5) gentle = fieldGrade(ground,px,pz) <= 0.25;
      if (!gentle) continue;
      const y = Math.min(height(x-w/2,z-dd/2),height(x+w/2,z-dd/2),height(x-w/2,z+dd/2),height(x+w/2,z+dd/2))-0.15;
      rocks.push({x,y,z,w,d:dd,h:rh});
      g.props.push({x,z,w,d:dd,y,h:rh,kind:'rock',room});
    }
    const stand = (x: number, z: number, yaw: number): Stand => ({x,y:height(x,z),z,yaw});
    // Spawns side by side, facing the building.
    const face = Math.atan2(ax,az);
    const spawns = [-1.2,1.2].map(side => stand(ax+Math.cos(face)*side,az-Math.sin(face)*side,face));
    // Worn trails from the arrival to each door, around everything placed.
    const index = collisionIndex(g), wander = noise(featureSeed ^ 0x2545f491);
    // Never through water deeper than a wade.
    const dry = (x: number, z: number, y: number) => { const l = waterLevel(water,x,z); return l === undefined || l-y <= wadeDepth+0.5; };
    const trails = doors.map(d => trail(ground,g.surfaces[0],(x,z,y) => index.clear(x,z,y,0.6) && dry(x,z,y),(x,z) => wander(x/12,z/12)*0.5+0.5,{x:ax,z:az},d.exit));
    const marks = new Uint8Array(n*n);
    for (let j=0;j<n*n;j++) if (river.points.length && riverCut(river,ground.x0+(j % n),ground.z0+Math.floor(j/n)) > riverDepth*0.7) marks[j] = 2;
    for (const line of trails) for (const p of line ?? []) for (let dz=-1;dz<=1;dz++) for (let dx=-1;dx<=1;dx++) {
      const i = Math.round(p.x-ground.x0)+dx, k = Math.round(p.z-ground.z0)+dz;
      if (i >= 0 && k >= 0 && i < n && k < n && Math.hypot(ground.x0+i-p.x,ground.z0+k-p.z) <= 1.3) marks[k*n+i] = 1;
    }
    const world: Outdoors = {
      seed,geometry:g,size:outdoorSize,ground,arrival:{x:ax,y:arrivalLevel,z:az},spawns,building,doors,door,exit:doors[0].exit,rocks,bell,
      ringing:{x:bell.x,y:0,z:bell.z+1.5,yaw:0},
      river,fords:river.fords.map(f => ({x:f.x,y:height(f.x,f.z),z:f.z})),ruins,wrecks,trails:trails.map(t => t ?? []),marks,water,bridges,
    };
    const reached = walkable(g,spawns[0],[],0.5);
    if (scale === 0 || (trails.every(Boolean) && [...doors.map(d => d.exit),world.ringing,spawns[1]].every(p => reached(p)))) {
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

// Raise any ground an operator could walk down to from `from` but not climb
// back out of. Walking downhill is always allowed, so ground is safe if a
// level or downhill path leads from it to ground that can walk back to
// `from`. Working on a half-metre lattice, stranded points get the height
// they need, from the safe ground outward in order of height (a ditch section
// with no way out fills to its lowest rim), and the height map's points
// around each are raised to match. Returns how many points were stranded.
function unstrand(g: Geometry, f: Heightfield, from: Point3) {
  const step = f.step/2, n = (f.n-1)*2+1, s = g.surfaces[0], index = collisionIndex(g);
  const at = (j: number) => ({x:f.x0+(j % n)*step,z:f.z0+Math.floor(j/n)*step});
  const h = new Float64Array(n*n), open = new Uint8Array(n*n);
  for (let j=0;j<n*n;j++) { const p = at(j); h[j] = fieldHeight(f,p.x,p.z); open[j] = index.clear(p.x,p.z,h[j]) ? 1 : 0; }
  const neighbours = (j: number) => { const i = j % n, k = Math.floor(j/n); return [i+1 < n ? j+1 : -1,i > 0 ? j-1 : -1,k+1 < n ? j+n : -1,k > 0 ? j-n : -1].filter(v => v >= 0); };
  // A move from a to b, onto b: downhill always; uphill onto gentle ground.
  // The way back out must be comfortably gentle (the planning limit).
  const may = (a: number, b: number, limit: number) => { const p = at(b); return climbable(s,h[a],h[b],p.x,p.z,limit); };
  const start = Math.round((from.z-f.z0)/step)*n+Math.round((from.x-f.x0)/step);
  const flood = (forward: boolean) => {
    const seen = new Uint8Array(n*n), queue = [start];
    seen[start] = 1;
    for (let q=0;q<queue.length;q++) for (const b of neighbours(queue[q])) {
      if (seen[b] || !open[b] || !(forward ? may(queue[q],b,maxGrade) : may(b,queue[q],planningGrade))) continue;
      seen[b] = 1; queue.push(b);
    }
    return seen;
  };
  const out = flood(true), back = flood(false);
  let stranded = 0;
  for (let j=0;j<n*n;j++) if (out[j] && !back[j]) stranded++;
  if (!stranded) return 0;
  // Priority flood from the safe ground, lowest first.
  const heap: number[] = [], done = new Uint8Array(n*n), need = Float64Array.from(h);
  const less = (a: number, b: number) => need[heap[a]] < need[heap[b]];
  const push = (j: number) => { heap.push(j); for (let c=heap.length-1;c>0;) { const p = (c-1) >> 1; if (!less(c,p)) break; [heap[c],heap[p]] = [heap[p],heap[c]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; for (let c=0;;) { const l = 2*c+1, r = l+1; let m = c; if (l < heap.length && less(l,m)) m = l; if (r < heap.length && less(r,m)) m = r; if (m === c) break; [heap[m],heap[c]] = [heap[c],heap[m]]; c = m; } } return top; };
  for (let j=0;j<n*n;j++) if (back[j]) { done[j] = 1; push(j); }
  while (heap.length) {
    const c = pop();
    for (const b of neighbours(c)) {
      if (done[b] || !(out[b] && !back[b])) continue;
      done[b] = 1;
      if (need[b] < need[c]) need[b] = need[c];
      push(b);
    }
  }
  // Raise the height map's points around every raised lattice point.
  for (let j=0;j<n*n;j++) {
    if (need[j] <= h[j]) continue;
    const i = j % n, k = Math.floor(j/n), vi = [Math.floor(i/2),Math.ceil(i/2)], vk = [Math.floor(k/2),Math.ceil(k/2)];
    for (const a of vi) for (const b of vk) { const v = b*f.n+a; if (f.h[v] < need[j]) f.h[v] = Math.round(need[j]*100+0.5)/100; }
  }
  return stranded;
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
    // Not in the riverbed's water.
    const wet = g.water ? waterLevel(g.water,x,z) : undefined;
    if (wet !== undefined && wet > y-0.5) continue;
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
