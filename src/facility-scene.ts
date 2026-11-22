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
const textured = new Set([0x748078,0x515e59]);
const lamp = 0xe4e7c9;

// Box vertices for one material within one room, merged into a single draw.
class Batch {
  static unit = new T.BoxGeometry();
  position: number[] = []; normal: number[] = []; uv: number[] = []; color: number[] = []; index: number[] = [];
  add(matrix: T.Matrix4, normals: T.Matrix3, color: T.Color) {
    const u = Batch.unit, p = u.attributes.position, n = u.attributes.normal, t = u.attributes.uv;
    const base = this.position.length/3, v = new T.Vector3();
    for (let i=0;i<p.count;i++) {
      v.fromBufferAttribute(p,i).applyMatrix4(matrix); this.position.push(v.x,v.y,v.z);
      v.fromBufferAttribute(n,i).applyMatrix3(normals).normalize(); this.normal.push(v.x,v.y,v.z);
      this.uv.push(t.getX(i),t.getY(i)); this.color.push(color.r,color.g,color.b);
    }
    const index = u.index!;
    for (let i=0;i<index.count;i++) this.index.push(base+index.getX(i));
  }
  build() {
    const g = new T.BufferGeometry();
    g.setAttribute('position',new T.Float32BufferAttribute(this.position,3));
    g.setAttribute('normal',new T.Float32BufferAttribute(this.normal,3));
    g.setAttribute('uv',new T.Float32BufferAttribute(this.uv,2));
    g.setAttribute('color',new T.Float32BufferAttribute(this.color,3));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    return g;
  }
}

// Each room is one group of merged meshes, so whole rooms can be hidden at
// once. Walls and decks carry the plate texture; markers and lamps glow.
export function buildFacility(layout: Layout, surface: T.Texture) {
  const root = new T.Group();
  const geometry = geometryFor(layout);
  const byId = new Map(layout.rooms.map(r => [r.id,r]));
  const groups = new Map(layout.rooms.map(r => {
    const g = new T.Group(); g.name = r.id; root.add(g);
    return [r.id,g];
  }));
  const plate = new T.MeshStandardMaterial({vertexColors:true,map:surface,roughness:0.86});
  const matte = new T.MeshStandardMaterial({vertexColors:true,roughness:0.86});
  const glow = new T.MeshStandardMaterial({vertexColors:true,roughness:0.86});
  glow.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance = vColor.rgb * 0.55;');
  };
  const emissive = new Set([lamp,...Object.values(colors)]);
  const batches = new Map<string,Map<T.Material,Batch>>();
  const transform = new T.Object3D(), normals = new T.Matrix3(), tint = new T.Color();
  function box(room: string,color: number,x: number,y: number,z: number,w: number,h: number,d: number,angle=0,axis:'x'|'z'='x') {
    transform.rotation.set(axis==='x'?angle:0,0,axis==='z'?angle:0);
    transform.position.set(x,y,z); transform.scale.set(w,h,d); transform.updateMatrix();
    const material = textured.has(color) ? plate : emissive.has(color) ? glow : matte;
    let byMaterial = batches.get(room);
    if (!byMaterial) batches.set(room,byMaterial = new Map());
    let batch = byMaterial.get(material);
    if (!batch) byMaterial.set(material,batch = new Batch());
    batch.add(transform.matrix,normals.getNormalMatrix(transform.matrix),tint.setHex(color));
  }
  drawTemplates(geometry,box,id => colors[byId.get(id)!.kind]);
  // Each destination has a coloured floor marker; stations add side stripes.
  for (const room of layout.rooms) {
    if (room.kind === 'corridor' || room.kind === 'stairwell') continue;
    const a = anchor(room), color = colors[room.kind];
    box(room.id,color,a.x,a.y+0.008,a.z,1.6,0.016,1.6);
    if (stations.includes(room.kind)) for (const side of [-1,1]) box(room.id,color,a.x+side*0.88,a.y+0.023,a.z,0.09,0.028,2.1);
  }
  const labels = new Map<string,T.MeshBasicMaterial>();
  const signFace = new T.PlaneGeometry(2.35,0.44);
  function label(room: string,text: string,x: number,y: number,z: number,angle: number) {
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
    mesh.position.set(x,y,z); mesh.rotation.y=angle; groups.get(room)!.add(mesh);
  }
  for (const o of geometry.openings) {
    const a = byId.get(o.a)!, b = byId.get(o.b)!;
    const [nx,nz] = outward(o.side);
    // Over each doorway, a sign on either side names the room ahead.
    for (const [here,ahead,sign] of [[a,b,-1],[b,a,1]] as const) {
      if (ahead.kind === 'corridor' || orient(here.template,here.turn).height < 3.1) continue;
      label(here.id,roomLabel(ahead),o.x+sign*nx*0.16,o.y+2.78,o.z+sign*nz*0.16,Math.atan2(sign*nx,sign*nz));
    }
    // The amber jambs frame Intake even after its bulkhead opens. At Exit the
    // three green lights sit over the door and read from either side. Each
    // landmark belongs to both rooms so it shows from whichever side is drawn.
    for (const room of [a.id,b.id]) {
      if (a.kind === 'intake' || b.kind === 'intake') {
        for (const side of [-1,1]) {
          const offset = side*(doorWidth/2-0.03);
          for (let band=0;band<6;band++) box(room,colors.intake,o.x+nz*offset,o.y+0.26+band*0.4,o.z+nx*offset,nx?0.32:0.06,0.24,nz?0.32:0.06);
        }
      }
      if (a.kind === 'exit' || b.kind === 'exit') {
        for (const offset of [-0.65,0,0.65]) box(room,colors.exit,o.x+nz*offset,o.y+2.66,o.z+nx*offset,nx?0.34:0.36,0.16,nz?0.34:0.36);
      }
    }
    for (const side of [-1,1]) box(a.id,0xb69c60,o.x+nz*side*0.8,o.y+0.009,o.z+nx*side*0.8,nx?1.2:0.07,0.018,nz?1.2:0.07);
  }
  for (const [room,byMaterial] of batches) {
    for (const [material,batch] of byMaterial) groups.get(room)!.add(new T.Mesh(batch.build(),material));
  }
  const panel = new T.MeshStandardMaterial({color:0xa96c37,roughness:0.8});
  const doors = geometry.doors.map(d => {
    const mesh = new T.Mesh(Batch.unit,panel);
    mesh.scale.set(d.w,d.h,d.d); mesh.position.set(d.x,d.y+d.h/2,d.z); root.add(mesh);
    const passage = layout.passages.find(p => p.id === d.id)!;
    return {id:d.id,mesh,rooms:[passage.a,passage.b]};
  });
  let opened: readonly string[] = [], shown: Set<string> | undefined;
  const drawn = (room: string) => !shown || shown.has(room);
  function refresh() {
    for (const [id,group] of groups) group.visible = drawn(id);
    for (const d of doors) d.mesh.visible = !opened.includes(d.id) && d.rooms.some(drawn);
  }
  function update(open: readonly string[]) { opened = open; refresh(); }
  // Draw only these rooms, or every room when no set is given.
  function show(rooms: Set<string> | undefined) { shown = rooms; refresh(); }
  function dispose() {
    const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>();
    root.traverse(item=>{ if (item instanceof T.Mesh) { geometries.add(item.geometry); materials.add(item.material); } });
    geometries.delete(Batch.unit);
    for (const mat of labels.values()) mat.map?.dispose();
    for (const resource of [...geometries,...materials]) resource.dispose();
    surface.dispose();
    root.removeFromParent();
  }
  return {root,update,show,dispose,rooms:groups.size};
}
