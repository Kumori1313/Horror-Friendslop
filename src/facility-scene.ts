import * as T from 'three';
import { footprint, geometryFor, opening, roomLabel } from './layout.ts';
import type { Layout, Kind, Rect } from './layout.ts';

const colors: Record<Kind,number> = {
  intake:0xe0b258, pump:0x648d92, stores:0xb78155, junction:0x93a599, relay:0xe6a840, exit:0x70cfaf, switchboard:0xe0894e, chiller:0x57b9da,
};

// Group repeated industrial geometry into instanced draws for phone GPUs.
export function buildFacility(layout: Layout, surface: T.Texture) {
  const root = new T.Group();
  const geometry = geometryFor(layout);
  const cube = new T.BoxGeometry();
  const batches = new Map<number,T.Matrix4[]>();
  const transform = new T.Object3D();
  function box(color: number,x: number,y: number,z: number,w: number,h: number,d: number) {
    transform.position.set(x,y,z); transform.scale.set(w,h,d); transform.updateMatrix();
    const bucket = batches.get(color) ?? [];
    bucket.push(transform.matrix.clone()); batches.set(color,bucket);
  }
  function slab(r: Rect,color: number,y: number,h: number) { box(color,r.x,y,r.z,r.w,h,r.d); }
  for (const floor of geometry.floors) {
    slab(floor,0x515e59,-0.07,0.14);
    slab(floor,0x293637,3.6,0.12);
  }
  for (const wall of geometry.walls) {
    slab(wall,0x748078,1.8,3.6);
    const trim = {...wall,w:wall.w+0.025,d:wall.d+0.025};
    slab(trim,0x354641,0.3,0.6); slab(trim,0xb0975f,1.09,0.06);
    // Dark expansion joints break long wall panels into readable bays.
    const wide = wall.w > wall.d, length = wide ? wall.w : wall.d;
    for (let i=1;i<Math.ceil(length/2);i++) {
      const offset = length*(i/Math.ceil(length/2)-0.5);
      box(0x485a54,wall.x+(wide?offset:0),1.8,wall.z+(wide?0:offset),
        wide?0.055:trim.w,3.5,wide?trim.d:0.055);
    }
  }
  let propIndex = 0;
  for (const r of layout.rooms) {
    const color = colors[r.kind];
    const f = footprint(r);
    for (let x=-f.w/2+2; x<f.w/2; x+=2) box(0x3e4c48,r.x+x,0.003,r.z,0.025,0.006,f.d-0.2);
    for (let z=-f.d/2+2; z<f.d/2; z+=2) box(0x3e4c48,r.x,0.003,r.z+z,f.w-0.2,0.006,0.025);
    // Recessed ceiling services give each room a visual bearing even from the middle.
    for (const side of [-1,1]) {
      box(0x475d5b,r.x+side*(f.w/2-0.65),3.37,r.z,0.22,0.18,f.d-0.2);
      box(0x354744,r.x,3.49,r.z+side*1.6,f.w-0.2,0.16,0.14);
    }
    box(color,r.x,0.008,r.z,1.6,0.016,1.6);
    if (['relay','exit','switchboard','intake'].includes(r.kind)) {
      for (const side of [-1,1]) box(color,r.x+side*0.88,0.023,r.z,0.09,0.028,2.1);
    }
    for (const sign of [-1,1]) {
      const offset = sign*1.15;
      box(0x9daaa1,r.x+offset,3.45,r.z,0.22,0.12,2.6);
      box(0xe4e7c9,r.x+offset,3.37,r.z,0.16,0.05,2.35);
    }
    if (r.kind === 'intake' || r.kind === 'junction') continue;
    const p = geometry.equipment[propIndex++];
    slab(p,0x303e3e,0.65,1.3);
    slab({...p,w:1.28,d:1.28},color,1.31,0.12);
    if (r.kind === 'switchboard') {
      box(0x263331,p.x,1.99,p.z,1.15,1.35,0.7);
      for (const x of [-0.33,0,0.33]) {
        box(color,p.x+x,2.19,p.z,0.19,0.13,0.74);
        box(0xa4a9a2,p.x+x,1.86,p.z,0.08,0.27,0.74);
      }
    } else if (r.kind === 'chiller') {
      for (let fin=0;fin<6;fin++) box(color,p.x,1.49+fin*0.19,p.z,1.14,0.09,1.14);
    } else if (r.kind === 'pump') {
      for (const offset of [-0.3,0,0.3]) box(0x829b98,p.x+offset,1.64,p.z,0.15,0.68,0.6);
    } else if (r.kind === 'stores') {
      box(0x806c50,p.x,1.62,p.z,1.05,0.5,1.05);
    } else {
      box(0x182c2c,p.x,1.65,p.z,0.8,0.58,0.6);
      box(color,p.x,1.75,p.z,0.82,0.12,0.62);
    }
  }
  const labels = new Map<string,T.MeshBasicMaterial>();
  function label(text:string,x:number,z:number,angle:number) {
    let mat = labels.get(text);
    if (!mat) {
      const c = document.createElement('canvas'); c.width=512; c.height=96;
      const ctx=c.getContext('2d')!;
      ctx.fillStyle='#203230'; ctx.fillRect(0,0,512,96);
      ctx.fillStyle='#efd493'; ctx.font='bold 51px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(text.toUpperCase(),256,49,492);
      const texture=new T.CanvasTexture(c); texture.colorSpace=T.SRGBColorSpace;
      mat=new T.MeshBasicMaterial({map:texture}); labels.set(text,mat);
    }
    const mesh=new T.Mesh(signFace,mat);
    mesh.position.set(x,2.85,z); mesh.rotation.y=angle; root.add(mesh);
  }
  const signFace=new T.PlaneGeometry(2.35,0.44);
  const byId=new Map(layout.rooms.map(r=>[r.id,r]));
  for (const edge of layout.passages) {
    const a=byId.get(edge.a)!,b=byId.get(edge.b)!;
    const dx=Math.sign(b.x-a.x),dz=Math.sign(b.z-a.z);
    const x=(a.x+b.x)/2,z=(a.z+b.z)/2;
    box(0x314342,x,3.02,z,dx?0.28:opening,1.1,dz?0.28:opening);
    label(roomLabel(b),x-dx*0.16,z-dz*0.16,Math.atan2(-dx,-dz));
    label(roomLabel(a),x+dx*0.16,z+dz*0.16,Math.atan2(dx,dz));
    // The amber jambs frame Intake even after its bulkhead opens. At Exit the
    // three green lights sit above head height and read from either side.
    if (a.kind === 'intake' || b.kind === 'intake') {
      for (const side of [-1,1]) {
        const offset = side*(opening/2-0.03);
        for (let band=0;band<6;band++) {
          box(colors.intake,x+dz*offset,0.26+band*0.4,z+dx*offset,dx?0.32:0.06,0.24,dz?0.32:0.06);
        }
      }
    }
    if (a.kind === 'exit' || b.kind === 'exit') {
      for (const offset of [-0.65,0,0.65]) {
        box(colors.exit,x+dz*offset,3.33,z+dx*offset,dx?0.34:0.36,0.16,dz?0.34:0.36);
      }
    }
    for (const side of [-1,1]) box(0xb69c60,x+dz*side*0.8,0.009,z+dx*side*0.8,dx?2.5:0.07,0.018,dz?2.5:0.07);
  }
  for (const [color,matrices] of batches) {
    const mesh = new T.InstancedMesh(cube,new T.MeshStandardMaterial({
      color, map:[0x748078,0x515e59].includes(color) ? surface : null,
      emissive:color===0xe4e7c9 ? 0xc0cfad : Object.values(colors).includes(color) ? color : 0, emissiveIntensity:0.55, roughness:0.86,
    }),matrices.length);
    matrices.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix)); root.add(mesh);
  }
  const doors = geometry.doors.map(d => {
    const panel=new T.Mesh(cube,new T.MeshStandardMaterial({color:0xa96c37,roughness:0.8}));
    panel.scale.set(d.w,2.45,d.d); panel.position.set(d.x,1.225,d.z); root.add(panel);
    return {id:d.id,panel};
  });
  function update(opened: readonly string[]) { for (const d of doors) d.panel.visible=!opened.includes(d.id); }
  function dispose() {
    const geometries=new Set<T.BufferGeometry>(), materials=new Set<T.Material>();
    root.traverse(item=>{
      if (item instanceof T.Mesh) { geometries.add(item.geometry); materials.add(item.material); }
      if (item instanceof T.InstancedMesh) item.dispose();
    });
    for (const mat of labels.values()) mat.map?.dispose();
    for (const resource of [...geometries,...materials]) resource.dispose();
    surface.dispose();
    root.removeFromParent();
  }
  return {root,update,dispose};
}
