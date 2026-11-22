import * as T from 'three';
import { drawTemplates } from './template-scene.ts';
import { anchor, geometryFor, roomLabel } from './layout.ts';
import type { Layout, Kind } from './layout.ts';
import { doorWidth, orient, outward } from './room-templates.ts';

export const colors: Record<Kind,number> = {
  intake:0xe0b258, relay:0xe6a840, exit:0x70cfaf, switchboard:0xe0894e, chiller:0x57b9da, pump:0x648d92,
  stores:0xb78155, closet:0xc49a6c, boiler:0xb5654a, lockers:0x8c8fb8, control:0x7fb069, coldstore:0x9fd3e6,
  filters:0xa3b86c, generator:0xd4c24f, gallery:0x7d8f99, office:0xc98a9b, workshop:0xb88a4a, tunnel:0x6f8278,
  hall:0x8fa3a0, stairwell:0xd9d2b4, corridor:0x93a599,
};
const stations: Kind[] = ['relay','exit','switchboard','intake'];

// Group repeated industrial geometry into instanced draws for phone GPUs.
export function buildFacility(layout: Layout, surface: T.Texture) {
  const root = new T.Group();
  const geometry = geometryFor(layout);
  const cube = new T.BoxGeometry();
  const batches = new Map<number,T.Matrix4[]>();
  const transform = new T.Object3D();
  function box(color: number,x: number,y: number,z: number,w: number,h: number,d: number,angle=0,axis:'x'|'z'='x') {
    transform.rotation.set(axis==='x'?angle:0,0,axis==='z'?angle:0);
    transform.position.set(x,y,z); transform.scale.set(w,h,d); transform.updateMatrix();
    const bucket = batches.get(color) ?? [];
    bucket.push(transform.matrix.clone()); batches.set(color,bucket);
  }
  const byId = new Map(layout.rooms.map(r => [r.id,r]));
  drawTemplates(geometry,box,id => colors[byId.get(id)!.kind]);
  // Each destination has a coloured floor marker; stations add side stripes.
  for (const room of layout.rooms) {
    if (room.kind === 'corridor' || room.kind === 'stairwell') continue;
    const a = anchor(room), color = colors[room.kind];
    box(color,a.x,a.y+0.008,a.z,1.6,0.016,1.6);
    if (stations.includes(room.kind)) for (const side of [-1,1]) box(color,a.x+side*0.88,a.y+0.023,a.z,0.09,0.028,2.1);
  }
  const labels = new Map<string,T.MeshBasicMaterial>();
  const signFace = new T.PlaneGeometry(2.35,0.44);
  function label(text: string,x: number,y: number,z: number,angle: number) {
    let mat = labels.get(text);
    if (!mat) {
      const c = document.createElement('canvas'); c.width=512; c.height=96;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle='#203230'; ctx.fillRect(0,0,512,96);
      ctx.fillStyle='#efd493'; ctx.font='bold 51px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(text.toUpperCase(),256,49,492);
      const texture = new T.CanvasTexture(c); texture.colorSpace=T.SRGBColorSpace;
      mat = new T.MeshBasicMaterial({map:texture}); labels.set(text,mat);
    }
    const mesh = new T.Mesh(signFace,mat);
    mesh.position.set(x,y,z); mesh.rotation.y=angle; root.add(mesh);
  }
  for (const o of geometry.openings) {
    const a = byId.get(o.a)!, b = byId.get(o.b)!;
    const [nx,nz] = outward(o.side);
    // Over each doorway, a sign on either side names the room ahead.
    for (const [here,ahead,sign] of [[a,b,-1],[b,a,1]] as const) {
      if (ahead.kind === 'corridor' || orient(here.template,here.turn).height < 3.1) continue;
      label(roomLabel(ahead),o.x+sign*nx*0.16,o.y+2.78,o.z+sign*nz*0.16,Math.atan2(sign*nx,sign*nz));
    }
    // The amber jambs frame Intake even after its bulkhead opens. At Exit the
    // three green lights sit over the door and read from either side.
    if (a.kind === 'intake' || b.kind === 'intake') {
      for (const side of [-1,1]) {
        const offset = side*(doorWidth/2-0.03);
        for (let band=0;band<6;band++) box(colors.intake,o.x+nz*offset,o.y+0.26+band*0.4,o.z+nx*offset,nx?0.32:0.06,0.24,nz?0.32:0.06);
      }
    }
    if (a.kind === 'exit' || b.kind === 'exit') {
      for (const offset of [-0.65,0,0.65]) box(colors.exit,o.x+nz*offset,o.y+2.66,o.z+nx*offset,nx?0.34:0.36,0.16,nz?0.34:0.36);
    }
    for (const side of [-1,1]) box(0xb69c60,o.x+nz*side*0.8,o.y+0.009,o.z+nx*side*0.8,nx?1.2:0.07,0.018,nz?1.2:0.07);
  }
  const emissive = new Set(Object.values(colors));
  for (const [color,matrices] of batches) {
    const mesh = new T.InstancedMesh(cube,new T.MeshStandardMaterial({
      color, map:[0x748078,0x515e59].includes(color) ? surface : null,
      emissive:color===0xe4e7c9 ? 0xc0cfad : emissive.has(color) ? color : 0, emissiveIntensity:0.55, roughness:0.86,
    }),matrices.length);
    matrices.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix)); root.add(mesh);
  }
  const doors = geometry.doors.map(d => {
    const panel = new T.Mesh(cube,new T.MeshStandardMaterial({color:0xa96c37,roughness:0.8}));
    panel.scale.set(d.w,d.h,d.d); panel.position.set(d.x,d.y+d.h/2,d.z); root.add(panel);
    return {id:d.id,panel};
  });
  function update(opened: readonly string[]) { for (const d of doors) d.panel.visible=!opened.includes(d.id); }
  function dispose() {
    const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>();
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
