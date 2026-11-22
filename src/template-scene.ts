import { surfaceHeight } from './room-templates.ts';
import type { TemplateGeometry } from './room-templates.ts';

type Box = (color:number,x:number,y:number,z:number,w:number,h:number,d:number,angle?:number,axis?:'x'|'z')=>void;

// Draw the same shell, openings and walkable surfaces used by the simulation.
// `accent` gives the colour of the room that owns a prop.
export function drawTemplates(g:TemplateGeometry, box:Box, accent:(room:string)=>number) {
  const deck=0x515e59, steel=0x354641, amber=0xb0975f, dark=0x263331;
  for (const s of g.surfaces) {
    const rise=s.rise??0;
    if (s.stairs) {
      const run=s.along ? s.w : s.d;
      const count=Math.ceil(Math.abs(rise)/0.2), depth=run/count;
      for (let i=0;i<count;i++) {
        const offset=-run/2+(i+0.5)*depth;
        const x=s.along ? s.x+offset : s.x, z=s.along ? s.z : s.z+offset, top=surfaceHeight(s,x,z);
        const nose=depth*0.4*Math.sign(rise || 1);
        box(deck,x,top-0.12,z,s.along?depth:s.w,0.24,s.along?s.d:depth);
        box(amber,s.along?x+nose:x,top+0.004,s.along?z:z+nose,s.along?0.05:s.w-0.12,0.012,s.along?s.d-0.12:0.05);
      }
    } else if (s.along) {
      box(deck,s.x,s.y+rise/2-0.065,s.z,Math.hypot(s.w,rise),0.13,s.d,Math.atan2(rise,s.w),'z');
    } else {
      box(deck,s.x,s.y+rise/2-0.065,s.z,s.w,0.13,Math.hypot(s.d,rise),-Math.atan2(rise,s.d));
    }
  }
  for (const w of g.walls) {
    box(0x748078,w.x,w.y+w.h/2,w.z,w.w,w.h,w.d);
    if (w.h>1.2) box(steel,w.x,w.y+0.42,w.z,w.w+0.025,0.1,w.d+0.025);
  }
  for (const r of g.roofs) {
    box(steel,r.x,r.y+r.h/2,r.z,r.w,r.h,r.d);
    if (Math.min(r.w,r.d)>=2) box(0xe4e7c9,r.x,r.y-0.06,r.z,r.w>=r.d?Math.min(r.w/2,2.6):0.22,0.08,r.w>=r.d?0.22:Math.min(r.d/2,2.6));
  }
  // Open rails keep the view between storeys.
  for (const rail of g.rails) {
    for (const height of [0.48,0.94]) box(amber,rail.x,rail.y+height,rail.z,rail.w,0.06,rail.d);
    const length=Math.max(rail.w,rail.d), count=Math.ceil(length/2), alongX=rail.w>rail.d;
    for (let i=0;i<=count;i++) {
      const offset=-length/2+length*i/count;
      box(steel,rail.x+(alongX?offset:0),rail.y+0.45,rail.z+(alongX?0:offset),0.06,0.9,0.06);
    }
  }
  for (const e of g.props) {
    const {x,y,z,w,d,h}=e, color=accent(e.room), wide=w>=d, long=Math.max(w,d);
    const across=(offset:number) => wide ? [x+offset,z] : [x,z+offset];
    switch (e.kind) {
      case 'machine':
        box(0x345859,x,y+h/2,z,w,h,d);
        for (const offset of [-0.32,0,0.32]) box(steel,x,y+h*0.68,z+offset,w+0.045,h*0.38,0.12);
        box(amber,x,y+h-0.16,z,w+0.06,0.1,d+0.06);
        break;
      case 'shelf':
      case 'locker': {
        box(e.kind==='locker'?0x4b5d63:steel,x,y+h/2,z,w,h,d);
        const slots=Math.max(1,Math.round(long/0.5));
        for (let i=0;i<slots;i++) {
          const [px,pz]=across(-long/2+(i+0.5)*long/slots);
          if (e.kind==='shelf') for (const level of [0.35,0.95,1.5].filter(l=>l<h)) box(0x937c55,px,y+level,pz,wide?long/slots*0.8:w+0.03,0.28,wide?d+0.03:long/slots*0.8);
          else box(dark,px,y+h*0.55,pz,wide?0.04:w+0.02,h*0.6,wide?d+0.02:0.04);
        }
        break;
      }
      case 'tank':
        box(0x5e4a3e,x,y+h/2,z,w,h,d);
        for (const level of [0.4,1.3,2.2].filter(l=>l<h)) box(color,x,y+level,z,w+0.06,0.1,d+0.06);
        box(steel,x,y+h+0.25,z,0.4,0.5,0.4);
        break;
      case 'crate':
        box(0x806c50,x,y+h/2,z,w,h,d);
        box(color,x,y+h+0.01,z,w*0.9,0.02,d*0.9);
        break;
      case 'console':
      case 'relay':
        box(0x182c2c,x,y+h/2,z,w,h,d);
        box(color,x,y+h-0.08,z,w+0.02,0.12,d+0.02);
        box(0xe4e7c9,x,y+h*0.6,z,w*0.7,0.18,d+0.02);
        break;
      case 'pump':
        box(0x303e3e,x,y+0.3,z,w,0.6,d);
        for (const offset of [-0.35,0,0.35]) { const [px,pz]=across(offset*long/1.4); box(0x829b98,px,y+0.6+h/3,pz,0.22,h*0.7,0.22); }
        box(color,x,y+0.62,z,w+0.04,0.06,d+0.04);
        break;
      case 'chiller':
        box(0x303e3e,x,y+0.4,z,w,0.8,d);
        for (let fin=0;fin<5;fin++) box(color,x,y+0.85+fin*0.17,z,w,0.08,d);
        break;
      case 'switchboard':
        box(dark,x,y+h/2,z,w,h,d);
        for (const offset of [-0.4,0,0.4]) { const [px,pz]=across(offset); box(color,px,y+h*0.75,pz,0.19,0.13,0.19); box(0xa4a9a2,px,y+h*0.55,pz,0.08,0.27,0.08); }
        break;
      case 'generator':
        box(0x3d4a3f,x,y+h/2,z,w,h,d);
        box(color,x,y+h*0.7,z,w+0.04,0.14,d+0.04);
        box(steel,x,y+h+0.4,z,0.35,0.8,0.35);
        break;
      case 'filter':
        box(0x6f7c70,x,y+h/2,z,w,h,d);
        for (const level of [0.5,1.2,1.9]) box(color,x,y+level,z,w+0.05,0.08,d+0.05);
        break;
      case 'bench':
      case 'desk':
        box(0x6b5a44,x,y+h-0.03,z,w,0.06,d);
        for (const sx of [-1,1]) for (const sz of [-1,1]) box(steel,x+sx*(w/2-0.06),y+(h-0.06)/2,z+sz*(d/2-0.06),0.05,h-0.06,0.05);
        box(color,x,y+h+0.06,z,0.22,0.12,0.16);
        break;
      case 'pipe':
        box(0x5b6b66,x,y+h/2,z,w,h,d);
        break;
    }
  }
}
