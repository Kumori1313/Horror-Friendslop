import { surfaceHeight } from './room-templates.ts';
import type { TemplateGeometry } from './room-templates.ts';
import type { Finish } from './materials.ts';

// `axis` 'wedge' draws a wedge turned `angle` about the vertical, rising toward its local +z.
type Box = (color:number,x:number,y:number,z:number,w:number,h:number,d:number,angle?:number,axis?:'x'|'z'|'wedge')=>void;
export type RoomBox = (room:string,finish:Finish,...box:Parameters<Box>)=>void;

// Draw the same shell, openings and walkable surfaces used by the simulation.
// Every box is tagged with the room that owns it so rooms can be culled.
// `accent` gives the colour of the room that owns a prop. `as(finish)` picks
// the surface for the boxes that follow.
export function drawTemplates(g:TemplateGeometry, emit:RoomBox, accent:(room:string)=>number) {
  const deck=0x515e59, steel=0x354641, amber=0xb0975f, dark=0x263331;
  let room='', finish:Finish='matte';
  const box:Box=(...args)=>emit(room,finish,...args);
  const as=(f:Finish)=>{ finish=f; return box; };
  for (const s of g.surfaces) {
    room=s.room;
    const rise=s.rise??0;
    if (s.stairs) {
      const run=s.along ? s.w : s.d;
      const count=Math.ceil(Math.abs(rise)/0.2), depth=run/count;
      for (let i=0;i<count;i++) {
        const offset=-run/2+(i+0.5)*depth;
        const x=s.along ? s.x+offset : s.x, z=s.along ? s.z : s.z+offset, top=surfaceHeight(s,x,z);
        const nose=depth*0.4*Math.sign(rise || 1);
        as('grate')(deck,x,top-0.12,z,s.along?depth:s.w,0.24,s.along?s.d:depth);
        as('paint')(amber,s.along?x+nose:x,top+0.004,s.along?z:z+nose,s.along?0.05:s.w-0.12,0.012,s.along?s.d-0.12:0.05);
      }
    } else if (s.along) {
      as('ramp')(deck,s.x,s.y+rise/2-0.065,s.z,Math.hypot(s.w,rise),0.13,s.d,Math.atan2(rise,s.w),'z');
    } else {
      as(rise ? 'ramp' : s.catwalk ? 'grate' : 'floor')(deck,s.x,s.y+rise/2-0.065,s.z,s.w,0.13,Math.hypot(s.d,rise),-Math.atan2(rise,s.d));
    }
    // Ramps and stairs are solid underneath, as the simulation treats them.
    // The wedge's top runs just under the slope: inside a ramp's slab, or
    // between each tread's top and the bottom of the tread below. It sits
    // 2 mm in from each side, so its sides never lie flush with the slab's.
    if (rise) {
      const run=s.along ? s.w : s.d, slope=Math.abs(rise)/run;
      const sink=s.stairs ? run/Math.ceil(Math.abs(rise)/0.2)/2*slope+0.02 : 0.06;
      const yaw=s.along ? (rise>0 ? Math.PI/2 : -Math.PI/2) : (rise>0 ? 0 : Math.PI);
      // Its tall end also stops 2 mm short of the landing it meets.
      const back=Math.sign(rise)*0.002;
      as('floor')(deck,s.along ? s.x-back : s.x,Math.min(s.y,s.y+rise)-sink+Math.abs(rise)/2,s.along ? s.z : s.z-back,(s.along ? s.d : s.w)-0.004,Math.abs(rise),run-0.004,yaw,'wedge');
    }
  }
  for (const w of g.walls) {
    room=w.room;
    // Walls reach down through the 0.13 m floor slab, so no seam shows beneath
    // them. A wall that stops level with an upper floor stops 1 cm short, inside
    // the slab, so its top never lies flush with the floor and flickers.
    const top = w.y+w.h, flush = g.surfaces.some(s => !s.rise && Math.abs(s.y-top) < 1e-6 && Math.abs(s.x-w.x) < (s.w+w.w)/2 && Math.abs(s.z-w.z) < (s.d+w.d)/2);
    const h = w.h+0.13-(flush ? 0.01 : 0);
    as('wall')(0x748078,w.x,w.y-0.13+h/2,w.z,w.w,h,w.d);
    // The trim stands 1.25 cm proud of the room's face and runs 1.25 cm past
    // each end, so its ends never lie flush with the wall's. It stays on the
    // room's side of the boundary, clear of the neighbour's trim. Only walls
    // that stand on a floor get one, not the wall above a doorway, and only
    // thin walls: not the solid blocks under a pit room's floors.
    const standing = g.surfaces.some(s => s.room === w.room && !s.rise && Math.abs(s.y-w.y) < 1e-6 && Math.abs(s.x-w.x) < (s.w+w.w)/2+0.01 && Math.abs(s.z-w.z) < (s.d+w.d)/2+0.01);
    if (w.h>1.2 && standing && Math.min(w.w,w.d) <= 0.1) {
      const alongX = w.w>w.d, depth = (alongX?w.d:w.w)+0.0125, shift = w.inward*0.00625;
      as('trim')(steel,alongX?w.x:w.x+shift,w.y+0.42,alongX?w.z+shift:w.z,alongX?w.w+0.025:depth,0.1,alongX?depth:w.d+0.025);
    }
  }
  for (const r of g.roofs) {
    room=r.room;
    as('ceiling')(steel,r.x,r.y+r.h/2,r.z,r.w,r.h,r.d);
    if (Math.min(r.w,r.d)>=2) as('matte')(0xe4e7c9,r.x,r.y-0.06,r.z,r.w>=r.d?Math.min(r.w/2,2.6):0.22,0.08,r.w>=r.d?0.22:Math.min(r.d/2,2.6));
  }
  // Open rails keep the view between storeys.
  for (const rail of g.rails) {
    room=rail.room;
    for (const height of [0.48,0.94]) as('paint')(amber,rail.x,rail.y+height,rail.z,rail.w,0.06,rail.d);
    as('metal');
    const length=Math.max(rail.w,rail.d), count=Math.ceil(length/2), alongX=rail.w>rail.d;
    for (let i=0;i<=count;i++) {
      const offset=-length/2+length*i/count;
      box(steel,rail.x+(alongX?offset:0),rail.y+0.45,rail.z+(alongX?0:offset),0.06,0.9,0.06);
    }
  }
  for (const e of g.props) {
    room=e.room;
    const {x,y,z,w,d,h}=e, color=accent(e.room), wide=w>=d, long=Math.max(w,d);
    const across=(offset:number) => wide ? [x+offset,z] : [x,z+offset];
    switch (e.kind) {
      case 'machine':
        as('paint')(0x345859,x,y+h/2,z,w,h,d);
        for (const offset of [-0.32,0,0.32]) as('metal')(steel,x,y+h*0.68,z+offset,w+0.045,h*0.38,0.12);
        as('paint')(amber,x,y+h-0.16,z,w+0.06,0.1,d+0.06);
        break;
      case 'shelf':
      case 'locker': {
        as(e.kind==='locker'?'paint':'metal')(e.kind==='locker'?0x4b5d63:steel,x,y+h/2,z,w,h,d);
        const slots=Math.max(1,Math.round(long/0.5));
        for (let i=0;i<slots;i++) {
          const [px,pz]=across(-long/2+(i+0.5)*long/slots);
          if (e.kind==='shelf') for (const level of [0.35,0.95,1.5].filter(l=>l<h)) as('wood')(0x937c55,px,y+level,pz,wide?long/slots*0.8:w+0.03,0.28,wide?d+0.03:long/slots*0.8);
          else as('matte')(dark,px,y+h*0.55,pz,wide?0.04:w+0.02,h*0.6,wide?d+0.02:0.04);
        }
        break;
      }
      case 'tank':
        as('rust')(0x8a7a6c,x,y+h/2,z,w,h,d);
        for (const level of [0.4,1.3,2.2].filter(l=>l<h)) box(color,x,y+level,z,w+0.06,0.1,d+0.06);
        as('metal')(steel,x,y+h+0.25,z,0.4,0.5,0.4);
        break;
      case 'crate':
        as('wood')(0xa08a6a,x,y+h/2,z,w,h,d);
        box(color,x,y+h+0.01,z,w*0.9,0.02,d*0.9);
        break;
      case 'console':
      case 'relay':
        as('paint')(0x182c2c,x,y+h/2,z,w,h,d);
        box(color,x,y+h-0.08,z,w+0.02,0.12,d+0.02);
        box(0xe4e7c9,x,y+h*0.6,z,w*0.7,0.18,d+0.02);
        break;
      case 'pump':
        as('paint')(0x303e3e,x,y+0.3,z,w,0.6,d);
        for (const offset of [-0.35,0,0.35]) { const [px,pz]=across(offset*long/1.4); as('metal')(0x829b98,px,y+0.6+h/3,pz,0.22,h*0.7,0.22); }
        box(color,x,y+0.62,z,w+0.04,0.06,d+0.04);
        break;
      case 'chiller':
        as('paint')(0x303e3e,x,y+0.4,z,w,0.8,d);
        for (let fin=0;fin<5;fin++) box(color,x,y+0.85+fin*0.17,z,w,0.08,d);
        break;
      case 'switchboard':
        as('paint')(dark,x,y+h/2,z,w,h,d);
        for (const offset of [-0.4,0,0.4]) { const [px,pz]=across(offset); box(color,px,y+h*0.75,pz,0.19,0.13,0.19); as('metal')(0xa4a9a2,px,y+h*0.55,pz,0.08,0.27,0.08); }
        break;
      case 'generator':
        as('paint')(0x3d4a3f,x,y+h/2,z,w,h,d);
        box(color,x,y+h*0.7,z,w+0.04,0.14,d+0.04);
        as('metal')(steel,x,y+h+0.4,z,0.35,0.8,0.35);
        break;
      case 'filter':
        as('paint')(0x6f7c70,x,y+h/2,z,w,h,d);
        for (const level of [0.5,1.2,1.9]) box(color,x,y+level,z,w+0.05,0.08,d+0.05);
        break;
      case 'bench':
      case 'desk':
        as('wood')(0x8a7458,x,y+h-0.03,z,w,0.06,d);
        for (const sx of [-1,1]) for (const sz of [-1,1]) as('metal')(steel,x+sx*(w/2-0.06),y+(h-0.06)/2,z+sz*(d/2-0.06),0.05,h-0.06,0.05);
        box(color,x,y+h+0.06,z,0.22,0.12,0.16);
        break;
      case 'terminal':
        as('paint')(0x182c2c,x,y+h/2,z,w,h,d);
        as('matte')(0x0d1a17,x,y+h+0.45,z,w*0.5,0.9,d);
        box(color,x,y+h-0.06,z,w+0.03,0.1,d+0.03);
        break;
      case 'pipe':
        as('metal')(0x8f9c98,x,y+h/2,z,w,h,d);
        break;
    }
  }
}
