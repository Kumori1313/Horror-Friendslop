import * as T from 'three';
import { drawTemplates } from './template-scene.ts';
import { anchor, geometryFor, powered, roomLabel } from './layout.ts';
import type { Layout, Kind } from './layout.ts';
import { doorWidth, orient, outward } from './room-templates.ts';
import { itemKinds, spawnSalvage, type ItemKind } from './salvage.ts';
import { shellFinish, surfaceFor, worldUV, type Finish, type Library } from './materials.ts';
import { intakeDoor } from './places.ts';

export const colors: Record<Kind,number> = {
  intake:0xe0b258, relay:0xe6a840, switchboard:0xe0894e, chiller:0x57b9da, pump:0x648d92,
  stores:0xb78155, closet:0xc49a6c, boiler:0xb5654a, lockers:0x8c8fb8, control:0x7fb069, coldstore:0x9fd3e6,
  filters:0xa3b86c, generator:0xd4c24f, gallery:0x7d8f99, office:0xc98a9b, workshop:0xb88a4a, tunnel:0x6f8278,
  hall:0x8fa3a0, stairwell:0xd9d2b4, corridor:0x93a599,
};
const stations: Kind[] = ['intake'];
const lamp = 0xe4e7c9;
// A powered room is lit by the spotlight under its ceiling lamp (scene.ts).
// Its surfaces also get a faint glow of their own colour, the light bouncing
// around the room, so the corners outside the cone aren't black.
const lit = new WeakMap<T.Material,T.Material>();
function poweredVariant(material: T.Material) {
  let v = lit.get(material);
  if (!v) {
    v = material.clone();
    v.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * 0.1;');
    };
    v.customProgramCacheKey = () => 'powered';
    lit.set(material,v);
  }
  return v;
}
// In an unpowered room nothing lights the surroundings, so metal reflects none.
const unlit = new WeakMap<T.Material,T.Material>();
function unpoweredVariant(material: T.Material) {
  if (!(material instanceof T.MeshStandardMaterial) || !material.envMap) return material;
  let v = unlit.get(material);
  if (!v) { v = material.clone(); (v as T.MeshStandardMaterial).envMap = null; unlit.set(material,v); }
  return v;
}
const darkLamp = 0x34362f;

