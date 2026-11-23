// Rooms snap to a 4 m grid with two 4 m storeys. Local coordinates put a cell
// centre at the origin, and each socket sits at the middle of a cell edge. A
// positive rise climbs from north to south, or from west to east along x.
export const cell = 4, storey = 4, doorWidth = 2.4, doorHeight = 2.5;
export type Side = 'north' | 'east' | 'south' | 'west';
export interface Point3 { x:number; y:number; z:number }
export interface Patch { x:number; z:number; w:number; d:number }
export interface Surface extends Patch { y:number; rise?:number; along?:'x'; stairs?:boolean; catwalk?:boolean }
export interface Socket { name:string; side:Side; x:number; z:number; y:number }
export type PropKind = 'machine' | 'shelf' | 'tank' | 'locker' | 'crate' | 'console' | 'pump' | 'chiller' |
  'switchboard' | 'relay' | 'generator' | 'filter' | 'bench' | 'desk' | 'pipe' | 'terminal' | 'rock';
export interface Prop extends Patch { kind:PropKind; h:number; y?:number }
export interface RoomTemplate {
  name:string;
  height:number;
  footprint:Patch[];
  surfaces:Surface[];
  sockets:Socket[];
  props?:Prop[];
  pad?:Point3;
  loot?:boolean;
}

const patch = (x:number,z:number,w:number,d:number):Patch => ({x,z,w,d});
const prop = (kind:PropKind,x:number,z:number,w:number,d:number,h:number,y?:number):Prop =>
  y === undefined ? {kind,x,z,w,d,h} : {kind,x,z,w,d,h,y};
const sides:Side[] = ['north','east','south','west'];

// A rectangular block of cells with a doorway available on every outer cell edge.
function block(name:string,cols:number,rows:number,extra:Partial<RoomTemplate> = {},height = 3.6):RoomTemplate {
  const base = patch((cols-1)*cell/2,(rows-1)*cell/2,cols*cell,rows*cell);
  const sockets:Socket[] = [];
  for (let i=0;i<cols;i++) {
    sockets.push({name:'north'+i,side:'north',x:i*cell,z:-cell/2,y:0});
    sockets.push({name:'south'+i,side:'south',x:i*cell,z:rows*cell-cell/2,y:0});
  }
  for (let j=0;j<rows;j++) {
    sockets.push({name:'west'+j,side:'west',x:-cell/2,z:j*cell,y:0});
    sockets.push({name:'east'+j,side:'east',x:cols*cell-cell/2,z:j*cell,y:0});
  }
  return {name,height,footprint:[base],surfaces:[{...base,y:0}],sockets,pad:{x:base.x,y:0,z:base.z},...extra};
}

function corridor(...parts:Patch[]):(open:Side[]) => RoomTemplate {
  return open => ({name:'Corridor',height:3.2,footprint:parts,surfaces:parts.map(p=>({...p,y:0})),
    sockets:open.map(side => {
      const [x,z] = {north:[0,-2],east:[2,0],south:[0,2],west:[-2,0]}[side];
      return {name:side,side,x,z,y:0};
    }),pad:{x:0,y:0,z:0}});
}
const arm = (side:Side) => ({north:patch(0,-1.6,2.4,0.8),east:patch(1.6,0,0.8,2.4),south:patch(0,1.6,2.4,0.8),west:patch(-1.6,0,0.8,2.4)})[side];
const hallFloor = patch(0,0,12,12);

