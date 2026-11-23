import * as T from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Batch } from './facility-scene.ts';
import type { Library, Surface } from './materials.ts';
import { home, type Outdoors } from './places.ts';

// Merge boxes by material, with world-space texture coordinates, so a whole
// place costs one draw per material.
function batcher(library: Library) {
  const batches = new Map<T.Material,Batch>(), transform = new T.Object3D(), normals = new T.Matrix3(), tint = new T.Color();
  function box(material: T.Material, color: number, x: number, y: number, z: number, w: number, h: number, d: number, angle = 0, axis: 'x' | 'z' | 'wedge' = 'x') {
    transform.rotation.set(axis === 'x' ? angle : 0,axis === 'wedge' ? angle : 0,axis === 'z' ? angle : 0);
    transform.position.set(x,y,z); transform.scale.set(w,h,d); transform.updateMatrix();
    let batch = batches.get(material);
    if (!batch) batches.set(material,batch = new Batch());
    batch.add(transform.matrix,normals.getNormalMatrix(transform.matrix),tint.setHex(color),axis === 'wedge' ? Batch.wedge : Batch.unit);
  }
  const surface = (name: Surface) => library.surfaces.get(name)!;
  function build(root: T.Group) {
    for (const [material,batch] of batches) root.add(new T.Mesh(batch.build(),material));
  }
  return {box,surface,build};
}

// A rift: a ring of light around a slowly turning swirl, standing upright.
function rift(color: number) {
  const group = new T.Group();
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64,64,4,64,64,62);
  gradient.addColorStop(0,'#ffffff'); gradient.addColorStop(0.35,'#c9b8ff'); gradient.addColorStop(1,'#00000000');
  ctx.fillStyle = gradient; ctx.fillRect(0,0,128,128);
  ctx.strokeStyle = '#ffffff55'; ctx.lineWidth = 3;
  for (let i=0;i<5;i++) { ctx.beginPath(); ctx.arc(64,64,12+i*10,i,i+2.2); ctx.stroke(); }
  const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
  const swirl = new T.MeshBasicMaterial({map:texture,color,transparent:true,blending:T.AdditiveBlending,depthWrite:false,side:T.DoubleSide});
  const discs = [0,1].map(i => {
    const disc = new T.Mesh(new T.CircleGeometry(1.05,40),swirl);
    disc.position.z = i*0.02; group.add(disc);
    return disc;
  });
  group.add(new T.Mesh(new T.TorusGeometry(1.1,0.07,8,48),new T.MeshBasicMaterial({color})));
  const glow = new T.PointLight(color,9,9,1.6);
  glow.position.z = 0.6; group.add(glow);
  group.position.y = 1.2;
  return {group,spin(time: number) { discs[0].rotation.z = time*0.9; discs[1].rotation.z = -time*1.4; }};
}

// The screen of a contract terminal, redrawn only when its text changes.
function screen() {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 320;
  const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
  const mesh = new T.Mesh(new T.PlaneGeometry(1.25,0.78),new T.MeshBasicMaterial({map:texture}));
  let shown = '';
  function write(lines: string[]) {
    const text = lines.join('\n');
    if (text === shown) return;
    shown = text;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#0d1a17'; g.fillRect(0,0,512,320);
    g.font = 'bold 30px monospace'; g.textBaseline = 'top';
    lines.forEach((l,i) => { g.fillStyle = i ? '#bfe8d4' : '#7ee0b5'; g.fillText(l,22,18+i*38,468); });
    texture.needsUpdate = true;
  }
  return {mesh,write,dispose() { texture.dispose(); }};
}

