// Dimensions and sockets are local to the room origin. A positive rise runs
// from north to south. Overlays such as catwalks share the shell below them.
export type Side = 'north' | 'south' | 'east' | 'west';
export interface Patch { x:number; z:number; w:number; d:number }
export interface Surface extends Patch { y:number; rise?:number; stairs?:boolean; catwalk?:boolean }
export interface Socket { name:string; side:Side; x:number; z:number; y:number; kind:'door'|'stair' }
export interface RoomTemplate {
  name:string;
  height:number;
  footprint:Patch[];
  surfaces:Surface[];
  sockets:Socket[];
}
const patch = (x:number,z:number,w:number,d:number):Patch => ({x,z,w,d});
const door = (name:string,side:Side,x:number,z:number,y=0):Socket => ({name,side,x,z,y,kind:'door'});

function bay(name:string,w:number,d:number,height=3.6):RoomTemplate {
  const base = patch(0,0,w,d);
  return {name,height,footprint:[base],surfaces:[{...base,y:0}],sockets:[
    door('north','north',0,-d/2),door('south','south',0,d/2),
    door('east','east',w/2,0),door('west','west',-w/2,0),
  ]};
}

export const bayTemplates = {
  intake:bay('Intake',8,8), pump:bay('Pump hall',8,6), stores:bay('Parts store',6,8),
  junction:bay('Service junction',8,8), relay:bay('Relay station',8,8), exit:bay('Exit bay',8,8),
  switchboard:bay('Switchboard',8,8), chiller:bay('Chiller hall',8,6),
};

// The two rectangular runs meet at the elbow; the inside corner is solid.
const tunnelFloor = [patch(0,0,14,4),patch(5,-9.5,4,15)];
const hallFloor = patch(0,0,12,12);
export const roomTemplates = {
  intake:bayTemplates.intake,
  closet:bay('Loot closet',4,4,2.8),
  tunnel:{name:'Service tunnel',height:2.6,footprint:tunnelFloor,surfaces:tunnelFloor.map(f=>({...f,y:0})),
    sockets:[door('mouth','west',-7,0),door('elbow','west',3,-15)]},
  hall:{name:'Machinery hall',height:7.6,footprint:[hallFloor],surfaces:[
    ...[
      patch(-3,0,6,12),patch(4,0,4,12),patch(1,-4,2,4),patch(1,5,2,2),
    ].map(f=>({...f,y:0})),
    {...patch(0,-3,12,2),y:4,catwalk:true}, {...patch(1,1,2,6),y:4,rise:-4},
  ],sockets:[door('gallery','west',-6,-3,4),door('store','east',6,-3,4),door('service','east',6,-3)]},
  stairwell:{name:'Stairwell',height:7.6,footprint:[patch(0,0,4,12)],surfaces:[
    {...patch(0,5,4,2),y:0}, {...patch(0,0,4,8),y:4,rise:-4,stairs:true}, {...patch(0,-5,4,2),y:4},
  ],sockets:[{...door('lower','south',0,6),kind:'stair'},{...door('upper','east',2,-5,4),kind:'stair'}]},
} satisfies Record<string,RoomTemplate>;

export type TemplateKind = keyof typeof roomTemplates;
export interface Placement { id:string; template:TemplateKind; x:number; y:number; z:number }
export interface TemplateLink { a:string; from:string; b:string; to:string }
export const stairwellRooms:Placement[] = [
  {id:'intake',template:'intake',x:0,y:0,z:0}, {id:'stairwell',template:'stairwell',x:0,y:0,z:-10},
  {id:'hall',template:'hall',x:8,y:0,z:-12}, {id:'closet',template:'closet',x:16,y:4,z:-15}, {id:'tunnel',template:'tunnel',x:11,y:0,z:0},
];
export const stairwellLinks:TemplateLink[] = [
  {a:'intake',from:'north',b:'stairwell',to:'lower'},
  {a:'stairwell',from:'upper',b:'hall',to:'gallery'},
  {a:'hall',from:'store',b:'closet',to:'west'},
  {a:'hall',from:'service',b:'tunnel',to:'elbow'},
  {a:'tunnel',from:'mouth',b:'intake',to:'east'},
];