const templates = {
  // Intake is base: the cargo lift pad sits in front of the contract terminal
  // on the west wall, between the two west doorways.
  intake:block('Intake',3,2,{pad:{x:0.5,y:0,z:2},sockets:block('',3,2).sockets.filter(s=>s.side!=='south'),
    props:[prop('locker',0,5.6,2.4,0.6,2),prop('locker',8,5.6,2.4,0.6,2),prop('terminal',-1.65,2,0.6,1.4,1.3)]}),
  relay:block('Relay station',2,2,{props:[prop('relay',2,-1.3,1.4,1.2,1.4)]}),
  switchboard:block('Switchboard',2,2,{props:[prop('switchboard',2,-1.35,1.4,1.1,2)]}),
  chiller:block('Chiller hall',2,1,{props:[prop('chiller',2,-1.55,1.4,0.8,1.7),prop('chiller',2,1.55,1.4,0.8,1.7)]}),
  pump:block('Pump hall',3,2,{props:[2,6].flatMap(x=>[prop('pump',x,-1.3,1.4,1.2,1.3),prop('pump',x,5.3,1.4,1.2,1.3)])}),
  stores:block('Parts store',2,2,{loot:true,props:[
    prop('shelf',2,-1.5,1.4,0.8,2),prop('shelf',2,5.5,1.4,0.8,2),prop('shelf',-1.5,2,0.8,1.4,2),prop('shelf',5.5,2,0.8,1.4,2),
  ]}),
  closet:block('Loot closet',1,1,{loot:true,props:[prop('shelf',1.5,1.5,0.8,0.8,1.4)]},2.8),
  boiler:block('Boiler room',2,2,{pad:{x:2,y:0,z:-0.5},props:[prop('tank',2,2,2,2,2.6),prop('pipe',2,-1.75,8,0.3,0.3,2.75)]}),
  lockers:block('Locker room',2,1,{loot:true,props:[prop('locker',2,-1.65,1.4,0.6,2),prop('locker',2,1.65,1.4,0.6,2)]}),
  control:block('Control room',2,1,{props:[prop('console',2,1.6,1.4,0.7,1),prop('console',2,-1.6,1.4,0.7,1.3)]}),
  coldstore:block('Cold store',1,2,{loot:true,props:[prop('crate',-1.6,2,0.7,1.4,1),prop('crate',1.6,2,0.7,1.4,1.3)]}),
  filters:block('Filter bank',2,2,{props:[prop('filter',2,0,1,1.6,2.4),prop('filter',2,4,1,1.6,2.4)]}),
  generator:block('Generator room',3,2,{pad:{x:4,y:0,z:-0.5},props:[prop('generator',4,2,4,2,2.4)]}),
  gallery:block('Pipe gallery',3,1,{props:[prop('pipe',4,-1.7,12,0.4,0.4,2.65),prop('pipe',4,1.7,12,0.4,0.4,2.65)]}),
  office:block("Foreman's office",1,1,{loot:true,props:[prop('desk',1.55,1.55,0.7,0.7,0.8),prop('shelf',-1.6,-1.6,0.6,0.6,1.3)]}),
  workshop:block('Workshop',2,2,{loot:true,props:[prop('bench',2,-1.5,1.4,0.8,0.95),prop('bench',-1.5,2,0.8,1.4,0.95),prop('bench',5.5,2,0.8,1.4,0.95)]}),
  // The bent tunnel turns north at its east end and runs 16 m beneath whatever sits above it.
  tunnel:{name:'Service tunnel',height:2.9,footprint:[patch(4,0,12,4),patch(8,-10,4,16)],
    surfaces:[{...patch(4,0,12,4),y:0},{...patch(8,-10,4,16),y:0}],pad:{x:8,y:0,z:-8},sockets:[
      {name:'mouth',side:'west',x:-2,z:0,y:0},{name:'corner',side:'east',x:10,z:0,y:0},
      {name:'far',side:'north',x:8,z:-18,y:0},{name:'side',side:'west',x:6,z:-16,y:0},
    ]},
  // A 3 m gallery runs along the north wall at the upper storey. The ramp drops
  // from its inner edge to the south wall, and the hall floor surrounds the ramp.
  hall:{name:'Machinery hall',height:7.6,footprint:[hallFloor],pad:{x:4,y:0,z:0},surfaces:[
    ...[patch(-3,0,6,12),patch(4,0,4,12),patch(1,-4.5,2,3),patch(1,5,2,2)].map(f=>({...f,y:0})),
    {...patch(0,-4.5,12,3),y:4,catwalk:true},{...patch(1,0.5,2,7),y:4,rise:-4},
  ],props:[-3,0,3].map(z=>prop('machine',-3,z,2.6,1.8,2.2)),sockets:[
    {name:'gallery-west',side:'west',x:-6,z:-4,y:4},{name:'gallery-east',side:'east',x:6,z:-4,y:4},
    ...[-4,0,4].map(x=>({name:'gallery-north'+x,side:'north' as Side,x,z:-6,y:4})),
    ...[-4,0,4].map(z=>({name:'floor-east'+z,side:'east' as Side,x:6,z,y:0})),
    {name:'floor-south0',side:'south',x:0,z:6,y:0},{name:'floor-south4',side:'south',x:4,z:6,y:0},
  ]},
  // Upper landing at the origin cell, eight metres of stairs, then the lower landing.
  stairwell:{name:'Stairwell',height:7.6,footprint:[patch(0,6,4,16)],pad:{x:0,y:0,z:12},surfaces:[
    {...patch(0,0,4,4),y:4},{...patch(0,6,4,8),y:4,rise:-4,stairs:true},{...patch(0,12,4,4),y:0},
  ],sockets:[
    {name:'upper-north',side:'north',x:0,z:-2,y:4},{name:'upper-east',side:'east',x:2,z:0,y:4},{name:'upper-west',side:'west',x:-2,z:0,y:4},
    {name:'lower-south',side:'south',x:0,z:14,y:0},{name:'lower-east',side:'east',x:2,z:12,y:0},{name:'lower-west',side:'west',x:-2,z:12,y:0},
  ]},
  straight:corridor(patch(0,0,2.4,4))(['north','south']),
  corner:corridor(patch(0,-0.4,2.4,3.2),arm('east'))(['north','east']),
  tee:corridor(patch(0,0,2.4,4),arm('east'))(['north','east','south']),
  cross:corridor(patch(0,0,2.4,4),arm('east'),arm('west'))(['north','east','south','west']),
} satisfies Record<string,RoomTemplate>;

