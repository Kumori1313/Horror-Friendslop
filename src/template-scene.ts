import { surfaceHeight } from './room-templates.ts';
import type { TemplateGeometry } from './room-templates.ts';

type Box = (color:number,x:number,y:number,z:number,w:number,h:number,d:number,angle?:number)=>void;

// Draw the same shell, openings and walkable surfaces used by the simulation.
export function drawTemplates(g:TemplateGeometry, box:Box) {
  const deck=0x515e59, steel=0x354641, amber=0xb0975f;
  for (const s of g.surfaces) {
    if (s.stairs) {
      const count=Math.ceil(Math.abs(s.rise??0)/0.2), depth=s.d/count;
      for (let i=0;i<count;i++) {
        const z=s.z-s.d/2+(i+0.5)*depth, top=surfaceHeight(s,z);
        box(deck,s.x,top-0.12,z,s.w,0.24,depth);
        box(amber,s.x,top+0.004,z+depth*0.4,s.w-0.12,0.012,0.05);
      }
    } else {
      const rise=s.rise??0;
      box(deck,s.x,s.y+rise/2-0.065,s.z,s.w,0.13,Math.hypot(s.d,rise),-Math.atan2(rise,s.d));
    }
  }
  for (const w of g.walls) {
    box(0x748078,w.x,w.y+w.h/2,w.z,w.w,w.h,w.d);
    if (w.h>1.2) box(steel,w.x,w.y+0.42,w.z,w.w+0.025,0.1,w.d+0.025);
  }
  for (const r of g.roofs) {
    box(steel,r.x,r.y+r.h/2,r.z,r.w,r.h,r.d);
    box(0xe4e7c9,r.x,r.y-0.06,r.z,Math.min(r.w/2,2.6),0.08,0.22);
  }
  for (const e of g.equipment) {
    if (e.kind==='machine') {
      box(0x345859,e.x,e.y+e.h/2,e.z,e.w,e.h,e.d);
      for (const offset of [-0.32,0,0.32]) {
        box(steel,e.x,e.y+e.h*0.68,e.z+offset,e.w+0.045,e.h*0.38,0.12);
      }
      box(amber,e.x,e.y+e.h-0.16,e.z,e.w+0.06,0.1,e.d+0.06);
    } else {
      for (const side of [-1,1]) box(steel,e.x,e.y+e.h/2,e.z+side*(e.d/2-0.04),e.w,e.h,0.08);
      for (const level of [0.16,0.78,1.36]) box(steel,e.x,e.y+level,e.z,e.w,0.08,e.d);
      for (const side of [-1,1]) box(0x937c55,e.x,e.y+0.42,e.z+side*0.68,e.w*0.9,0.45,0.65);
    }
  }
  // Open rails retain the view into the hall. Break the inner rail at the ramp.
  for (const balcony of g.surfaces.filter(s=>s.catwalk)) {
    const ramp=g.surfaces.find(s=>s.room===balcony.room && s.rise);
    const left=balcony.x-balcony.w/2, right=balcony.x+balcony.w/2;
    for (const side of [-1,1]) {
      const z=balcony.z+side*(balcony.d/2-0.035);
      const spans=side>0 && ramp ? [[left,ramp.x-ramp.w/2],[ramp.x+ramp.w/2,right]] : [[left,right]];
      for (const [start,end] of spans) {
        for (const height of [0.48,0.94]) box(amber,(start+end)/2,balcony.y+height,z,end-start,0.06,0.07);
        const count=Math.ceil((end-start)/2);
        for (let i=0;i<=count;i++) box(steel,start+(end-start)*i/count,balcony.y+0.45,z,0.06,0.9,0.06);
      }
    }
  }
}