// The crew's own dimension: a railed platform floating in violet dark, with
// the contract terminal and the rift. Built once and kept.
export function buildHome(library: Library) {
  const root = new T.Group(), place = home(), b = batcher(library);
  const deck = b.surface('diamond'), steel = b.surface('panel');
  b.box(deck,0xc9c2d8,0,-0.15,0,14,0.3,10);
  // Railings: posts and a top rail around the edge.
  for (const [x0,z0,x1,z1] of [[-7,-5,7,-5],[-7,5,7,5],[-7,-5,-7,5],[7,-5,7,5]]) {
    const long = Math.hypot(x1-x0,z1-z0), n = Math.round(long/2);
    for (let i=0;i<=n;i++) b.box(steel,0x8d84a8,x0+(x1-x0)*i/n,0.52,z0+(z1-z0)*i/n,0.08,1.04,0.08);
    b.box(steel,0x8d84a8,(x0+x1)/2,1.06,(z0+z1)/2,Math.abs(x1-x0)+0.08,0.06,Math.abs(z1-z0)+0.08);
  }
  // The terminal desk, its screen facing the platform.
  const desk = place.geometry.props[0];
  b.box(steel,0x6f7d78,desk.x,desk.h/2,desk.z,desk.w,desk.h,desk.d);
  b.build(root);
  const terminal = screen();
  terminal.mesh.position.set(desk.x+desk.w/2+0.012,desk.h+0.45,desk.z); terminal.mesh.rotation.y = Math.PI/2;
  root.add(terminal.mesh);
  const portal = rift(0x9b7bff);
  portal.group.position.set(place.rift.x,1.2,place.rift.z);
  root.add(portal.group);
  // Slabs drifting in the void give the dark some depth.
  const drift = new T.MeshStandardMaterial({color:0x3a3150,roughness:0.9});
  const slabs: T.Mesh[] = [];
  let seed = 7;
  const rnd = () => ((seed = (Math.imul(seed,1664525)+1013904223) >>> 0) / 4294967296);
  for (let i=0;i<12;i++) {
    const slab = new T.Mesh(new T.BoxGeometry(1+rnd()*3,0.3+rnd(),1+rnd()*3),drift);
    const a = rnd()*Math.PI*2, r = 14+rnd()*16;
    slab.position.set(Math.cos(a)*r,-6+rnd()*14,Math.sin(a)*r);
    slab.rotation.set(rnd(),rnd()*3,rnd());
    slabs.push(slab); root.add(slab);
  }
  return {
    root,
    terminal: terminal.write,
    update(time: number) {
      portal.spin(time);
      for (const [i,s] of slabs.entries()) s.rotation.y += 0.0008*(i%3+1);
    },
  };
}