export type TemplateKind = keyof typeof templates;
export const roomTemplates: Record<TemplateKind,RoomTemplate> = templates;
export const corridorKinds = ['straight','corner','tee','cross'] as const;
// Destinations a seed can draw from, each at most once. Connectors may repeat.
export const destinationPool:TemplateKind[] = ['relay','switchboard','chiller','pump','stores','closet','boiler','lockers','control',
  'coldstore','filters','generator','gallery','office','workshop','tunnel','hall'];
export const isCorridor = (kind:TemplateKind) => (corridorKinds as readonly string[]).includes(kind);

export interface Placement { id:string; template:TemplateKind; x:number; y:number; z:number; turn:number }
export interface TemplateLink { a:string; from:string; b:string; to:string }

const same = (a:number,b:number) => Math.abs(a-b) < 1e-6;
export function turnSide(side:Side,turn:number):Side { return sides[(sides.indexOf(side)+turn)%4]; }
export const opposite = (side:Side) => turnSide(side,2);
export const outward = (side:Side) => ({north:[0,-1],east:[1,0],south:[0,1],west:[-1,0]})[side] as [number,number];
export function turnPoint<T extends {x:number;z:number}>(p:T,turn:number):T {
  let {x,z} = p;
  for (let i=0;i<turn;i++) [x,z] = [-z,x];
  return {...p,x:x+0,z:z+0};
}
function turnPatch<T extends Patch>(p:T,turn:number):T {
  const q = turnPoint(p,turn);
  return turn % 2 ? {...q,w:p.d,d:p.w} : q;
}
// North turns to east, so a climb that starts at the north edge now starts at
// the east edge: the base height moves to the far end and the rise flips.
function turnSurface(s:Surface,turn:number):Surface {
  let {y,rise,along} = s;
  if (rise !== undefined) for (let i=0;i<turn;i++) {
    if (along) along = undefined; else { along = 'x'; y += rise!; rise = -rise!; }
  }
  const t = turnPatch(s,turn);
  delete t.along;
  return {...t,y,...(rise === undefined ? {} : {rise:rise+0}),...(along ? {along} : {})};
}

const rotated = new Map<string,RoomTemplate>();
export function orient(kind:TemplateKind,turn:number):RoomTemplate {
  const key = kind+'/'+turn;
  let t = rotated.get(key);
  if (!t) {
    const base:RoomTemplate = roomTemplates[kind];
    t = {...base,footprint:base.footprint.map(p=>turnPatch(p,turn)),surfaces:base.surfaces.map(s=>turnSurface(s,turn)),
      sockets:base.sockets.map(s=>({...turnPoint(s,turn),side:turnSide(s.side,turn)})),
      props:base.props?.map(p=>turnPatch(p,turn)),pad:base.pad && turnPoint(base.pad,turn)};
    rotated.set(key,t);
  }
  return t;
}

