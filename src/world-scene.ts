import * as T from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Batch } from './facility-scene.ts';
import type { Library, Surface } from './materials.ts';
import { groundAt, home, type Outdoors } from './places.ts';
import { fieldHeight, waterLevel } from './room-templates.ts';

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

// Scrubby ground, speckled, tiled every 4 m; vertex colours do the rest.
let groundTexture: T.CanvasTexture | undefined;
function scrub() {
  if (groundTexture) return groundTexture;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!, img = ctx.createImageData(256,256);
  let n = 0x9e3779b9;
  const rnd = () => { n ^= n << 13; n ^= n >>> 17; n ^= n << 5; return ((n >>> 0)%1000)/1000; };
  for (let i=0;i<256*256;i++) { const v = 150+rnd()*105; img.data.set([v,v,v,255],i*4); }
  ctx.putImageData(img,0,0);
  ctx.globalAlpha = 0.25;
  for (let i=0;i<900;i++) { ctx.fillStyle = rnd() < 0.5 ? '#ffffff' : '#555555'; ctx.fillRect(rnd()*256,rnd()*256,1+rnd()*3,1+rnd()*2); }
  groundTexture = new T.CanvasTexture(canvas);
  groundTexture.wrapS = groundTexture.wrapT = T.RepeatWrapping; groundTexture.colorSpace = T.SRGBColorSpace;
  return groundTexture;
}