// Box vertices for one material within one room, merged into a single draw.
export class Batch {
  static unit = new T.BoxGeometry();
  // A unit wedge: flat underneath, its top rising from the front edge
  // (local −z) to the full height at the back (+z). It fills under ramps.
  static wedge = (() => {
    const at: Record<string,number[]> = {A:[-0.5,-0.5,-0.5],B:[0.5,-0.5,-0.5],C:[-0.5,-0.5,0.5],D:[0.5,-0.5,0.5],E:[-0.5,0.5,0.5],F:[0.5,0.5,0.5]};
    const position: number[] = [], normal: number[] = [], index: number[] = [], middle = new T.Vector3(0,-1/6,1/6);
    for (const face of ['ABDC','ABFE','CDFE','ACE','BDF']) {
      let points = [...face].map(k => new T.Vector3(...at[k]));
      const n = new T.Vector3().subVectors(points[1],points[0]).cross(new T.Vector3().subVectors(points[2],points[0])).normalize();
      const centre = points.reduce((sum,p) => sum.add(p),new T.Vector3()).divideScalar(points.length);
      // Wind every face to face outward.
      if (n.dot(centre.sub(middle)) < 0) { points = points.reverse(); n.negate(); }
      const base = position.length/3;
      for (const p of points) { position.push(p.x,p.y,p.z); normal.push(n.x,n.y,n.z); }
      for (let i=1;i<points.length-1;i++) index.push(base,base+i,base+i+1);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position',new T.Float32BufferAttribute(position,3));
    g.setAttribute('normal',new T.Float32BufferAttribute(normal,3));
    g.setIndex(index);
    return g;
  })();
  position: number[] = []; normal: number[] = []; uv: number[] = []; color: number[] = []; index: number[] = [];
  // Texture coordinates come from world position in metres, so a texture
  // keeps its scale on any length of wall, floor or ramp.
  add(matrix: T.Matrix4, normals: T.Matrix3, color: T.Color, u: T.BufferGeometry = Batch.unit) {
    const p = u.attributes.position, n = u.attributes.normal;
    const base = this.position.length/3, v = new T.Vector3(), w = new T.Vector3();
    for (let i=0;i<p.count;i++) {
      v.fromBufferAttribute(p,i).applyMatrix4(matrix); this.position.push(v.x,v.y,v.z);
      w.fromBufferAttribute(n,i).applyMatrix3(normals).normalize(); this.normal.push(w.x,w.y,w.z);
      this.uv.push(...worldUV(v.x,v.y,v.z,w.x,w.y,w.z)); this.color.push(color.r,color.g,color.b);
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
// once. Shell surfaces come from the room's palette, props keep their colour
// over metal, rust, paint or wood, and markers and lamps glow. Materials are
// shared from `library` and outlive the facility.
export function buildFacility(layout: Layout, library: Library) {
  const root = new T.Group();
  const geometry = geometryFor(layout);
  const byId = new Map(layout.rooms.map(r => [r.id,r]));
  const groups = new Map(layout.rooms.map(r => {
    const g = new T.Group(); g.name = r.id; root.add(g);
    return [r.id,g];
  }));
  const {matte,glow} = library;
  const emissive = new Set([lamp,...Object.values(colors)]);
  const power = new Map(layout.rooms.map(r => [r.id,powered(layout,r.id)]));
  const batches = new Map<string,Map<T.Material,Batch>>();
  const transform = new T.Object3D(), normals = new T.Matrix3(), tint = new T.Color();
  const white = new T.Color(1,1,1);
  function box(room: string,finish: Finish,color: number,x: number,y: number,z: number,w: number,h: number,d: number,angle=0,axis:'x'|'z'|'wedge'='x') {
    transform.rotation.set(axis==='x'?angle:0,axis==='wedge'?angle:0,axis==='z'?angle:0);
    transform.position.set(x,y,z); transform.scale.set(w,h,d); transform.updateMatrix();
    const kind = byId.get(room)!.kind, surface = surfaceFor(kind,finish);
    // Ceiling lamps are out in an unpowered room; landmarks glow everywhere.
    if (color === lamp && !power.get(room)) color = darkLamp;
    const material = emissive.has(color) ? glow : surface ? library.surfaces.get(surface)! : matte;
    // Shell textures carry their own colour, lightly tinted by the room's.
    if (material !== glow && shellFinish(finish)) tint.setHex(colors[kind]).lerp(white,0.82);
    else tint.setHex(color);
    let byMaterial = batches.get(room);
    if (!byMaterial) batches.set(room,byMaterial = new Map());
    let batch = byMaterial.get(material);
    if (!batch) byMaterial.set(material,batch = new Batch());
    batch.add(transform.matrix,normals.getNormalMatrix(transform.matrix),tint,axis === 'wedge' ? Batch.wedge : Batch.unit);
  }
  drawTemplates(geometry,box,id => colors[byId.get(id)!.kind]);
  // Each destination has a coloured floor marker; stations add side stripes.
  for (const room of layout.rooms) {
    if (room.kind === 'corridor' || room.kind === 'stairwell') continue;
    const a = anchor(room), color = colors[room.kind];
    box(room.id,'matte',color,a.x,a.y+0.008,a.z,1.6,0.016,1.6);
    if (stations.includes(room.kind)) for (const side of [-1,1]) box(room.id,'matte',color,a.x+side*0.88,a.y+0.023,a.z,0.09,0.028,2.1);
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
    // The amber jambs frame Intake, the way back to base, even after its
    // bulkhead opens. They are drawn once, with Intake, and sit 5 mm inside
    // the doorway edge so they never share a face with the wall.
    if (a.kind === 'intake' || b.kind === 'intake') {
      const room = a.kind === 'intake' ? a.id : b.id;
      for (const side of [-1,1]) {
        const offset = side*(doorWidth/2-0.035);
        for (let band=0;band<6;band++) box(room,'matte',colors.intake,o.x+nz*offset,o.y+0.26+band*0.4,o.z+nx*offset,nx?0.32:0.06,0.24,nz?0.32:0.06);
      }
    }
    for (const side of [-1,1]) box(a.id,'paint',0xb69c60,o.x+nz*side*0.8,o.y+0.009,o.z+nx*side*0.8,nx?1.2:0.07,0.018,nz?1.2:0.07);
  }
  // Salvage leaves through the exit rift outdoors; Intake keeps only its doors.
  const intake = layout.rooms.find(r => r.kind === 'intake');
  // Intake's outer door in its south wall leads back outside to the façade.
  if (intake && !layout.tour) {
    const d = intakeDoor;
    box(intake.id,'metal',0x2c3534,d.x,d.y+1.25,d.z+0.03,1.7,2.5,0.05);
    for (const side of [-1,1]) for (let band=0;band<6;band++) box(intake.id,'matte',colors.intake,d.x+side*0.92,d.y+0.26+band*0.4,d.z-0.02,0.12,0.24,0.06);
    label(intake.id,'Exit',d.x,d.y+2.95,d.z-0.06,Math.PI);
  }
  for (const [room,byMaterial] of batches) {
    for (const [material,batch] of byMaterial) groups.get(room)!.add(new T.Mesh(batch.build(),material === glow ? material : power.get(room) ? poweredVariant(material) : unpoweredVariant(material)));
  }
  // Bulkheads are painted steel plate.
  const panel = library.surfaces.get('panel')!.clone();
  panel.vertexColors = false; panel.color.setHex(0xc07a3c); panel.map = panel.map!.clone(); panel.map.repeat.set(1,1);
  const doors = geometry.doors.map(d => {
    const mesh = new T.Mesh(Batch.unit,panel);
    mesh.scale.set(d.w,d.h,d.d); mesh.position.set(d.x,d.y+d.h/2,d.z); root.add(mesh);
    const passage = layout.passages.find(p => p.id === d.id)!;
    return {id:d.id,mesh,rooms:[passage.a,passage.b]};
  });
  // One instanced box per kind of salvage, so any number of items costs one
  // draw each. Items in rooms the camera cannot see are left out.
  const salvageMeshes = new Map((Object.keys(itemKinds) as ItemKind[]).map(kind => {
    const k = itemKinds[kind], count = spawnSalvage(layout).filter(i => i.kind === kind).length;
    const metal = kind !== 'board' && kind !== 'toolbox';
    const mesh = new T.InstancedMesh(Batch.unit,new T.MeshStandardMaterial({color:k.color,roughness:metal ? 0.32 : 0.6,metalness:metal ? 0.85 : 0.2,envMap:metal ? library.reflections ?? null : null,emissive:k.color,emissiveIntensity:kind === 'cell' ? 0.55 : 0.08,envMapIntensity:0.3}),Math.max(1,count));
    mesh.count = 0; mesh.frustumCulled = false; root.add(mesh);
    return [kind,mesh];
  }));
  const place = new T.Object3D();
  let salvageKey = '';
  function salvage(list: {kind: ItemKind; x: number; y: number; z: number; room: string}[]) {
    const visible = list.filter(i => drawn(i.room));
    const key = visible.map(i => i.kind+i.x.toFixed(2)+i.y.toFixed(2)+i.z.toFixed(2)).join('|');
    if (key === salvageKey) return;
    salvageKey = key;
    for (const mesh of salvageMeshes.values()) mesh.count = 0;
    for (const i of visible) {
      const mesh = salvageMeshes.get(i.kind)!, [w,h,d] = itemKinds[i.kind].size;
      place.position.set(i.x,i.y+h/2,i.z); place.scale.set(w,h,d); place.rotation.set(0,(i.x*7+i.z*3)%Math.PI,0); place.updateMatrix();
      mesh.setMatrixAt(mesh.count++,place.matrix);
    }
    for (const mesh of salvageMeshes.values()) mesh.instanceMatrix.needsUpdate = true;
  }
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
    // The material library is shared with the next facility.
    for (const shared of [matte,glow,...library.surfaces.values()]) materials.delete(shared);
    panel.map?.dispose();
    for (const mesh of salvageMeshes.values()) mesh.dispose();
    for (const mat of labels.values()) mat.map?.dispose();
    for (const resource of [...geometries,...materials]) resource.dispose();
    root.removeFromParent();
  }
  // Each powered room's lamp: under the middle of its largest ceiling.
  const lamps = new Map<string,{x: number; y: number; z: number; height: number; reach: number}>(), sizes = new Map<string,number>();
  for (const r of geometry.roofs) {
    if (!power.get(r.room) || Math.min(r.w,r.d) < 2 || r.w*r.d <= (sizes.get(r.room) ?? 0)) continue;
    sizes.set(r.room,r.w*r.d);
    const floor = byId.get(r.room)!.y;
    // `reach`: from the middle of the ceiling to its farthest corner.
    lamps.set(r.room,{x:r.x,y:r.y-0.12,z:r.z,height:r.y-floor,reach:Math.hypot(r.w,r.d)/2});
  }
  return {root,update,show,dispose,salvage,lamps,rooms:groups.size};
}