export function socketAt(room:Placement,name:string) {
  const s = orient(room.template,room.turn).sockets.find(socket=>socket.name===name);
  return s && {...s,x:room.x+s.x,y:room.y+s.y,z:room.z+s.z};
}

export interface Solid extends Patch { y:number; h:number }
export interface PlacedSurface extends Surface { room:string }
export interface Opening extends Point3 { side:Side; a:string; b:string; index:number }
export interface RoomSolid extends Solid { room:string }
/** A wall face; `inward` is the sign, along the thin axis, that points into its room. */
export interface RoomWall extends RoomSolid { inward:number }
export interface TemplateGeometry {
  surfaces:PlacedSurface[]; walls:RoomWall[]; roofs:RoomSolid[]; rails:RoomSolid[];
  props:(Solid & {kind:PropKind; room:string})[]; doors:(Solid & {id:string})[]; openings:Opening[];
}

type Interval = [number,number];
// Remaining spans after removing holes in a wall or shared tile boundary.
function subtract(span:Interval, holes:Interval[]):Interval[] {
  let pieces = [span];
  for (const [lo,hi] of holes) {
    pieces = pieces.flatMap(([a,b]):Interval[] => hi<=a || lo>=b ? [[a,b]] :
      [[a,Math.min(lo,b)],[Math.max(hi,a),b]].filter(([u,v])=>v-u>0.001) as Interval[]);
  }
  return pieces;
}

