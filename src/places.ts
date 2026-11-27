import { collisionIndex, connections, geometryFor, walkable, type Geometry, type Layout } from './layout.ts';
import { landings, placeBridges, placeFords, placeRuins, placeWrecks, poolFords, riverCourse, riverFloor, riverSurface, riverWater, trail, type Bridge, type River, type Ruin, type Wreck } from './outdoor-features.ts';
import { channel, poolAt, wadeDepth, waterLevel, type Pool, type Water } from './room-templates.ts';
import { mapKind, weather, windOf, type MapKind } from './map-kinds.ts';
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
  // The map's kind (see map-kinds.ts). A marsh has pools in `water.pools`,
  // plank boardwalks where its trails cross them, and reeds.
  kind: MapKind; boardwalks: {x: number; y: number; z: number; w: number; d: number}[]; reeds: {x: number; y: number; z: number; h: number}[];
  // A quarry's pit (its terraces' radii and levels, its ramps) and spoil heaps.
  quarry?: Quarry & {levels: number[]};
  // A quarry's toxic waste: glowing spills and the drums leaking into them.
  toxic?: Toxic;
}
export const outdoorSize = 160;
const outdoorCache = new Map<string,Outdoors>();

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
  const kind = mapKind(seed), cacheKey = kind+'/'+seed, found = outdoorCache.get(cacheKey);
  if (found) return found;
  // A marsh is low and flat: gentle swells, no ditches. A quarry's open
  // ground is milder than the hills, its relief the pit and the spoil heaps.
  // A snowfield rolls a little less, its ditches filled in.
  const relief = kind === 'marsh' ? 0.3 : kind === 'quarry' ? 0.55 : kind === 'snow' ? 0.8 : 1, ditching = kind === 'marsh' ? 0 : kind === 'quarry' || kind === 'snow' ? 0.5 : 1;
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
  const course = riverCourse(next,half,[{x:building.x,z:building.z,r:34},{x:ax,z:az,r:18}]) ?? {points:[],fords:[]};
  // A quarry is dry: no river. Its pit and spoil heaps instead.
  const river: River = kind === 'quarry' ? {points:[],fords:[]} : course;
  const quarry = kind === 'quarry' ? quarryPlan(random(seed ^ 0x6a09e667),doors,{x:ax,z:az},building) : undefined;
  const featureSeed = Math.floor(next()*2**31), fordCount = river.fords.length;
  // Every door and the bell must be reachable on foot, and nowhere an
  // operator can get down to may leave them stranded. Try other ditches
  // first, then gentler ground.
  for (let attempt=0;;attempt++) {
    const scale = attempt < 4 ? 1 : attempt < 9 ? 1-(attempt-3)*0.16 : 0, shift = attempt*97.3;
    const hills = noise(seed ^ 0x9e3779b9), creases = noise(seed ^ 0x7f4a7c15), fade = noise(seed ^ 0x51a3c2e9);
    const base = (x: number, z: number) => scale*relief*(6*hills(x/46+offsets[0],z/46+offsets[1])+2.2*hills(x/19+offsets[2],z/19+offsets[3])+0.7*hills(x/8,z/8+offsets[0]))
      // Ditches: troughs along the zero lines of a second noise, with a level
      // floor about 3 m wide between steep walls, so an operator who drops in
      // can walk along the floor to where the ditch fades out into a crossing.
      -scale*ditching*2.8*smooth((1-Math.abs(creases(x/34+offsets[1]+shift,z/34+offsets[2]))/0.16)/0.55)*smooth((fade(x/23+shift,z/23+offsets[3])+0.15)/0.5);
    // The fords go where the river would cut least deep into these hills.
    if (river.points.length) river.fords = placeFords(river,riverSurface(river,base,half),base,half,fordCount,[{x:building.x,z:building.z,r:42},{x:ax,z:az,r:28}]);
    const arrivalLevel = base(ax,az);
    // The open ground: the plots levelled into it.
    const open = (x: number, z: number) => {
      let y = base(x,z);
      // The building's plot, with the bell in front, is level at 0.
      const plot = Math.max(Math.abs(x-building.x)-building.w/2-8,Math.abs(z-building.z-2)-building.d/2-9,0);
      y *= smooth(plot/12);
      // The arrival area is level too, at the height of the ground there.
      const near = Math.hypot(x-ax,z-az);
      return y+(arrivalLevel-y)*(1-smooth((near-7)/8));
    };
    // The quarry's rim: the open ground around its pit, on average.
    let rimLevel = 0;
    if (quarry) { for (let a=0;a<12;a++) rimLevel += open(quarry.x+Math.cos(a*Math.PI/6)*(quarry.radii[0]+1.5),quarry.z+Math.sin(a*Math.PI/6)*(quarry.radii[0]+1.5))/12; rimLevel = Math.round(rimLevel*100)/100; }
    const n = outdoorSize+1, h: number[] = new Array(n*n);
    for (let k=0;k<n;k++) for (let i=0;i<n;i++) {
      const x = i-half, z = k-half;
      let y = open(x,z);
      // A quarry's heaps and pit, cut into the levelled ground.
      if (quarry) y = quarryHeight(quarry,x,z,y,rimLevel,open);
      // Cliffs ring the map: the ground rises too steeply to climb.
      const out = Math.max(Math.abs(x),Math.abs(z))-(half-12);
      if (out > 0) y += out*1.6;
      h[k*n+i] = Math.round(y*100)/100;
    }
    const ground: Heightfield = {x0:-half,z0:-half,step:1,n,h};
    const low = Math.min(...h), height = (x: number, z: number) => fieldHeight(ground,x,z);
    const g = emptyGeometry();
    // The wind, for throws.
    const wind = windOf(seed);
    if (wind) g.wind = wind;
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
    // A marsh's pools, carved after too: wide and shallow (muddy to wade),
    // a few with a sinkhole far over the head that the fog hides.
    const {pools,crossings} = kind === 'marsh' ? marshPools(random(featureSeed ^ 0x3c6ef372),ground,half,building,{x:ax,z:az},river) : {pools:[],crossings:[]};
    if (pools.length) carvePools(ground,pools);
    // Then the river, carved after: falling into it away from a ford is a
    // hazard by design. Its surface follows the ground downstream without
    // ever rising; the bed is cut under it, and a low levee holds the water
    // in wherever the bank would be lower.
    const water = riverWater(river,river.points.length ? poolFords(river,riverSurface(river,height,half)) : []);
    if (pools.length) water.pools = pools;
    if (weather[kind].mud) water.mud = true;
    // The building's plot and the arrival area stay as they are, the cut
    // easing in over 8 m around them.
    for (let j=0;j<n*n && river.points.length;j++) {
      const x = ground.x0+(j % n), z = ground.z0+Math.floor(j/n), c = channel(water,x,z);
      if (!c) continue;
      const plot = Math.max(Math.abs(x-building.x)-building.w/2-8,Math.abs(z-building.z-2)-building.d/2-9,0), keep = Math.min(smooth(plot/8),smooth((Math.hypot(x-ax,z-az)-15)/8));
      h[j] = Math.round((h[j]+(Math.min(c.bed,Math.max(h[j],c.levee))-h[j])*keep)*100)/100;
    }
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
    // Where neighbouring stretches stand at slightly different levels (inside
    // a bend near a ford), or a bridge's landing pad eases down beside it, a
    // dry point beside the water could lie below it; raise any such point
    // just above the water, so its edge meets a bank.
    if (river.points.length) {
      const level = new Float64Array(n*n).fill(Number.NaN), beside: number[] = [];
      for (let j=0;j<n*n;j++) level[j] = waterLevel(water,ground.x0+(j % n),ground.z0+Math.floor(j/n)) ?? Number.NaN;
      for (let j=0;j<n*n;j++) if (Number.isNaN(level[j])) {
        const i = j % n, k = Math.floor(j/n);
        let top = -Infinity;
        for (let dk=-1;dk<=1;dk++) for (let di=-1;di<=1;di++) {
          const ni = i+di, nk = k+dk;
          if (ni >= 0 && nk >= 0 && ni < n && nk < n && !Number.isNaN(level[nk*n+ni])) top = Math.max(top,level[nk*n+ni]);
        }
        if (h[j] < top) beside.push(j,top);
      }
      for (let q=0;q<beside.length;q+=2) h[beside[q]] = Math.round((beside[q+1]+0.1)*100)/100;
    }
    for (const b of bridges) {
      for (const pl of b.planks) g.surfaces.push({x:pl.x,z:pl.z,w:pl.w,d:pl.d,y:pl.y,rise:pl.rise,...(pl.along ? {along:pl.along} : {}),room});
      for (const r of b.rails) g.walls.push(wall(room,r.x-r.w/2,r.z-r.d/2,r.x+r.w/2,r.z+r.d/2,r.y,r.h));
    }
    // Ruins and wrecks, on gentle ground clear of the plots, the riverbed
    // and each other.
    const pick = random(featureSeed+attempt), taken: {x: number; z: number; r: number}[] = [];
    // Nothing on a quarry's ramps.
    for (const r of quarry?.ramps ?? []) for (let u=0;u<=1;u+=0.1) { const a = r.start+r.turn*r.span*u, d = r.radius-2; taken.push({x:quarry!.x+Math.cos(a)*d,z:quarry!.z+Math.sin(a)*d,r:2.5}); }
    const clear = (x: number, z: number, r: number) =>
      !(Math.abs(x-building.x) < building.w/2+14+r && Math.abs(z-building.z-2) < building.d/2+15+r) && Math.hypot(x-ax,z-az) > 16+r &&
      Math.max(Math.abs(x),Math.abs(z))+r < half-16 && river.points.every(p => Math.hypot(p.x-x,p.z-z) > r+riverFloor+9) &&
      pools.every(p => Math.hypot(p.x-x,p.z-z) > p.r+r+2) &&
      taken.every(t => Math.hypot(t.x-x,t.z-z) > t.r+r+1.5);
    const claim = (x: number, z: number, r: number) => { taken.push({x,z,r}); };
    // Keep the bridges' landings open.
    for (const b of bridges) for (const e of [b.planks[0],b.planks.at(-1)!]) claim(e.x,e.z,3);
    // The boardwalks across the pools, laid now so nothing is put in their way.
    // Boardwalks: plank decks a little over the water, one 1.4 m square at
    // a time: straight across each pool cluster from bank to bank, and
    // wherever a trail wades through a pool.
    // Each run of decks reaches out onto dry land at both ends, its last
    // planks easing down until they lie half sunk in the bank's mud.
    const boardwalks: Outdoors['boardwalks'] = [], laid = new Set<string>();
    // Decks sit on a half-metre grid. A run is laid whole, and only if each
    // of its decks sits level with any it overlaps already laid.
    const lay = (run: {x: number; z: number; y: number}[]) => {
      const decks = run.map(p => ({x:Math.round(p.x*2)/2,y:Math.round(p.y*100)/100,z:Math.round(p.z*2)/2,w:1.4,d:1.4}));
      if (decks.some(d => boardwalks.some(b => Math.abs(b.x-d.x) < 1.4 && Math.abs(b.z-d.z) < 1.4 && Math.abs(b.y-d.y) > 0.05))) return false;
      for (const d of decks) {
        const key = d.x+','+d.z;
        if (laid.has(key)) continue;
        laid.add(key);
        boardwalks.push(d);
        g.surfaces.push({x:d.x,z:d.z,w:d.w,d:d.d,y:d.y,room});
      }
      return true;
    };
    // `out`: how far beyond the water's edge; `top`: the deck over the water.
    // On land a plank (0.1 m thick) is never more than half sunk.
    const sunk = (x: number, z: number, top: number, out: number) => {
      const pool = poolAt(water,x,z);
      if (pool) return pool.level+0.18;
      return Math.max(height(x,z)-0.05,top+(height(x,z)+0.03-top)*smooth(Math.max(out,0.5)/landing));
    };
    const landing = 2.5;
    // Out along a bank, deck by deck: each a step (0.3 m) at most from the
    // last, easing down into the mud, until one would be more; empty if even
    // the first can't be.
    const grid = (v: number) => Math.round(v*2)/2;
    const ashore = (side: {x: number; z: number; out: number}[], top: number) => {
      const run: {x: number; z: number; y: number}[] = [];
      let last = top;
      for (const p of side) {
        const x = grid(p.x), z = grid(p.z);
        if (poolAt(water,x,z)) break;
        const y = sunk(x,z,top,p.out);
        if (Math.abs(y-last) > 0.3 || y < height(x,z)-0.06) break;
        run.push({x,z,y}); last = y;
      }
      return run;
    };
    const crossed = new Set<number>();
    for (const c of crossings) {
      if (crossed.has(c.cluster)) continue;
      const at = (t: number) => ({x:c.x+c.dx*t,z:c.z+c.dz*t}), wet = (t: number) => !!poolAt(water,at(t).x,at(t).z);
      let first = -1, last = -1;
      for (let t=0;t<=c.length;t+=0.5) if (wet(t)) { if (first < 0) first = t; last = t; }
      if (first < 0) continue;
      // On over any water beyond (a neighbouring pool), to the true bank.
      while (first > -15 && wet(first-0.5)) first -= 0.5;
      while (last < c.length+15 && wet(last+0.5)) last += 0.5;
      const top = poolAt(water,at(first).x,at(first).z)!.level+0.18;
      const ts: number[] = [];
      for (let t=first-landing;t<=last+landing+1e-9;t+=1) ts.push(t);
      const lo = ashore(ts.filter(t => t < first).reverse().map(t => ({...at(t),out:first-t})),top), hi = ashore(ts.filter(t => t > last).map(t => ({...at(t),out:t-last})),top);
      if (!lo.length || !hi.length) continue;
      // Bank, water, bank, as one run.
      const span = ts.filter(t => t >= first && t <= last).map(t => ({...at(t),y:top}));
      if (!lay([...lo.reverse(),...span,...hi])) continue;
      crossed.add(c.cluster);
      // Keep its landings clear of ruins, wrecks and boulders.
      for (const t of [first-landing,last+landing]) claim(at(t).x,at(t).z,2.5);
    }
    const ruins = placeRuins(pick,ground,half,clear,claim), wrecks = placeWrecks(pick,ground,half,clear,claim);
    for (const r of ruins) {
      for (const b of r.pieces) g.walls.push(wall(room,b.x-b.w/2,b.z-b.d/2,b.x+b.w/2,b.z+b.d/2,b.y,b.h));
      for (const b of r.rubble) g.props.push({x:b.x,z:b.z,w:b.w,d:b.d,y:b.y,h:b.h,kind:'rock',room});
    }
    for (const w of wrecks) for (const b of w.boxes) g.props.push({x:b.x,z:b.z,w:b.w,d:b.d,y:b.y,h:b.h,kind:'wreck',room});
    // A quarry's waste: clusters of drums, some toppled and leaking into
    // glowing spills, on level ground about the open ground and in the pit.
    const toxic: Toxic | undefined = quarry ? {drums:[],spills:[]} : undefined;
    if (quarry && toxic) {
      const spill = random(featureSeed ^ 0x7f4a7c15);
      const level = (x: number, z: number, r: number) => { for (let px=x-r;px<=x+r;px+=0.5) for (let pz=z-r;pz<=z+r;pz+=0.5) if (fieldGrade(ground,px,pz) > 0.04) return false; return true; };
      // Where: the first on the pit's floor, then near the wrecks, then
      // anywhere clear.
      const near = wrecks.map(w => ({x:w.boxes[0].x,z:w.boxes[0].z}));
      for (let t=0;t<320 && toxic.spills.length<10;t++) {
        const floor = !toxic.spills.length && t < 60, base = floor ? {x:quarry.x,z:quarry.z} : t < 180 && near.length ? near[t % near.length] : {x:(spill()-0.5)*110,z:(spill()-0.5)*110};
        const spread = floor ? 5 : t < 180 ? 7 : 0, x = base.x+(spill()-0.5)*spread*2, z = base.z+(spill()-0.5)*spread*2;
        // On the floor, only kept off the ramps (it is too small for the
        // general margins); elsewhere, clear of everything.
        const offRamps = () => [0,1,2,3,4,5,6,7].every(k => !quarry.ramps.some(r => onRamp(quarry,r,x+Math.cos(k*Math.PI/4)*4.5,z+Math.sin(k*Math.PI/4)*4.5))) && !quarry.ramps.some(r => onRamp(quarry,r,x,z));
        if (!(floor ? offRamps() : clear(x,z,3)) || !level(x,z,2.2)) continue;
        if (floor && Math.hypot(x-quarry.x,z-quarry.z) > quarry.radii[2]-4) continue;
        const y = height(x,z), r = floor ? 2.2+spill()*1.2 : 1.1+spill()*1.2;
        toxic.spills.push({x,y,z,r});
        // The drums beside it: upright, or on their sides pointing into it.
        for (let i=0,count=2+Math.floor(spill()*3);i<count;i++) {
          const a = spill()*Math.PI*2, d = r+0.4+spill()*0.9, dx = x+Math.cos(a)*d, dz = z+Math.sin(a)*d, lying = spill() < 0.45;
          const along: 'x' | 'z' = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? 'x' : 'z';
          const w = lying && along === 'x' ? 0.9 : 0.62, dd = lying && along === 'z' ? 0.9 : 0.62, hh = lying ? 0.62 : 0.9;
          if (g.props.some(p => Math.abs(p.x-dx) < (p.w+w)/2+0.1 && Math.abs(p.z-dz) < (p.d+dd)/2+0.1)) continue;
          const dy = height(dx,dz);
          toxic.drums.push({x:dx,y:dy,z:dz,lying,along,leak:lying && spill() < 0.7,toward:a+Math.PI});
          g.props.push({x:dx,z:dz,w,d:dd,y:dy,h:hh,kind:'wreck',room});
        }
        claim(x,z,r+2);
      }
    }
    // Boulders, sitting in the ground, clear of the plots and of each other.
    const rocks: Outdoors['rocks'] = ruins.flatMap(r => r.rubble.map(b => ({x:b.x,y:b.y,z:b.z,w:b.w,d:b.d,h:b.h})));
    for (const [a,b,c,d,e] of rockSeeds) {
      // Loose rock: a quarry has more boulders.
      if (rocks.length >= (quarry ? 95 : 60)) break;
      const w = 0.8+a*2, dd = 0.8+b*2, rh = 0.6+c*2, x = (d-0.5)*(outdoorSize-28), z = (e-0.5)*(outdoorSize-28);
      if (Math.abs(x-building.x) < building.w/2+12 && Math.abs(z-building.z-2) < building.d/2+13) continue;
      if (Math.hypot(x-ax,z-az) < 12 || rocks.some(r => Math.abs(r.x-x) < (r.w+w)/2+2 && Math.abs(r.z-z) < (r.d+dd)/2+2)) continue;
      if (taken.some(t => Math.hypot(t.x-x,t.z-z) < t.r+Math.max(w,dd))) continue;
      // Out of the riverbed, its fords and its banks.
      if (river.points.some(p => Math.hypot(p.x-x,p.z-z) < riverFloor+15+Math.max(w,dd)/2)) continue;
      if (pools.some(p => Math.hypot(p.x-x,p.z-z) < p.r+2+Math.max(w,dd)/2)) continue;
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
    // Silt where the water stands and along its edge.
    for (let j=0;j<n*n;j++) { const x = ground.x0+(j % n), z = ground.z0+Math.floor(j/n), l = waterLevel(water,x,z); if (l !== undefined && h[j] < l+0.4) marks[j] = 2; }
    // A marsh's banks are mud for about 3 m around its pools (mark 3).
    for (let j=0;j<n*n && pools.length;j++) {
      if (marks[j]) continue;
      const x = ground.x0+(j % n), z = ground.z0+Math.floor(j/n);
      if (pools.some(p => p.depth < 1 && Math.hypot(x-p.x,z-p.z) < p.r+3 && h[j] < p.level+0.6)) marks[j] = 3;
    }
    // A quarry's loose rock (mark 4): its pit walls and the ground at their
    // feet, and its spoil heaps. It slows walkers (`TemplateGeometry.scree`).
    if (quarry) {
      // Fallout (mark 5): ashen ground about the spills and the wrecks.
      for (let j=0;j<n*n;j++) {
        const x = ground.x0+(j % n), z = ground.z0+Math.floor(j/n);
        if (toxic!.spills.some(s => Math.hypot(x-s.x,z-s.z) < s.r+2.5) || wrecks.some(w => Math.hypot(x-w.boxes[0].x,z-w.boxes[0].z) < 5.5)) marks[j] = 5;
      }
      for (let j=0;j<n*n;j++) {
        if (marks[j] === 5) continue;
        const i = j % n, k = Math.floor(j/n), x = ground.x0+i, z = ground.z0+k;
        const steep = [[1,0],[-1,0],[0,1],[0,-1]].some(([di,dk]) => { const a = i+di, b = k+dk; return a >= 0 && b >= 0 && a < n && b < n && Math.abs(h[b*n+a]-h[j]) > 1.2; });
        const d = Math.hypot(x-quarry.x,z-quarry.z), footing = quarry.radii.some(r => d < r+0.6 && d > r-2.2);
        if ((steep && d < quarry.radii[0]+2) || (footing && !quarry.ramps.some(r => onRamp(quarry,r,x,z))) || quarry.heaps.some(hp => Math.hypot(x-hp.x,z-hp.z) < hp.r*0.85)) marks[j] = 4;
      }
    }
    // A snowfield's deep drifts (mark 6): patches across the open ground and
    // in its hollows, clear of the plots; the trails are trodden down
    // (marked after, over them). They slow walkers (`TemplateGeometry.scree`, 2).
    if (kind === 'snow') {
      const drift = noise(seed ^ 0x3c6ef372);
      for (let j=0;j<n*n;j++) {
        if (marks[j]) continue;
        const i = j % n, k = Math.floor(j/n), x = ground.x0+i, z = ground.z0+k;
        if (Math.abs(x-building.x) < building.w/2+10 && Math.abs(z-building.z-2) < building.d/2+11) continue;
        if (Math.hypot(x-ax,z-az) < 12) continue;
        let around = 0, count = 0;
        for (const [di,dk] of [[3,0],[-3,0],[0,3],[0,-3]]) { const a = i+di, b = k+dk; if (a >= 0 && b >= 0 && a < n && b < n) { around += h[b*n+a]; count++; } }
        const hollow = count && h[j] < around/count-0.35;
        if (drift(x/14,z/14) > 0.3 || hollow) marks[j] = 6;
      }
    }
    for (const line of trails) for (const p of line ?? []) for (let dz=-1;dz<=1;dz++) for (let dx=-1;dx<=1;dx++) {
      const i = Math.round(p.x-ground.x0)+dx, k = Math.round(p.z-ground.z0)+dz;
      if (i >= 0 && k >= 0 && i < n && k < n && Math.hypot(ground.x0+i-p.x,ground.z0+k-p.z) <= 1.3) marks[k*n+i] = 1;
    }
    // Footing that slows: a quarry's loose rock, a snowfield's deep drifts.
    if (marks.some(m => m === 4 || m === 6)) g.scree = {x0:ground.x0,z0:ground.z0,n,cells:Uint8Array.from(marks,m => m === 4 ? 1 : m === 6 ? 2 : 0)};
    // Trails: decks over each stretch of a trail through a pool, onto the
    // banks either side, where both come ashore low; elsewhere it wades.
    for (const line of trails) {
      const pts = line ?? [], over = pts.map(p => poolAt(water,p.x,p.z));
      for (let i=0;i<pts.length;i++) {
        if (!over[i] || (i > 0 && over[i-1])) continue;
        let j = i;
        while (j+1 < pts.length && over[j+1]) j++;
        const top = over[i]!.level+0.18, bank = (side: Point3[]) => ashore(side.map((p,n) => ({x:p.x,z:p.z,out:Math.min(landing,1+n)})),top);
        const before = bank(pts.slice(Math.max(0,i-3),i).reverse()), after = bank(pts.slice(j+1,j+4));
        if (!before.length || !after.length) continue;
        lay([...before.reverse(),...pts.slice(i,j+1).map(p => ({x:p.x,z:p.z,y:top})),...after]);
      }
    }
    // Reeds around the pools' edges, clear of the boardwalks.
    const reeds: Outdoors['reeds'] = [], grow = random(featureSeed ^ 0x1b873593);
    for (const p of pools) {
      if (p.depth > 1) continue;
      for (let i=0;i<p.r*4;i++) {
        const a = grow()*Math.PI*2, d = p.r+(grow()-0.65)*1.6, x = p.x+Math.cos(a)*d, z = p.z+Math.sin(a)*d;
        if (boardwalks.some(b => Math.abs(b.x-x) < 1.2 && Math.abs(b.z-z) < 1.2) || pools.some(q => q.depth > 1 && Math.hypot(q.x-x,q.z-z) < q.r+0.5)) continue;
        reeds.push({x,y:height(x,z),z,h:0.8+grow()*0.9});
      }
    }
    const world: Outdoors = {
      kind,boardwalks,reeds,quarry:quarry && {...quarry,levels:[rimLevel-4,rimLevel-8,rimLevel-12]},toxic,seed,geometry:g,size:outdoorSize,ground,arrival:{x:ax,y:arrivalLevel,z:az},spawns,building,doors,door,exit:doors[0].exit,rocks,bell,
      ringing:{x:bell.x,y:0,z:bell.z+1.5,yaw:0},
      river,fords:river.fords.map(f => ({x:f.x,y:height(f.x,f.z),z:f.z})),ruins,wrecks,trails:trails.map(t => t ?? []),marks,water,bridges,
    };
    const reached = walkable(g,spawns[0],[],0.5);
    if (scale === 0 || (trails.every(Boolean) && [...doors.map(d => d.exit),world.ringing,spawns[1]].every(p => reached(p)))) {
      if (outdoorCache.size > 4) outdoorCache.clear();
      outdoorCache.set(cacheKey,world);
      return world;
    }
  }
}
// A quarry: one pit 40 m across, terraced in three steps of 4 m (rings 5 m
// wide down to a floor 20 m across), out on a side of the building with no
// door and away from the arrival; a ramp descends along each wall, the three in turn around
// the pit, so whoever drops down a ledge can always walk back up. Low spoil
// heaps of loose rock stand about the open ground.
export interface Ramp { radius: number; start: number; span: number; turn: number }
// A drum lies on its side `along` x or z, or stands; a leaking one points
// `toward` its spill (a yaw).
export interface Toxic { drums: {x: number; y: number; z: number; lying: boolean; along: 'x' | 'z'; leak: boolean; toward: number}[]; spills: {x: number; y: number; z: number; r: number}[] }
export interface Quarry { x: number; z: number; radii: number[]; ramps: Ramp[]; heaps: {x: number; z: number; r: number; h: number}[] }
const faceVector: Record<Face,[number,number]> = {east:[1,0],west:[-1,0],south:[0,1],north:[0,-1]};
function quarryPlan(next: () => number, doors: Doorway[], arrival: {x: number; z: number}, building: Outdoors['building']): Quarry {
  const used = new Set(doors.map(d => d.face)), al = Math.hypot(arrival.x,arrival.z) || 1;
  const face = (['south','east','west','north'] as Face[]).filter(f => !used.has(f))
    .sort((a,b) => (faceVector[a][0]*arrival.x+faceVector[a][1]*arrival.z)/al-(faceVector[b][0]*arrival.x+faceVector[b][1]*arrival.z)/al)[0] ?? 'north';
  const [fx,fz] = faceVector[face], side = (next()-0.5)*12;
  // 42 m out, its rim 2 m beyond the plot and well inside the map's walls.
  const x = fx*42-fz*side*0.5, z = fz*42+fx*side*0.5, radii = [20,15,10];
  const turn = next() < 0.5 ? 1 : -1, ramps: Ramp[] = [];
  // The first ramp starts on the building's side, where the crew comes from.
  let start = Math.atan2(-z,-x)+(next()-0.5)*1.2;
  for (const radius of radii) { const span = 16/(radius-2); ramps.push({radius,start,span,turn}); start += turn*(span+0.3); }
  const heaps: Quarry['heaps'] = [];
  for (let t=0;t<200 && heaps.length<4;t++) {
    const hx = (next()-0.5)*110, hz = (next()-0.5)*110, r = 6+next()*4;
    if (Math.hypot(hx-x,hz-z) < radii[0]+r+6 || Math.hypot(hx-arrival.x,hz-arrival.z) < r+20) continue;
    if (Math.abs(hx-building.x) < building.w/2+r+14 && Math.abs(hz-building.z-2) < building.d/2+r+15) continue;
    if (heaps.some(o => Math.hypot(o.x-hx,o.z-hz) < o.r+r+6)) continue;
    heaps.push({x:hx,z:hz,r,h:r*0.3});
  }
  return {x,z,radii,ramps,heaps};
}
// Whether (x, z) is on a ramp's band, and how far down it (0 at its top).
function rampAt(q: Quarry, r: Ramp, x: number, z: number) {
  const d = Math.hypot(x-q.x,z-q.z);
  if (d < r.radius-4 || d > r.radius+0.4) return;
  let rel = (Math.atan2(z-q.z,x-q.x)-r.start)*r.turn;
  rel = ((rel % (Math.PI*2))+Math.PI*2) % (Math.PI*2);
  return rel <= r.span ? rel/r.span : undefined;
}
const onRamp = (q: Quarry, r: Ramp, x: number, z: number) => rampAt(q,r,x,z) !== undefined;
// The ground over a quarry: the open ground, raised in its spoil heaps,
// stepped down its pit's terraces, with the ramps along the walls.
// The first ramp comes down from the open ground at the rim where it starts
// (`openAt`, just outside), one even slope, level across. Each ramp begins
// with a level landing (its first `landing` of the way), and around the
// first's the rim is levelled to it, so the crew walks straight on.
const landing = 0.15;
function quarryHeight(q: Quarry, x: number, z: number, open: number, rim: number, openAt: (x: number, z: number) => number) {
  let y = open;
  for (const hp of q.heaps) { const d = Math.hypot(x-hp.x,z-hp.z); if (d < hp.r) y += hp.h*smooth(1-d/hp.r); }
  const d = Math.hypot(x-q.x,z-q.z), first = q.ramps[0];
  const head = () => openAt(q.x+Math.cos(first.start)*(q.radii[0]+0.6),q.z+Math.sin(first.start)*(q.radii[0]+0.6));
  if (d > q.radii[0]+0.4) {
    // The rim by the first ramp's landing, levelled to it over a few metres.
    let rel = (Math.atan2(z-q.z,x-q.x)-first.start)*first.turn;
    rel = ((rel % (Math.PI*2))+Math.PI*3) % (Math.PI*2)-Math.PI;
    const along = Math.max(0,-0.12-rel,rel-first.span*landing)*d, out = d-q.radii[0]-0.4, reach = Math.max(along,out-1.5);
    if (reach < 3.5) y += (head()-y)*(1-smooth(reach/3.5));
    return y;
  }
  const levels = [rim-4,rim-8,rim-12], uppers = [y,levels[0],levels[1]];
  for (let j=0;j<3;j++) if (d < q.radii[j]+0.4) y = uppers[j]+(levels[j]-uppers[j])*smooth((q.radii[j]+0.4-d)/0.8);
  q.ramps.forEach((r,j) => {
    const u = rampAt(q,r,x,z);
    if (u === undefined) return;
    const top = j ? uppers[j] : head();
    y = Math.max(y,top+(levels[j]-top)*Math.max(0,(u-landing)/(1-landing)));
  });
  return y;
}
// A marsh's pools: clusters of overlapping circles of still water, clear of
// the building's plot, the arrival, the river and each other, each cluster at
// the level of the lowest ground under it. About a third hold a sinkhole.
// Each cluster without a sinkhole gets straight crossings for a boardwalk,
// along x and along z through its middle (the preferred first), from a metre
// outside its water on one side to a metre outside on the other.
interface Crossing { cluster: number; x: number; z: number; dx: number; dz: number; length: number }
function marshPools(next: () => number, ground: Heightfield, half: number, building: Outdoors['building'], arrival: {x: number; z: number}, river: River): {pools: Pool[]; crossings: Crossing[]} {
  const pools: Pool[] = [], centres: {x: number; z: number; r: number}[] = [], crossings: Crossing[] = [];
  for (let t=0;t<300 && centres.length<16;t++) {
    // Well inside the map's walls, boardwalks and all.
    const cx = (next()-0.5)*(half*2-60), cz = (next()-0.5)*(half*2-60);
    if (Math.abs(cx-building.x) < building.w/2+22 && Math.abs(cz-building.z-2) < building.d/2+23) continue;
    if (Math.hypot(cx-arrival.x,cz-arrival.z) < 26 || river.points.some(p => Math.hypot(p.x-cx,p.z-cz) < 22)) continue;
    if (centres.some(c => Math.hypot(c.x-cx,c.z-cz) < c.r+14)) continue;
    const circles: {x: number; z: number; r: number}[] = [];
    for (let i=0,n=2+Math.floor(next()*4);i<n;i++) circles.push({x:cx+(next()-0.5)*9,z:cz+(next()-0.5)*9,r:2.5+next()*3.5});
    let low = Infinity;
    for (const c of circles) for (let a=0;a<8;a++) low = Math.min(low,fieldHeight(ground,c.x+Math.cos(a)*c.r*0.7,c.z+Math.sin(a)*c.r*0.7),fieldHeight(ground,c.x,c.z));
    const level = Math.round((low-0.05)*100)/100, depth = 0.3+next()*0.35;
    for (const c of circles) pools.push({...c,level,depth});
    if (next() < 0.35) { const c = circles[0]; pools.push({x:c.x,z:c.z,r:1.3+next()*0.9,level,depth:2.6}); }
    else {
      // Both ways across, the preferred first; the boardwalk takes the first
      // that comes ashore on low banks at both ends.
      const first = next() < 0.5;
      for (const alongX of [first,!first]) {
        const wet = (t: number) => circles.some(c => Math.hypot((alongX ? cx+t : cx)-c.x,(alongX ? cz : cz+t)-c.z) < c.r);
        let lo = 0, hi = 0;
        while (lo > -20 && wet(lo-0.5)) lo -= 0.5;
        while (hi < 20 && wet(hi+0.5)) hi += 0.5;
        // On the boardwalks' half-metre grid, so its water is where its decks are.
        const grid = (v: number) => Math.round(v*2)/2;
        if (wet(0) && hi-lo >= 3) crossings.push({cluster:centres.length,x:grid(alongX ? cx+lo-1 : cx),z:grid(alongX ? cz : cz+lo-1),dx:alongX ? 1 : 0,dz:alongX ? 0 : 1,length:hi-lo+2});
      }
    }
    centres.push({x:cx,z:cz,r:12});
  }
  return {pools,crossings};
}
// Carve the pools into the ground: each bed eases down from its edge, a
// sinkhole's steeply; just outside, the ground is kept a little over the
// water, so it never spills.
function carvePools(ground: Heightfield, pools: Pool[]) {
  const {n,h} = ground;
  for (let j=0;j<n*n;j++) {
    const x = ground.x0+(j % n), z = ground.z0+Math.floor(j/n);
    let bed = Infinity, rim = -Infinity, inside = false;
    for (const p of pools) {
      const d = Math.hypot(x-p.x,z-p.z);
      if (d < p.r) { inside = true; bed = Math.min(bed,p.level-p.depth*smooth((p.r-d)/(p.depth > 1 ? 0.7 : 1.6))-0.04); }
      else if (d < p.r+1.5) rim = Math.max(rim,p.level+0.04);
    }
    if (inside) h[j] = Math.round(Math.min(h[j],bed)*100)/100;
    else if (rim > h[j]) h[j] = Math.round(rim*100)/100;
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