export interface Solid extends Patch { y:number; h:number }
export interface PlacedSurface extends Surface { room:string }
export interface TemplateGeometry {
  surfaces:PlacedSurface[]; walls:Solid[]; roofs:Solid[]; equipment:(Solid & {kind:'machine'|'shelf'})[];
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

export function assembleTemplates(rooms:Placement[],links:TemplateLink[]):TemplateGeometry {
  const g:TemplateGeometry = {surfaces:[],walls:[],roofs:[],equipment:[]};
  const open = new Set<string>();
  const opposite = {north:'south',south:'north',east:'west',west:'east'};
  function endpoint(id:string,name:string) {
    const r=rooms.find(p=>p.id===id);
    const socket=r && roomTemplates[r.template].sockets.find(s=>s.name===name);
    if (!r || !socket || open.has(id+'/'+name)) throw Error('Invalid template connection: '+id+'/'+name);
    open.add(id+'/'+name);
    return {...socket,x:r.x+socket.x,y:r.y+socket.y,z:r.z+socket.z};
  }
  for (const edge of links) {
    const a=endpoint(edge.a,edge.from), b=endpoint(edge.b,edge.to);
    if (a.x!==b.x || a.z!==b.z || a.y!==b.y || opposite[a.side]!==b.side) throw Error('Misaligned sockets: '+edge.a+'/'+edge.b);
  }
  for (const room of rooms) {
    const t:RoomTemplate=roomTemplates[room.template];
    for (const s of t.surfaces) g.surfaces.push({...s,x:room.x+s.x,z:room.z+s.z,y:room.y+s.y,room:room.id});
    const sockets=t.sockets.filter(s=>open.has(room.id+'/'+s.name));
    for (const f of t.footprint) {
      g.roofs.push({...f,x:room.x+f.x,z:room.z+f.z,y:room.y+t.height,h:0.12});
      for (const side of ['north','south','east','west'] as const) {
        const alongX=side==='north' || side==='south';
        const sign=side==='north' || side==='west' ? -1 : 1;
        const axis=alongX?'x':'z', across=alongX?'z':'x';
        const length=alongX?'w':'d', width=alongX?'d':'w';
        const face=f[across]+sign*f[width]/2;
        const neighbors=t.footprint.filter(p=>p!==f && p[across]-sign*p[width]/2===face);
        const seams:Interval[]=neighbors.map(p=>[p[axis]-p[length]/2,p[axis]+p[length]/2]);
        const ports=sockets.filter(s=>s.side===side && s[across]===face);
        // Split horizontally at each sill and lintel, including upper doors.
        const levels=[...new Set([0,t.height,...ports.flatMap(s=>[s.y,Math.min(t.height,s.y+2.5)])])].sort((a,b)=>a-b);
        for (let i=1;i<levels.length;i++) {
          const low=levels[i-1], high=levels[i];
          const holes:Interval[]=ports.filter(s=>s.y<=low && s.y+2.5>=high).map(s=>[s[axis]-1.2,s[axis]+1.2]);
          for (const [a,b] of subtract([f[axis]-f[length]/2,f[axis]+f[length]/2],[...seams,...holes])) {
            const mid=(a+b)/2;
            g.walls.push({x:room.x+(alongX?mid:face),z:room.z+(alongX?face:mid),
              w:alongX?b-a:0.12,d:alongX?0.12:b-a,y:room.y+low,h:high-low});
          }
        }
      }
    }
    if (room.template==='hall' || room.template==='closet') {
      const hall=room.template==='hall';
      for (const offset of (hall?[-3,0,3]:[0])) g.equipment.push({
        kind:hall?'machine':'shelf',x:room.x+(hall?-3:1.45),z:room.z+offset,w:hall?2.6:0.7,d:hall?1.8:2.7,y:room.y,h:hall?2.2:1.4,
      });
    }
  }
  return g;
}

export function surfaceHeight(s:Surface,z:number) {
  return s.y+(s.rise??0)*Math.max(0,Math.min(1,(z-s.z)/s.d+0.5));
}

// Prefer the reachable surface nearest the current feet. This distinguishes
// the floor under the gallery from the gallery itself at the same x and z.
export function surfaceAt(g:TemplateGeometry,x:number,z:number,feet:number) {
  let best:PlacedSurface|undefined, difference=Infinity;
  for (const s of g.surfaces) {
    if (Math.abs(x-s.x)>s.w/2 || Math.abs(z-s.z)>s.d/2) continue;
    const delta=Math.abs(surfaceHeight(s,z)-feet);
    if (delta<=0.32 && delta<difference) { best=s; difference=delta; }
  }
  return best;
}

export function obstaclesAt(g:TemplateGeometry,feet:number) {
  return [...g.walls,...g.equipment].filter(s=>s.y+s.h>feet+0.01 && s.y<feet+1.75);
}