// Links may name a door id to fit a closable bulkhead in that opening.
export function assembleTemplates(rooms:Placement[],links:(TemplateLink & {door?:string})[],openAll = false):TemplateGeometry {
  const g:TemplateGeometry = {surfaces:[],walls:[],roofs:[],rails:[],props:[],doors:[],openings:[]};
  const open = new Set<string>();
  const byId = new Map(rooms.map(r=>[r.id,r]));
  function endpoint(id:string,name:string) {
    const r = byId.get(id);
    const socket = r && socketAt(r,name);
    if (!socket || open.has(id+'/'+name)) throw Error('Invalid template connection: '+id+'/'+name);
    open.add(id+'/'+name);
    return socket;
  }
  links.forEach((edge,index) => {
    const a = endpoint(edge.a,edge.from), b = endpoint(edge.b,edge.to);
    if (!same(a.x,b.x) || !same(a.z,b.z) || !same(a.y,b.y) || opposite(a.side) !== b.side) throw Error('Misaligned sockets: '+edge.a+'/'+edge.b);
    g.openings.push({x:a.x,y:a.y,z:a.z,side:a.side,a:edge.a,b:edge.b,index});
    if (edge.door) {
      const alongX = a.side === 'north' || a.side === 'south';
      g.doors.push({id:edge.door,x:a.x,z:a.z,y:a.y,h:2.45,w:alongX?doorWidth:0.18,d:alongX?0.18:doorWidth});
    }
  });
  for (const room of rooms) {
    const t = orient(room.template,room.turn);
    for (const s of t.surfaces) g.surfaces.push({...s,x:room.x+s.x,z:room.z+s.z,y:room.y+s.y,room:room.id});
    for (const p of t.props ?? []) g.props.push({kind:p.kind,x:room.x+p.x,z:room.z+p.z,w:p.w,d:p.d,y:room.y+(p.y??0),h:p.h,room:room.id});
    const sockets = t.sockets.filter(s=>openAll || open.has(room.id+'/'+s.name));
    for (const f of t.footprint) {
      g.roofs.push({...f,x:room.x+f.x,z:room.z+f.z,y:room.y+t.height,h:0.12,room:room.id});
      for (const side of sides) {
        const alongX = side==='north' || side==='south';
        const sign = side==='north' || side==='west' ? -1 : 1;
        const axis = alongX?'x':'z', across = alongX?'z':'x';
        const length = alongX?'w':'d', width = alongX?'d':'w';
        const face = f[across]+sign*f[width]/2;
        const neighbors = t.footprint.filter(p=>p!==f && same(p[across]-sign*p[width]/2,face));
        const seams:Interval[] = neighbors.map(p=>[p[axis]-p[length]/2,p[axis]+p[length]/2]);
        const ports = sockets.filter(s=>s.side===side && same(s[across],face));
        // Split horizontally at each sill and lintel, including upper doors.
        const levels = [...new Set([0,t.height,...ports.flatMap(s=>[s.y,Math.min(t.height,s.y+doorHeight)])])].sort((a,b)=>a-b);
        for (let i=1;i<levels.length;i++) {
          const low = levels[i-1], high = levels[i];
          const holes:Interval[] = ports.filter(s=>s.y<=low && s.y+doorHeight>=high).map(s=>[s[axis]-doorWidth/2,s[axis]+doorWidth/2]);
          // Each room's wall sits on its own side of the boundary, so two rooms
          // never draw surfaces in the same place: their different materials
          // would flicker through each other. The inner face stays 6 cm in.
          const inner = face-sign*0.03;
          for (const [a,b] of subtract([f[axis]-f[length]/2,f[axis]+f[length]/2],[...seams,...holes])) {
            const mid = (a+b)/2;
            g.walls.push({x:room.x+(alongX?mid:inner),z:room.z+(alongX?inner:mid),
              w:alongX?b-a:0.06,d:alongX?0.06:b-a,y:room.y+low,h:high-low,room:room.id,inward:-sign});
          }
        }
      }
    }
    // Rails line each gallery edge that overlooks the floor, broken where a ramp leaves it.
    for (const s of t.surfaces.filter(s=>s.catwalk)) {
      for (const side of sides) {
        const alongX = side==='north' || side==='south';
        const sign = side==='north' || side==='west' ? -1 : 1;
        const axis = alongX?'x':'z', across = alongX?'z':'x';
        const length = alongX?'w':'d', width = alongX?'d':'w';
        const face = s[across]+sign*s[width]/2;
        if (t.footprint.some(f=>same(f[across]+sign*f[width]/2,face))) continue;
        const ramps:Interval[] = t.surfaces.filter(r=>r.rise && same(r[across]-sign*r[width]/2,face))
          .map(r=>[r[axis]-r[length]/2,r[axis]+r[length]/2]);
        for (const [a,b] of subtract([s[axis]-s[length]/2,s[axis]+s[length]/2],ramps)) {
          const mid = (a+b)/2;
          g.rails.push({x:room.x+(alongX?mid:face),z:room.z+(alongX?face:mid),w:alongX?b-a:0.07,d:alongX?0.07:b-a,y:room.y+s.y,h:1,room:room.id});
        }
      }
    }
  }
  return g;
}

export function surfaceHeight(s:Surface,x:number,z:number) {
  const t = s.along ? (x-s.x)/s.w+0.5 : (z-s.z)/s.d+0.5;
  return s.y+(s.rise??0)*Math.max(0,Math.min(1,t));
}

// Prefer the reachable surface nearest the current feet. This distinguishes
// the floor under the gallery from the gallery itself at the same x and z.
export function surfaceAt(g:TemplateGeometry,x:number,z:number,feet:number) {
  let best:PlacedSurface|undefined, difference=Infinity;
  for (const s of g.surfaces) {
    // A hair of tolerance closes seams where rotated corridor arms meet.
    if (Math.abs(x-s.x)>s.w/2+1e-6 || Math.abs(z-s.z)>s.d/2+1e-6) continue;
    const delta = Math.abs(surfaceHeight(s,x,z)-feet);
    if (delta<=0.32 && delta<difference) { best=s; difference=delta; }
  }
  return best;
}

// Walls, props and closed bulkheads that a standing operator at these feet can touch.
export function obstaclesAt(g:TemplateGeometry,feet:number,opened:readonly string[] = []):Solid[] {
  return [...g.walls,...g.props,...g.doors.filter(d=>!opened.includes(d.id))].filter(s=>s.y+s.h>feet+0.01 && s.y<feet+1.75);
}