// The open map around a facility: ground, banks and ramps, boulders, cliffs,
// and the façade with its lit door. Built when an operator first goes outside
// and disposed when the crew is home.
export function buildOutdoors(map: Outdoors, library: Library) {
  const root = new T.Group(), b = batcher(library);
  const dirt = b.surface('concrete'), wall = b.surface('panel'), rust = b.surface('rust');
  for (const s of map.geometry.surfaces) {
    if (s.rise) {
      // Tilted the same way the facility's ramps are drawn.
      if (s.along) b.box(dirt,0x8a8672,s.x,s.y+s.rise/2-0.065,s.z,Math.hypot(s.w,s.rise),0.13,s.d,Math.atan2(s.rise,s.w),'z');
      else b.box(dirt,0x8a8672,s.x,s.y+s.rise/2-0.065,s.z,s.w,0.13,Math.hypot(s.d,s.rise),-Math.atan2(s.rise,s.d),'x');
      // Solid earth under the ramp, its top just inside the ramp's slab and
      // its sides 2 mm in from the slab's, so they never flicker together.
      const yaw = s.along ? (s.rise > 0 ? Math.PI/2 : -Math.PI/2) : (s.rise > 0 ? 0 : Math.PI);
      const back = Math.sign(s.rise)*0.002;
      b.box(dirt,0x7d7a65,s.along ? s.x-back : s.x,Math.min(s.y,s.y+s.rise)-0.06+Math.abs(s.rise)/2,s.along ? s.z : s.z-back,(s.along ? s.d : s.w)-0.004,Math.abs(s.rise),(s.along ? s.w : s.d)-0.004,yaw,'wedge');
    } else if (s.y > 0) b.box(dirt,0x8a8672,s.x,s.y/2,s.z,s.w,s.y,s.d);
    else b.box(dirt,0x8d8a72,s.x,-0.05,s.z,s.w,0.1,s.d);
  }
  // Cliffs at the map's edge, and the façade's mass.
  const half = map.size/2;
  for (const [x,z,w,d] of [[0,-half-2,map.size+8,4],[0,half+2,map.size+8,4],[-half-2,0,4,map.size],[half+2,0,4,map.size]]) b.box(dirt,0x4b4a40,x,4,z,w,8,d);
  const f = map.building;
  b.box(wall,0x9aa39a,f.x,f.h/2,f.z,f.w,f.h,f.d);
  b.box(wall,0x7b847d,f.x,f.h+0.3,f.z,f.w+0.4,0.6,f.d+0.4);
  // Dark window bands, and a rusted canopy over the door.
  for (const y of [3.8,6.6]) for (const x of [-8,-4,4,8]) b.box(rust,0x2a2f2e,f.x+x,y,f.z+f.d/2+0.02,2.4,0.9,0.06);
  b.box(rust,0x8a6a52,map.door.x,3.2,map.door.z+0.8,3.6,0.18,1.6);
  b.build(root);
  // The door itself, framed in Intake's amber, under a working lamp.
  const door = new T.Mesh(new T.BoxGeometry(1.7,2.5,0.1),new T.MeshStandardMaterial({color:0x2c3534,roughness:0.5,metalness:0.6}));
  door.position.set(map.door.x,1.25,map.door.z+0.04); root.add(door);
  const amber = new T.MeshBasicMaterial({color:0xe0b258});
  for (const side of [-1,1]) for (let band=0;band<6;band++) {
    const jamb = new T.Mesh(new T.BoxGeometry(0.12,0.24,0.08),amber);
    jamb.position.set(map.door.x+side*0.95,0.26+band*0.4,map.door.z+0.06); root.add(jamb);
  }
  const bulb = new T.Mesh(new T.BoxGeometry(0.5,0.12,0.2),new T.MeshBasicMaterial({color:0xffd9a0}));
  bulb.position.set(map.door.x,3.05,map.door.z+0.3); root.add(bulb);
  const lamp = new T.PointLight(0xffc27a,14,16,1.4);
  lamp.position.set(map.door.x,2.9,map.door.z+0.9); root.add(lamp);
  // Boulders: one merged mesh of rough, flat-shaded shapes.
  const shapes = map.rocks.map((r,i) => {
    const g = new T.DodecahedronGeometry(0.5,0);
    g.scale(r.w*1.08,r.h,r.d*1.08); g.rotateY(i*1.3); g.translate(r.x,r.h/2,r.z);
    return g;
  });
  if (shapes.length) {
    const rocks = new T.Mesh(mergeGeometries(shapes),new T.MeshStandardMaterial({color:0x5e5a50,roughness:1,flatShading:true}));
    root.add(rocks);
    for (const g of shapes) g.dispose();
  }
  const arrival = rift(0x9b7bff);
  arrival.group.position.set(map.arrival.x,1.2,map.arrival.z);
  root.add(arrival.group);
  // The bell: a dark iron frame in front of the façade, its bell hung from
  // the crossbar. Rung, it swings for a while.
  const iron = new T.MeshStandardMaterial({color:0x2b2a28,roughness:0.6,metalness:0.7});
  const frame = new T.Group();
  frame.position.set(map.bell.x,0,map.bell.z);
  for (const side of [-1,1]) { const post = new T.Mesh(new T.BoxGeometry(0.16,2.7,0.16),iron); post.position.set(side*0.6,1.35,0); frame.add(post); }
  const bar = new T.Mesh(new T.BoxGeometry(1.4,0.16,0.18),iron); bar.position.y = 2.62; frame.add(bar);
  const hanger = new T.Group(); hanger.position.y = 2.55; frame.add(hanger);
  const bell = new T.Mesh(new T.CylinderGeometry(0.16,0.42,0.62,16,1,true),new T.MeshStandardMaterial({color:0xb08d57,roughness:0.35,metalness:0.9,side:T.DoubleSide,envMap:library.reflections ?? null}));
  bell.position.y = -0.4; hanger.add(bell);
  const crown = new T.Mesh(new T.SphereGeometry(0.17,12,8),bell.material); crown.position.y = -0.1; hanger.add(crown);
  root.add(frame);
  // The exit rift, with a pillar of light that shows from anywhere: it
  // ignores the fog that hides everything else at a distance.
  const exit = rift(0xc9a8ff);
  root.add(exit.group);
  const beam = new T.MeshBasicMaterial({color:0xcbb8ff,transparent:true,opacity:0.22,blending:T.AdditiveBlending,depthWrite:false,fog:false,side:T.DoubleSide});
  const pillar = new T.Group();
  for (const [r,o] of [[0.9,0.22],[0.35,0.5]] as const) {
    const m = beam.clone(); m.opacity = o;
    const shaft = new T.Mesh(new T.CylinderGeometry(r,r,90,16,1,true),m); shaft.position.y = 45; pillar.add(shaft);
  }
  root.add(pillar);
  let rungAt: number | undefined;
  return {
    root,seed:map.seed,
    update(time: number, arrivalOpen: boolean, open?: {x: number; z: number}, rung = false) {
      arrival.group.visible = arrivalOpen;
      if (arrivalOpen) arrival.spin(time);
      exit.group.visible = pillar.visible = !!open;
      if (open) {
        exit.group.position.set(open.x,1.2,open.z); pillar.position.set(open.x,0,open.z);
        // The portal turns to face the façade, where the crew comes from.
        exit.group.rotation.y = Math.atan2(map.door.x-open.x,map.door.z-open.z);
        exit.spin(time);
      }
      if (rung && rungAt === undefined) rungAt = time;
      if (!rung) rungAt = undefined;
      const swing = rungAt === undefined ? 0 : Math.max(0,1-(time-rungAt)/6);
      hanger.rotation.x = Math.sin((time-(rungAt ?? 0))*5)*0.5*swing;
    },
    dispose() {
      const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>();
      root.traverse(o => { if (o instanceof T.Mesh) { geometries.add(o.geometry); materials.add(o.material); } });
      for (const shared of library.surfaces.values()) materials.delete(shared);
      for (const m of materials) { (m as T.MeshBasicMaterial).map?.dispose(); m.dispose(); }
      for (const g of geometries) g.dispose();
      root.removeFromParent();
    },
  };
}