// Mud: dark brown, blotched with wetter puddles and drier crust, tiled every
// 3 m.
let mudTexture: T.CanvasTexture | undefined;
function mud() {
  if (mudTexture) return mudTexture;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  let n = 0x51ed270b;
  const rnd = () => { n ^= n << 13; n ^= n >>> 17; n ^= n << 5; return ((n >>> 0)%1000)/1000; };
  ctx.fillStyle = '#6b5a44'; ctx.fillRect(0,0,256,256);
  // Blotches wrap around the edges so the tiling doesn't show.
  const blot = (x: number, y: number, r: number, color: string) => {
    for (const ox of [-256,0,256]) for (const oy of [-256,0,256]) {
      const g = ctx.createRadialGradient(x+ox,y+oy,0,x+ox,y+oy,r);
      g.addColorStop(0,color); g.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(x+ox-r,y+oy-r,r*2,r*2);
    }
  };
  for (let i=0;i<40;i++) blot(rnd()*256,rnd()*256,12+rnd()*40,'rgba(40,30,20,0.55)');
  for (let i=0;i<30;i++) blot(rnd()*256,rnd()*256,6+rnd()*18,'rgba(150,130,100,0.35)');
  for (let i=0;i<1400;i++) { ctx.fillStyle = rnd() < 0.5 ? 'rgba(30,22,14,0.5)' : 'rgba(160,140,110,0.4)'; ctx.fillRect(rnd()*256,rnd()*256,1+rnd()*2,1+rnd()*2); }
  mudTexture = new T.CanvasTexture(canvas);
  mudTexture.wrapS = mudTexture.wrapT = T.RepeatWrapping; mudTexture.colorSpace = T.SRGBColorSpace;
  return mudTexture;
}
// A marsh's mud over its banks and pool beds (marks 2 and 3), on the height
// map's own grid and triangles a hair above the ground, fading out at its
// edge, with a wet sheen.
function mudBanks(map: Outdoors) {
  const f = map.ground, n = f.n, muddy = (i: number, k: number) => { const m = map.marks[k*n+i]; return m === 2 || m === 3; };
  const position: number[] = [], color: number[] = [], uv: number[] = [], index: number[] = [], vertex = new Map<number,number>();
  const at = (i: number, k: number) => {
    const key = k*n+i;
    let v = vertex.get(key);
    if (v === undefined) {
      const x = f.x0+i*f.step, z = f.z0+k*f.step;
      v = position.length/3; vertex.set(key,v);
      position.push(x,f.h[key]+0.02,z); uv.push(x/3,z/3); color.push(1,1,1,muddy(i,k) ? 1 : 0);
    }
    return v;
  };
  for (let k=0;k<n-1;k++) for (let i=0;i<n-1;i++) {
    if (!muddy(i,k) && !muddy(i+1,k) && !muddy(i,k+1) && !muddy(i+1,k+1)) continue;
    const a = at(i,k), b = at(i+1,k), c = at(i,k+1), d = at(i+1,k+1);
    index.push(a,c,b,b,c,d);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position',new T.Float32BufferAttribute(position,3)); g.setAttribute('color',new T.Float32BufferAttribute(color,4)); g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
  g.setIndex(index); g.computeVertexNormals();
  const mesh = new T.Mesh(g,new T.MeshStandardMaterial({map:mud(),vertexColors:true,transparent:true,depthWrite:false,roughness:0.55,metalness:0.05,color:0x8a7a66,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
  // Under the water, which is drawn after.
  mesh.renderOrder = -1;
  return mesh;
}

// The ground: 32 m chunks, each drawn finely near the camera and coarsely
// far off (4 m), with a short skirt hiding the seams between the two. Normals
// come from the height map itself, so chunk edges shade alike. Dark scrub on
// level ground, dirt on slopes, gravel on the building's plot.
function terrain(map: Outdoors) {
  const f = map.ground, half = map.size/2, chunk = 32, group = new T.Group();
  const material = new T.MeshStandardMaterial({vertexColors:true,map:scrub(),roughness:1,metalness:0});
  const h = (x: number, z: number) => fieldHeight(f,x,z);
  const marsh = map.kind === 'marsh', quarry = map.kind === 'quarry';
  // A quarry: grey-brown ground, bare rock on its steep faces, pale rubble.
  const scrubColor = new T.Color(marsh ? 0x34402a : quarry ? 0x4a4538 : 0x3a4530), dirtColor = new T.Color(quarry ? 0x6a655c : 0x6a5a44), gravel = new T.Color(0x6d6b62), c = new T.Color();
  const rubbleColor = new T.Color(0x837b6e);
  const trailColor = new T.Color(marsh ? 0x6a5f4a : 0x857a64), siltColor = new T.Color(marsh ? 0x2b251a : 0x6e6c63);
  // A marsh's bank mud, mottled with wetter and drier patches.
  const mudColor = new T.Color(0x3a3121), mottle = (x: number, z: number) => {
    const s = Math.sin(x*1.7+Math.sin(z*0.9)*2)+Math.sin(z*1.3+Math.sin(x*0.7)*2.5);
    return 0.8+0.2*s;
  };
  const b = map.building;
  function mesh(x0: number, z0: number, step: number) {
    const cells = chunk/step, side = cells+1, position: number[] = [], normal: number[] = [], color: number[] = [], uv: number[] = [], index: number[] = [];
    const vertex = (x: number, y: number, z: number) => {
      const gx = (h(x+0.5,z)-h(x-0.5,z)), gz = (h(x,z+0.5)-h(x,z-0.5)), len = Math.hypot(gx,1,gz);
      position.push(x,y,z); normal.push(-gx/len,1/len,-gz/len); uv.push(x/4,z/4);
      const slope = Math.min(1,Math.hypot(gx,gz)/0.55);
      c.copy(scrubColor).lerp(dirtColor,slope);
      if (Math.abs(x-b.x) < b.w/2+6 && Math.abs(z-b.z-2) < b.d/2+8) c.lerp(gravel,0.7);
      // Worn trails and the dry riverbed's silt, from the map's marks.
      const mark = map.marks[Math.round(z-f.z0)*f.n+Math.round(x-f.x0)] ?? 0;
      if (mark === 1) c.lerp(trailColor,0.75); else if (mark === 2) c.lerp(siltColor,0.8);
      else if (mark === 3) c.lerp(mudColor,0.85).multiplyScalar(mottle(x,z));
      else if (mark === 4) c.lerp(rubbleColor,0.7).multiplyScalar(mottle(x*1.7,z*1.7));
      color.push(c.r,c.g,c.b);
      return position.length/3-1;
    };
    for (let k=0;k<side;k++) for (let i=0;i<side;i++) { const x = x0+i*step, z = z0+k*step; vertex(x,h(x,z),z); }
    for (let k=0;k<cells;k++) for (let i=0;i<cells;i++) { const a = k*side+i; index.push(a,a+side,a+1,a+1,a+side,a+side+1); }
    // The skirt: each edge vertex again, a metre lower.
    const edge = (i: number, k: number) => k*side+i;
    const rim = [...Array.from({length:side},(_,i) => edge(i,0)),...Array.from({length:side},(_,k) => edge(side-1,k)),...Array.from({length:side},(_,i) => edge(side-1-i,side-1)),...Array.from({length:side},(_,k) => edge(0,side-1-k))];
    const low = rim.map(v => vertex(position[v*3],position[v*3+1]-1,position[v*3+2]));
    for (let j=0;j+1<rim.length;j++) index.push(rim[j],low[j],rim[j+1],rim[j+1],low[j],low[j+1]);
    const g = new T.BufferGeometry();
    g.setAttribute('position',new T.Float32BufferAttribute(position,3)); g.setAttribute('normal',new T.Float32BufferAttribute(normal,3));
    g.setAttribute('color',new T.Float32BufferAttribute(color,3)); g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
    g.setIndex(index); g.computeBoundingSphere();
    return new T.Mesh(g,material);
  }
  for (let z0=-half;z0<half;z0+=chunk) for (let x0=-half;x0<half;x0+=chunk) {
    // Each chunk sits at its own centre, so it switches to its coarse level
    // by its own distance from the camera, not the map's.
    const cx = x0+chunk/2, cz = z0+chunk/2, cy = h(cx,cz), lod = new T.LOD();
    for (const [step,distance] of [[1,0],[4,60]]) {
      const m = mesh(x0,z0,step);
      m.geometry.translate(-cx,-cy,-cz); m.geometry.computeBoundingSphere();
      lod.addLevel(m,distance);
    }
    lod.position.set(cx,cy,cz);
    group.add(lod);
  }
  return group;
}

// The open map around a facility: rolling ground, boulders, the building with
// its lit main door and fire exits, the bell and the rifts. Built when an
// operator first goes outside and disposed when the crew is home.
export function buildOutdoors(map: Outdoors, library: Library) {
  const root = new T.Group(), b = batcher(library);
  let waterMaterial: T.MeshStandardMaterial | undefined;
  const wall = b.surface('panel'), rust = b.surface('rust');
  root.add(terrain(map));
  if (map.kind === 'marsh') root.add(mudBanks(map));
  const f = map.building;
  b.box(wall,0x9aa39a,f.x,f.h/2,f.z,f.w,f.h,f.d);
  b.box(wall,0x7b847d,f.x,f.h+0.3,f.z,f.w+0.4,0.6,f.d+0.4);
  // Dark window bands on every face, and a rusted canopy over the main door.
  for (const y of [3.8,6.6]) {
    for (const x of [-8,-4,4,8]) for (const side of [-1,1]) b.box(rust,0x2a2f2e,f.x+x,y,f.z+side*(f.d/2+0.02),2.4,0.9,0.06);
    for (const z of [-4,4]) for (const side of [-1,1]) b.box(rust,0x2a2f2e,f.x+side*(f.w/2+0.02),y,f.z+z,0.06,0.9,2.4);
  }
  b.box(rust,0x8a6a52,map.door.x,3.2,map.door.z+0.8,3.6,0.18,1.6);
  // Each fire exit: a plain door banded in green under a green lamp, no light cast.
  const green = new T.MeshBasicMaterial({color:0x4fd18b});
  for (const d of map.doors.slice(1)) {
    const [ox,oz] = [Math.sign(d.exit.x-d.door.x),Math.sign(d.exit.z-d.door.z)], across = oz !== 0;
    const slab = new T.Mesh(new T.BoxGeometry(across ? 1.7 : 0.1,2.5,across ? 0.1 : 1.7),new T.MeshStandardMaterial({color:0x2c3534,roughness:0.5,metalness:0.6}));
    slab.position.set(d.door.x+ox*0.04,1.25,d.door.z+oz*0.04); root.add(slab);
    for (const side of [-1,1]) for (let band=0;band<6;band++) {
      const jamb = new T.Mesh(new T.BoxGeometry(across ? 0.12 : 0.08,0.24,across ? 0.08 : 0.12),green);
      jamb.position.set(d.door.x+(across ? side*0.95 : ox*0.06),0.26+band*0.4,d.door.z+(across ? oz*0.06 : side*0.95)); root.add(jamb);
    }
    const sign = new T.Mesh(new T.BoxGeometry(across ? 0.6 : 0.1,0.16,across ? 0.1 : 0.6),green);
    sign.position.set(d.door.x+ox*0.1,2.85,d.door.z+oz*0.1); root.add(sign);
  }
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
    g.scale(r.w*1.08,r.h,r.d*1.08); g.rotateY(i*1.3); g.translate(r.x,r.y+r.h/2,r.z);
    return g;
  });
  if (shapes.length) {
    const rocks = new T.Mesh(mergeGeometries(shapes),new T.MeshStandardMaterial({color:0x5e5a50,roughness:1,flatShading:true}));
    root.add(rocks);
    for (const g of shapes) g.dispose();
  }
  // Ruins: broken concrete walls, standing in the ground.
  const concrete = b.surface('concrete');
  for (const r of map.ruins) for (const p of r.pieces) b.box(concrete,0x8c8a80,p.x,p.y+p.h/2,p.z,p.w,p.h,p.d);
  // Wrecks and debris, rusted through: boxes batched with the rest, and
  // cylinders (tanks, pipes, silos, barrels) as a few merged meshes.
  const rustMat = new T.MeshStandardMaterial({color:0x6a4a36,roughness:0.85,metalness:0.4,map:rust.map ?? null,side:T.DoubleSide});
  const cylinders: T.BufferGeometry[] = [];
  const cylinder = (x: number, y: number, z: number, radius: number, length: number, axis: 'x' | 'y' | 'z', open = false) => {
    const c = new T.CylinderGeometry(radius,radius,length,14,1,open);
    if (axis === 'x') c.rotateZ(Math.PI/2); else if (axis === 'z') c.rotateX(Math.PI/2);
    c.translate(x,y,z); cylinders.push(c);
  };
  const paint: Partial<Record<string,number>> = {truck:0x5b6b55,container:0x7a3a2c,car:0x4a5560,shed:0x6d665a};
  for (const w of map.wrecks) {
    const [main] = w.boxes, foot = main.y+0.3, length = w.along === 'x' ? main.w : main.d;
    if (w.kind === 'tank') cylinder(main.x,foot+1.2,main.z,1.5,length,w.along);
    else if (w.kind === 'pipes') for (const [offset,lift] of [[-0.55,0.5],[0.55,0.5],[0,1.36]]) cylinder(main.x+(w.along === 'z' ? offset : 0),foot+lift-0.2,main.z+(w.along === 'x' ? offset : 0),0.5,length,w.along,true);
    else if (w.kind === 'silo') { cylinder(main.x,main.y+main.h/2,main.z,1.85,main.h,'y'); cylinder(main.x,main.y+main.h+0.25,main.z,0.9,0.5,'y'); }
    // Five upright barrels in two rows.
    else if (w.kind === 'barrels') for (const [bx,bz] of [[-0.8,-0.5],[0,-0.5],[0.8,-0.5],[-0.4,0.5],[0.4,0.5]]) cylinder(main.x+bx,foot+0.45,main.z+bz,0.32,0.9,'y');
    else w.boxes.forEach((p,i) => b.box(
      (w.kind === 'crane' && i === 0) || (w.kind === 'pylon' && i === 0) ? b.surface('grating') : w.kind === 'shed' ? b.surface('wood') : rust,
      paint[w.kind] ?? 0x8a6a52,p.x,p.y+p.h/2,p.z,p.w,p.h,p.d));
  }
  if (cylinders.length) {
    root.add(new T.Mesh(mergeGeometries(cylinders),rustMat));
    for (const c of cylinders) c.dispose();
  }
  // Bridges: plank decks with holes, broken railings, posts into the water.
  const wood = b.surface('wood');
  for (const br of map.bridges) {
    for (const pl of br.planks) {
      const len = pl.along === 'x' ? pl.w : pl.d, tilt = Math.atan2(pl.rise,len);
      if (pl.along === 'x') b.box(wood,0x6b5a45,pl.x,pl.y+pl.rise/2-0.06,pl.z,Math.hypot(len,pl.rise),0.12,pl.d-0.04,tilt,'z');
      else b.box(wood,0x6b5a45,pl.x,pl.y+pl.rise/2-0.06,pl.z,pl.w-0.04,0.12,Math.hypot(len,pl.rise),-tilt,'x');
    }
    for (const r of br.rails) b.box(wood,0x5a4a38,r.x,r.y+r.h-0.05,r.z,r.w,0.1,r.d);
    for (const r of br.rails) b.box(wood,0x5a4a38,r.x,r.y+r.h/2,r.z,Math.min(r.w,0.1),r.h,Math.min(r.d,0.1));
    for (const p of br.posts) b.box(wood,0x4a3d30,p.x,p.y+p.h/2,p.z,p.w,p.h,p.d);
  }
  // A marsh's boardwalks: weathered planks on short posts.
  for (const d of map.boardwalks) {
    b.box(wood,0x5f5240,d.x,d.y-0.05,d.z,d.w,0.1,d.d);
    for (const [ox,oz] of [[-0.55,-0.55],[0.55,0.55]]) b.box(wood,0x41372b,d.x+ox,d.y-0.5,d.z+oz,0.12,0.9,0.12);
  }
  b.build(root);
  // The water: a sheet at its surface over every height-map cell where the
  // ground dips under it, so it meets the banks wherever they are and never
  // hangs in the air. Dark, with a faint sheen, slowly moving.
  // A marsh's pools too: the search covers the river and every pool.
  const field = map.ground, n = field.n, river = map.water.points, pools = map.water.pools ?? [];
  if (river.length > 1 || pools.length) {
    const xs = [...river.map(p => p.x),...pools.flatMap(p => [p.x-p.r,p.x+p.r])], zs = [...river.map(p => p.z),...pools.flatMap(p => [p.z-p.r,p.z+p.r])];
    const lo = {x:Math.min(...xs)-16,z:Math.min(...zs)-16}, hi = {x:Math.max(...xs)+16,z:Math.max(...zs)+16};
    const levels = new Map<number,number | undefined>();
    const levelAt = (i: number, k: number) => {
      const key = k*n+i;
      if (!levels.has(key)) { const x = field.x0+i*field.step, z = field.z0+k*field.step; levels.set(key,x < lo.x || x > hi.x || z < lo.z || z > hi.z ? undefined : waterLevel(map.water,x,z)); }
      return levels.get(key);
    };
    const position: number[] = [], uv: number[] = [], index: number[] = [];
    for (let k=0;k<n-1;k++) for (let i=0;i<n-1;i++) {
      const corners = [[i,k],[i+1,k],[i+1,k+1],[i,k+1]], level = corners.map(([a,c]) => levelAt(a,c));
      const known = level.filter((l): l is number => l !== undefined);
      if (!known.length) continue;
      const top = Math.max(...known);
      if (!corners.some(([a,c],m) => field.h[c*n+a] < (level[m] ?? top)-0.01)) continue;
      const v = position.length/3;
      corners.forEach(([a,c],m) => { const x = field.x0+a*field.step, z = field.z0+c*field.step; position.push(x,level[m] ?? top,z); uv.push(x/4,z/4); });
      index.push(v,v+3,v+1,v+1,v+3,v+2);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position',new T.Float32BufferAttribute(position,3)); g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
    g.setIndex(index); g.computeVertexNormals();
    const ripples = scrub().clone(); ripples.needsUpdate = true;
    // A faint sheen of its own, so the water reads as a surface even at night.
    waterMaterial = new T.MeshStandardMaterial({color:0x1d3a3a,emissive:0x163234,emissiveIntensity:0.9,emissiveMap:ripples,roughness:0.15,metalness:0.3,transparent:true,opacity:0.85,map:ripples,side:T.DoubleSide,depthWrite:false});
    root.add(new T.Mesh(g,waterMaterial));
  }
  // Reeds: a few thin blades to a clump, one instanced mesh, each tilted a
  // little its own way.
  if (map.reeds.length) {
    const blade = new T.BoxGeometry(0.03,1,0.03); blade.translate(0,0.5,0);
    const reeds = new T.InstancedMesh(blade,new T.MeshStandardMaterial({color:0x5c6440,roughness:1}),map.reeds.length*5);
    const m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), s = new T.Vector3(), at = new T.Vector3();
    let k = 0, r = 1;
    const next = () => (r = (Math.imul(r,1103515245)+12345) >>> 0)/2**32;
    for (const reed of map.reeds) for (let i=0;i<5;i++) {
      e.set((next()-0.5)*0.5,next()*Math.PI,(next()-0.5)*0.5); q.setFromEuler(e);
      at.set(reed.x+(next()-0.5)*0.4,reed.y-0.1,reed.z+(next()-0.5)*0.4); s.set(1,reed.h*(0.6+next()*0.5),1);
      reeds.setMatrixAt(k++,m.compose(at,q,s));
    }
    reeds.instanceMatrix.needsUpdate = true;
    root.add(reeds);
  }
  // A quarry's blowing dust: motes drifting downwind around the viewer,
  // faster in a gust; one point cloud, moved each frame.
  const wind = map.geometry.wind;
  let dust: T.Points | undefined;
  const dustSpan = 28, motes = 360;
  if (wind) {
    const g = new T.BufferGeometry(), at = new Float32Array(motes*3);
    let r = 7;
    const next = () => (r = (Math.imul(r,1103515245)+12345) >>> 0)/2**32;
    for (let i=0;i<motes*3;i++) at[i] = (next()-0.5)*dustSpan;
    g.setAttribute('position',new T.BufferAttribute(at,3));
    dust = new T.Points(g,new T.PointsMaterial({color:0xb5a88e,size:0.05,transparent:true,opacity:0.55,depthWrite:false}));
    dust.frustumCulled = false;
    root.add(dust);
  }
  let dustAt = 0;
  const arrival = rift(0x9b7bff);
  arrival.group.position.set(map.arrival.x,map.arrival.y+1.2,map.arrival.z);
  // It faces the building it brought the crew to.
  arrival.group.rotation.y = Math.atan2(map.building.x-map.arrival.x,map.building.z-map.arrival.z);
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
    update(time: number, arrivalOpen: boolean, open?: {x: number; y?: number; z: number}, rung = false, view?: {x: number; y: number; z: number}, gust = false) {
      if (waterMaterial?.map) waterMaterial.map.offset.y = -time*0.05;
      // Dust: each mote drifts with the wind (and a little down) in the
      // world, and wraps round to stay within the cube about the viewer.
      if (dust && wind && view) {
        const dt = Math.min(0.1,Math.max(0,time-dustAt)); dustAt = time;
        const speed = gust ? 2.4 : 1, a = dust.geometry.getAttribute('position') as T.BufferAttribute, p = a.array as Float32Array, h = dustSpan/2, centre = [view.x,view.y,view.z];
        for (let i=0;i<motes;i++) {
          p[i*3] += wind.x*speed*dt*1.2; p[i*3+1] += (Math.sin(time*0.7+i)*0.3-0.2)*dt; p[i*3+2] += wind.z*speed*dt*1.2;
          for (let k=0;k<3;k++) { const rel = p[i*3+k]-centre[k]+h; p[i*3+k] = centre[k]-h+((rel % dustSpan)+dustSpan) % dustSpan; }
        }
        a.needsUpdate = true;
      }
      arrival.group.visible = arrivalOpen;
      if (arrivalOpen) arrival.spin(time);
      exit.group.visible = pillar.visible = !!open;
      if (open) {
        const y = open.y ?? groundAt(map,open.x,open.z);
        exit.group.position.set(open.x,y+1.2,open.z); pillar.position.set(open.x,y,open.z);
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
