import * as T from 'three';
import { itemName, items, pace, stunTime, type Diver } from './mission.ts';
import { buildFacility } from './facility-scene.ts';
import { environment, materialLibrary } from './materials.ts';
import { anchor, geometryFor, type Geometry, type Layout } from './layout.ts';
import { home, outdoors, placeOf, type Place } from './places.ts';
import { buildHome, buildOutdoors } from './world-scene.ts';
import { obstaclesAt, roomTemplates, socketAt, surfaceAt } from './room-templates.ts';
import { portalGraph, visibleRooms, type PortalGraph } from './visibility.ts';
import { lampSlot, selected, walls } from './room.ts';
import type { Snapshot } from './room.ts';
import { gravity, positionAt, trajectory } from './flight.ts';
import type { Flight } from './flight.ts';
import { bodyOf, itemKinds, spawnSalvage, type ItemKind } from './salvage.ts';
import { heldLamp } from './server/simulation.ts';

function painted(color: string, seam: string) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color; ctx.fillRect(0, 0, 256, 256);
  let seed = 1234;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 8500; i++) {
    ctx.fillStyle = random() < 0.5 ? '#ffffff0d' : '#00000012';
    ctx.fillRect(random() * 256, random() * 256, 1 + random() * 3, 2);
  }
  ctx.strokeStyle = seam; ctx.lineWidth = 3; ctx.strokeRect(0, 0, 256, 256);
  for (const x of [6, 250]) for (const y of [6, 250]) {
    ctx.fillStyle = seam; ctx.fillRect(x - 1, y - 1, 3, 3);
  }
  const tex = new T.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = T.RepeatWrapping;
  tex.colorSpace = T.SRGBColorSpace;
  return tex;
}

export function createScene(canvas: HTMLCanvasElement, generated = false) {
  const renderer = new T.WebGLRenderer({ canvas, antialias: true });
  const fullRatio = Math.min(devicePixelRatio, 1.75);
  renderer.setPixelRatio(fullRatio);
  renderer.toneMapping = T.ACESFilmicToneMapping;
  const scene = new T.Scene();
  scene.background = new T.Color(0x263331);
  scene.fog = new T.FogExp2(0x273532, 0.043);
  // The fog leaves under 3% of a surface's colour past 44 m, so stop drawing at 48 m.
  const camera = new T.PerspectiveCamera(72, 1, 0.055, 48);
  camera.rotation.order = 'YXZ';
  const material = (color: number) => new T.MeshStandardMaterial({ color, roughness: 0.84 });
  const steel = material(0x334342), dark = material(0x172021), yellow = material(0xc68b33);
  const lit = new T.MeshBasicMaterial({ color: 0xffdda1 });
  const teal = new T.MeshBasicMaterial({ color: 0xbde8dd });
  const cube = new T.BoxGeometry();
  function box(x: number, y: number, z: number, w: number, h: number, d: number, mat: T.Material, parent: T.Object3D = scene) {
    const mesh = new T.Mesh(cube, mat);
    mesh.scale.set(w, h, d); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  }
  function sign(label: string, x: number, y: number, z: number, width: number) {
    const c = document.createElement('canvas'); c.width = 640; c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#212f30'; g.fillRect(0, 0, 640, 128);
    g.fillStyle = '#e7b962'; g.fillRect(0, 0, 13, 128);
    g.font = 'bold 68px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, 325, 66);
    const texture = new T.CanvasTexture(c); texture.colorSpace = T.SRGBColorSpace;
    const mesh = new T.Mesh(new T.PlaneGeometry(width, width / 5), new T.MeshBasicMaterial({ map: texture }));
    mesh.position.set(x, y, z); scene.add(mesh);
  }
  const sky = new T.HemisphereLight(0xc0e0dc,0x605648,1.28);
  scene.add(sky);
  // Generated facilities share one material library and one reflection map.
  // Anisotropic filtering at 2x keeps floors crisp at grazing angles; higher
  // levels cost noticeably more on software and low-end GPUs.
  const skylight = new T.DirectionalLight(0xe2d8b7,1);
  const library = generated ? materialLibrary(Math.min(2,renderer.capabilities.getMaxAnisotropy()),environment(renderer)) : undefined;
  if (generated) {
    skylight.position.set(-4,6,2); scene.add(skylight);
  } else {
    const floor = painted('#585e56', '#353e38'); floor.repeat.set(8, 12);
    box(0,-0.09,0,10,0.18,14,new T.MeshStandardMaterial({ map: floor }));
    box(0,3.73,0,10,0.15,14,steel);
    const plate = painted('#737e72', '#4c5b54'); plate.repeat.set(4, 2);
    const wallMat = new T.MeshStandardMaterial({ map: plate });
    for (const w of walls) {
      box(w.x,1.85,w.z,w.w,3.7,w.d,wallMat);
      box(w.x,0.19,w.z,w.w+0.025,0.38,w.d+0.025,steel);
      box(w.x,1.02,w.z,w.w+0.028,0.075,w.d+0.028,yellow);
    }
    box(0,3.22,-1,2,0.96,0.35,dark);
    for (const x of [-1.04,1.04]) {
      box(x,1.37,-1,0.12,2.75,0.46,steel);
      for (let i = 0; i < 5; i++) box(x,0.43+i*0.26,-0.76,0.12,0.12,0.025,yellow);
    }
    sign('RELAY  /  04',2.9,2.05,-0.80,2.65);
    sign('SERVICE BAY',0,2.35,-6.85,2.8);
    for (const x of [-1,1]) box(x,0.008,1.4,0.06,0.012,4.6,yellow);
    for (let i = 0; i < 15; i++) box(-0.95 + i*0.135,0.012,3.66,0.082,0.015,0.24,yellow);
    for (const z of [-5,-2,1,4,6]) {
      box(0,3.43,z,9.85,0.22,0.13,steel);
      box(-3,3.23,z,1.5,0.13,0.36,dark);
      box(-3,3.15,z,1.35,0.04,0.23,teal);
    }
    for (const x of [3.4,3.7,4.0]) box(x,3.32,0,0.13,0.13,13.9,steel);
    // Recessed electrical panels line the closed side of the partition.
    for (const x of [-4,-3.05,-2.1]) {
      box(x,1.7,-0.78,0.85,1.55,0.1,steel);
      for (let i = 0; i < 5; i++) box(x,2.20-i*0.075,-0.714,0.59,0.027,0.025,dark);
      box(x-0.23,1.45,-0.704,0.08,0.08,0.027,lit);
    }
    function fixture(x: number, z: number, color: number, power: number) {
      const light = new T.PointLight(color,power,12);
      light.position.set(x,2.9,z); scene.add(light);
    }
    fixture(-2,2,0xc4e8df,32); fixture(1,-5,0xffb75c,42);
    box(0,2.81,-0.79,0.75,0.07,0.08,lit);
  }
  let loaded: Layout | undefined;
  let facility: ReturnType<typeof buildFacility> | undefined;
  const people = new Map<number,T.Group>();
  // Salvage looks the same on the floor, in flight, in hand and in the hotbar.
  const itemMaterials = new Map<ItemKind,T.Material>();
  function itemMaterial(kind: ItemKind) {
    let m = itemMaterials.get(kind);
    if (!m) {
      const k = itemKinds[kind], metal = kind !== 'board' && kind !== 'toolbox';
      m = new T.MeshStandardMaterial({color:k.color,roughness:metal ? 0.32 : 0.6,metalness:metal ? 0.85 : 0.2,envMap:metal ? library?.reflections ?? null : null,emissive:k.color,emissiveIntensity:0.08});
      itemMaterials.set(kind,m);
    }
    return m;
  }
  // The item an operator has selected, shown in their hand.
  function holdItem(mesh: T.Mesh, kind: ItemKind | undefined, scale = 0.85) {
    mesh.visible = !!kind;
    if (!kind) return;
    mesh.material = itemMaterial(kind);
    const [w,h,d] = itemKinds[kind].size;
    mesh.scale.set(w*scale,h*scale,d*scale);
  }
  const inHand = new T.Mesh(cube,steel);
  inHand.visible = false; scene.add(inHand);
  function avatar(id: number) {
    const g = new T.Group(); scene.add(g);
    // The body, which tips over onto the floor when its operator dies.
    const pose = new T.Group(); pose.name = 'pose'; g.add(pose);
    const suit = material(id === 1 ? 0xa76531 : 0x487b79);
    box(0,1.05,0,0.44,0.62,0.29,suit,pose);
    box(0,1.65,0,0.34,0.35,0.32,dark,pose);
    box(0,1.66,-0.16,0.28,0.09,0.04,teal,pose);
    for (const x of [-0.13,0.13]) box(x,0.39,0,0.18,0.78,0.22,dark,pose);
    for (const x of [-0.28,0.28]) box(x,1.01,-0.04,0.13,0.54,0.16,suit,pose);
    box(0,1.23,0,0.45,0.055,0.30,yellow,pose);
    // Held salvage sits where a held flashlight would: ahead and to the right.
    const held = box(0.24,1.28,-0.38,1,1,1,steel,pose);
    held.name = 'held'; held.visible = false;
    people.set(id,g); return g;
  }
  // The Bell Diver clings to the ceiling: a bell, mouth down, gripping with
  // six limbs spread along the ceiling, six tines hanging from its rim, and two
  // faint red glints in its mouth that a glance upward can catch in the dark.
  // `diver` sits at its hook on the ceiling; `swing` tilts its lower body
  // back while it drags itself along; `body` lowers on its chain to strike
  // and climbs back.
  const diver = new T.Group(), swing = new T.Group(), body = new T.Group();
  swing.rotation.order = 'YXZ';
  diver.add(swing); swing.add(body); scene.add(diver); diver.visible = false;
  // The chain it hangs from, paid out link by link as it falls.
  const linkStep = 0.13, chain = new T.InstancedMesh(new T.TorusGeometry(0.055,0.016,6,10),
    new T.MeshStandardMaterial({color:0x2c2a27,metalness:0.85,roughness:0.4}),90);
  chain.count = 0; chain.frustumCulled = false; diver.add(chain);
  const linkPose = new T.Object3D();
  const hide = new T.MeshStandardMaterial({color:0x0b0909,roughness:0.3,metalness:0.4,side:T.DoubleSide});
  const glintMat = new T.MeshBasicMaterial({color:0x5a120c});
  const bell = new T.Mesh(new T.ConeGeometry(0.55,0.7,10,1,true),hide);
  bell.position.y = -0.35; body.add(bell);
  const limbs: T.Group[] = [], tines: T.Mesh[] = [];
  for (let i=0;i<6;i++) {
    // Each limb pivots where it joins the bell, so it can fold down.
    const grip = new T.Group(); grip.rotation.y = i*Math.PI/3+Math.PI/6; body.add(grip);
    const limb = new T.Group(); limb.position.y = -0.06; grip.add(limb); limbs.push(limb);
    box(0,0,-0.6,0.07,0.06,1.1,hide,limb);
    const angle = i*Math.PI/3, x = Math.cos(angle), z = Math.sin(angle);
    // Each tine hangs from its top, so scaling it lengthens it downward.
    const pivot = new T.Group(); pivot.position.set(x*0.5,-0.62,z*0.5); body.add(pivot);
    const tine = box(0,-0.6,0,0.07,1.2,0.07,hide,pivot);
    tines.push(tine);
  }
  for (const x of [-0.13,0.13]) box(x,-0.6,0.05,0.06,0.03,0.06,glintMat,body);
  // Tines hang 1.2 m below the rim, shortened under low ceilings so they
  // stay above head height.
  const rim = 0.62, tineLength = 1.2;
  const torch = new T.Group(); torch.rotation.order = 'YXZ'; scene.add(torch);
  const barrel = new T.Mesh(new T.CylinderGeometry(0.085,0.064,0.32,12),yellow);
  barrel.rotation.x = -Math.PI/2; torch.add(barrel);
  const head = new T.Mesh(new T.CylinderGeometry(0.13,0.082,0.12,16),dark);
  head.rotation.x = -Math.PI/2; head.position.z = -0.19; torch.add(head);
  const lensMat = new T.MeshBasicMaterial();
  const lens = new T.Mesh(new T.CircleGeometry(0.105,16),lensMat);
  lens.rotation.y = Math.PI; lens.position.z = -0.252; torch.add(lens);
  const beam = new T.SpotLight(0xffe2a3,85,17,0.43,0.55,1.4);
  // A SpotLight starts at (0, 1, 0). Put it at the flashlight itself, which the
  // simulation keeps clear of walls, so the beam never starts inside one.
  beam.position.set(0,0,0); beam.target.position.set(0,0,-4); torch.add(beam,beam.target);
  // A faint visible cone makes the direction readable to the other observer.
  const cone = new T.Mesh(new T.ConeGeometry(0.47,2.2,24,1,true),new T.MeshBasicMaterial({
    color: 0xffdd98, transparent: true, opacity: 0.045, depthWrite: false, side: T.DoubleSide,
  }));
  cone.position.z = -1.36; cone.rotation.x = Math.PI/2; torch.add(cone);
  camera.position.set(-0.7,1.59,3); camera.rotation.x = -0.12;
  // A thrown item's clock: when this client first saw its flight, so it can
  // replay the host's arc smoothly between snapshots.
  const flights = new Map<string,{key: string; start: number}>();
  function flown(id: string, f: Flight, now: number) {
    const key = [f.x,f.y,f.z,f.vx,f.vy,f.vz].join();
    let clock = flights.get(id);
    if (!clock || clock.key !== key) flights.set(id,clock = {key,start:now-f.t*1000});
    // Never fall more than a tenth of a second behind the host.
    if ((now-clock.start)/1000 < f.t-0.1) clock.start = now-f.t*1000;
    return Math.min(f.d,(now-clock.start)/1000);
  }
  // Where a thrown item is now, as its centre, from the shared flight rules.
  function inFlight(g: Geometry, opened: readonly string[], id: string, f: Flight, kind: ItemKind | 'lamp', rest: {x: number; y: number; z: number}, now: number) {
    const path = trajectory(g,opened,f,bodyOf(kind),rest), t = flown(id,f,now);
    // Stopped by the Bell Diver: it drops from where it struck to its rest spot.
    if (f.cut !== undefined && t > f.cut) {
      const at = positionAt(path,f.cut), u = t-f.cut, h = bodyOf(kind).h, k = Math.min(1,u/Math.max(1e-3,f.d-f.cut));
      return {x:at.x+(rest.x-at.x)*k,y:Math.max(rest.y+h,at.y-gravity*u*u/2),z:at.z+(rest.z-at.z)*k,t};
    }
    return {...positionAt(path,t),t};
  }
  // Each kind's hotbar picture, rendered once in a small off-screen scene.
  let previewImages: Record<string,string> | undefined;
  function previews() {
    if (previewImages) return previewImages;
    const size = 96, target = new T.WebGLRenderTarget(size,size), stage = new T.Scene();
    const lens2 = new T.PerspectiveCamera(30,1,0.1,10);
    lens2.position.set(1.25,1,1.25); lens2.lookAt(0,0,0);
    stage.add(new T.HemisphereLight(0xffffff,0x5a5048,2.4));
    const key = new T.DirectionalLight(0xffffff,2.2); key.position.set(2,3,1); stage.add(key);
    const pixels = new Uint8Array(size*size*4), canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    // Render targets hold linear colour; encode it as sRGB for the image.
    const encode = (v: number) => { const c = v/255; return 255*(c <= 0.0031308 ? c*12.92 : 1.055*c**(1/2.4)-0.055); };
    function shoot(object: T.Object3D) {
      stage.add(object);
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000,0); renderer.clear();
      renderer.render(stage,lens2);
      renderer.readRenderTargetPixels(target,0,0,size,size,pixels);
      renderer.setRenderTarget(null);
      stage.remove(object);
      const image = ctx.createImageData(size,size);
      for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
        const from = ((size-1-y)*size+x)*4, to = (y*size+x)*4;
        for (let c=0;c<3;c++) image.data[to+c] = encode(pixels[from+c]);
        image.data[to+3] = pixels[from+3];
      }
      ctx.putImageData(image,0,0);
      return canvas.toDataURL();
    }
    const out: Record<string,string> = {};
    for (const kind of Object.keys(itemKinds) as ItemKind[]) {
      const [w,h,d] = itemKinds[kind].size, fit = 0.75/Math.max(w,h,d);
      const mesh = new T.Mesh(cube,itemMaterial(kind));
      mesh.scale.set(w*fit,h*fit,d*fit); mesh.rotation.y = 0.35;
      out[kind] = shoot(mesh);
    }
    const light = new T.Group();
    for (const part of [barrel,head,lens]) light.add(part.clone());
    light.scale.setScalar(2.2); light.rotation.set(0.2,0.8,0);
    out.lamp = shoot(light);
    target.dispose();
    renderer.setClearColor(0x000000,1);
    return previewImages = out;
  }
  let previousOwner: number | null | undefined, previousFlight = false;
  let portals: PortalGraph | undefined;
  // Remote operators and a flashlight they carry move once per snapshot, up
  // to 100 ms apart for a guest. Glide from where each was drawn to its new
  // position over one snapshot interval instead of jumping.
  interface Track { from: T.Vector3; to: T.Vector3; at: number; span: number; update: number }
  const tracks = new Map<string,Track>();
  function glide(key: string, update: number, x: number, y: number, z: number, now: number, shown?: T.Vector3) {
    let track = tracks.get(key);
    const target = new T.Vector3(x,y,z);
    if (!track || track.to.distanceTo(target) > 3) {
      track = {from:target.clone(),to:target,at:now,span:100,update};
      tracks.set(key,track);
    } else if (update !== track.update && !track.to.equals(target)) {
      track.span = Math.max(16,Math.min(250,now-track.at));
      track.from = shown ? shown.clone() : track.to.clone();
      track.to = target; track.at = now; track.update = update;
    } else track.update = update;
    return track.from.clone().lerp(track.to,Math.min(1,(now-track.at)/track.span));
  }
  const viewProjection = new T.Matrix4();
  const stats = {scale:1, drawn:0, rooms:0, calls:0};
  // Lower the render resolution while frames run slow, and restore it after a
  // spell of quick frames. Each step down doubles the wait before stepping up,
  // so a device near its limit settles instead of flickering between sizes.
  let average = 1/60, slow = 0, quick = 0, patience = 3;
  function adapt(dt: number) {
    // Frame times alternate between vsync steps, so judge a moving average.
    average += (dt-average)*0.1;
    if (average > 0.026) { slow += dt; quick = 0; }
    else if (average < 0.018) { quick += dt; slow = 0; }
    else slow = quick = 0;
    let scale = stats.scale;
    if (slow > 1 && scale > 0.5) { scale = Math.max(0.5,scale*0.85); patience = Math.min(30,patience*2); }
    else if (quick > patience && scale < 1) scale = Math.min(1,scale/0.85);
    else return;
    slow = quick = 0;
    stats.scale = scale;
    renderer.setPixelRatio(fullRatio*scale);
    renderer.setSize(innerWidth,innerHeight,false);
  }
  // Each place has its own sky, fog and light. The facility keeps the look it
  // always had; outdoors is a moonlit night; home is a violet void.
  // Outdoors sees farther: the façade must show from the arrival rift.
  const looks: Record<Place,{background: number; fog: number; density: number; sky: number; skyGround: number; skyLevel: number; moon: number; moonLevel: number; far: number}> = {
    inside:{background:0x263331,fog:0x273532,density:0.043,sky:0xc0e0dc,skyGround:0x605648,skyLevel:1.28,moon:0xe2d8b7,moonLevel:1,far:48},
    outside:{background:0x141d26,fog:0x18222b,density:0.017,sky:0x7f95b3,skyGround:0x3a352c,skyLevel:1.05,moon:0xb3c6ea,moonLevel:0.95,far:110},
    home:{background:0x120d1c,fog:0x161023,density:0.035,sky:0xb7a6e6,skyGround:0x3a2f45,skyLevel:1.1,moon:0xd8c8ff,moonLevel:0.6,far:48},
  };
  let looked: Place | undefined;
  function look(place: Place) {
    if (place === looked) return;
    looked = place;
    const l = looks[place];
    (scene.background as T.Color).setHex(l.background);
    (scene.fog as T.FogExp2).color.setHex(l.fog); (scene.fog as T.FogExp2).density = l.density;
    sky.color.setHex(l.sky); sky.groundColor.setHex(l.skyGround); sky.intensity = l.skyLevel;
    skylight.color.setHex(l.moon); skylight.intensity = l.moonLevel;
    camera.far = l.far; camera.updateProjectionMatrix();
  }
  let homeWorld: ReturnType<typeof buildHome> | undefined;
  let outside: ReturnType<typeof buildOutdoors> | undefined;
  // Salvage lying outdoors or at home: a few meshes, made as needed.
  const loose = new Map<string,T.Mesh>();
  // The Diver's timers arrive once per snapshot; count them down locally in
  // between so its drag and fall move smoothly.
  let diverClock = {update:-1,mode:'',seconds:0,travel:0,at:0};
  let tilt = 0, tiltSpeed = 0, heading = 0;
  const ceiling = (r: Layout['rooms'][number]) => r.y+roomTemplates[r.template].height-0.03;
  // Its drag from where it was: along the ceiling to the doorway, through
  // the wiring above it, and on to where it settles.
  function dragPath(layout: Layout, creature: Diver, room: Layout['rooms'][number]) {
    const from = creature.from!, start = layout.rooms.find(r => r.id === from.bay) ?? room;
    const a = new T.Vector3(from.x,ceiling(start),from.z), b = new T.Vector3(creature.x!,ceiling(room),creature.z!);
    const link = layout.passages.find(l => (l.a === from.bay && l.b === room.id) || (l.b === from.bay && l.a === room.id));
    const door = link && socketAt(layout.rooms.find(r => r.id === link.a)!,link.from);
    return door ? [a,new T.Vector3(door.x,a.y,door.z),new T.Vector3(door.x,b.y,door.z),b] : [a,b];
  }
  function along(points: T.Vector3[], f: number) {
    const lengths = points.slice(1).map((p,i) => p.distanceTo(points[i])), total = lengths.reduce((x,y) => x+y,0);
    let left = f*total;
    for (let i=0;i<lengths.length;i++) {
      if (left <= lengths[i] || i === lengths.length-1) {
        const t = lengths[i] ? Math.min(1,left/lengths[i]) : 1;
        return {at:points[i].clone().lerp(points[i+1],t),dir:points[i+1].clone().sub(points[i])};
      }
      left -= lengths[i];
    }
    return {at:points.at(-1)!.clone(),dir:new T.Vector3()};
  }
  function poseDiver(layout: Layout, room: Layout['rooms'][number], creature: Diver, mission: NonNullable<Snapshot['mission']>, update: number, now: number, dt: number, reducedMotion: boolean) {
    if (update !== diverClock.update) diverClock = {update,mode:creature.mode,seconds:creature.seconds,travel:creature.travel ?? 0,at:now};
    const elapsed = (now-diverClock.at)/1000;
    const seconds = Math.max(0,diverClock.seconds-elapsed), travelling = Math.max(0,diverClock.travel-elapsed);
    const p = pace(mission), top = ceiling(room), a = anchor(room);
    const floor = creature.y ?? a.y, time = now/1000;
    const reach = Math.max(0.3,Math.min(1,(top-floor-2.1-rim)/tineLength));
    // Dragging between spots: its lower body trails behind it.
    let moving = false;
    if (creature.from && creature.travel !== undefined && travelling > 0) {
      const f = 1-travelling/p.travel, eased = f*f*(3-2*f);
      const {at,dir} = along(dragPath(layout,creature,room),Math.max(0,Math.min(1,eased)));
      diver.position.copy(at);
      if (Math.hypot(dir.x,dir.z) > 1e-3) heading = Math.atan2(-dir.x,-dir.z);
      moving = true;
    } else diver.position.set(creature.x ?? a.x,top,creature.z ?? a.z);
    // A damped swing: tilted back while dragging, settling once it stops.
    const want = moving && !reducedMotion ? -0.45 : 0;
    tiltSpeed += ((want-tilt)*40-tiltSpeed*5)*dt; tilt += tiltSpeed*dt;
    if (reducedMotion) { tilt = 0; tiltSpeed = 0; }
    swing.rotation.set(tilt,heading,0);
    // Lowered on its chain: a quick fall, a pause on the floor, a slow climb.
    const depth = Math.max(0,top-floor-rim-tineLength*reach);
    let lowered = 0;
    if (creature.mode === 'falling') { const f = 1-seconds/p.fall; lowered = depth*Math.min(1,f*f); }
    else if (creature.mode === 'strike') lowered = depth;
    else if (creature.mode === 'rising') { const f = Math.min(1,seconds/p.rise); lowered = depth*f*f*(3-2*f); }
    body.position.y = -lowered;
    chain.count = lowered > 0.05 ? Math.min(90,Math.floor(lowered/linkStep)) : 0;
    for (let k=0;k<chain.count;k++) {
      linkPose.position.set(0,-k*linkStep-linkStep/2,0);
      linkPose.rotation.set(0,k%2 ? Math.PI/2 : 0,0);
      linkPose.scale.set(1,1.5,1);
      linkPose.updateMatrix(); chain.setMatrixAt(k,linkPose.matrix);
    }
    chain.instanceMatrix.needsUpdate = true;
    // Its tines reach down and twitch faster as the drop nears, and its
    // glints brighten. Stunned, it shudders, then hangs limp and dark.
    const falling = creature.mode === 'falling' || creature.mode === 'strike';
    const stunned = creature.stun !== undefined, jolt = stunned ? Math.max(0,creature.stun!-(stunTime-0.7))/0.7 : 0;
    const urgency = stunned ? 0 : falling ? 1 : creature.drop === undefined ? 0 : 1-Math.max(0,creature.drop)/p.wait;
    tines.forEach((t,i) => {
      const pivot = t.parent!;
      const limp = stunned ? 0.25 : 1;
      pivot.rotation.x = Math.sin(time*(1.3+9*urgency)+i*1.7)*(0.06+0.3*urgency)*limp;
      pivot.rotation.z = Math.cos(time*(1.1+8*urgency)+i*2.3)*(0.06+0.3*urgency)*limp;
      pivot.scale.y = reach*(1+0.5*urgency*Number(!falling));
    });
    if (!reducedMotion) swing.rotation.z = Math.sin(time*38)*0.18*jolt;
    // Limbs grip the ceiling, and fold down into legs once it lets go.
    const fold = lowered > 0.3 ? -1.1 : 0;
    limbs.forEach((l,i) => { l.rotation.x += (fold+Math.sin(time*0.7+i)*0.04-l.rotation.x)*Math.min(1,dt*12); });
    if (stunned) glintMat.color.setRGB(0.06,0.02,0.02);
    else glintMat.color.setRGB(0.35+0.65*urgency,0.07+0.1*urgency,0.05);
  }
  // `self` is whose eyes the camera looks through: your own operator, or the
  // partner a dead operator is watching.
  function render(state: Snapshot | undefined, self: number, yaw: number, pitch: number, dt: number, layout?: Layout, reducedMotion = false, watching = false) {
    const me = state?.players.find(p => p.id === self);
    // Without a contract everything is inside, as it always was.
    const here: Place | undefined = !state?.mission ? (layout ? 'inside' : undefined) : me ? placeOf(me) : undefined;
    if (generated && here) look(here);
    // Build only the place this camera is in. Home drops the expedition.
    if (here === 'home') {
      facility?.dispose(); facility = undefined; loaded = undefined; portals = undefined;
      outside?.dispose(); outside = undefined;
    }
    if (layout && here === 'inside' && (layout !== loaded || !facility)) {
      facility?.dispose();
      facility = buildFacility(layout,library!);
      scene.add(facility.root);
      portals = portalGraph(layout,geometryFor(layout));
      loaded = layout;
    }
    if (layout && state?.mission && here === 'outside' && outside?.seed !== layout.seed) {
      outside?.dispose();
      outside = buildOutdoors(outdoors(layout.seed),library!);
      scene.add(outside.root);
    }
    if (here === 'home' && !homeWorld && library) { homeWorld = buildHome(library); scene.add(homeWorld.root); }
    if (facility) facility.root.visible = here === 'inside';
    if (outside) outside.root.visible = here === 'outside';
    if (homeWorld) homeWorld.root.visible = here === 'home';
    // Which places are held in memory, for tests: at home, only the home dimension.
    const built = [homeWorld && 'home',outside && 'outside',facility && 'inside'].filter(Boolean).join(' ');
    if (canvas.dataset.built !== built) canvas.dataset.built = built;
    const time = performance.now()/1000;
    homeWorld?.update(time);
    outside?.update(time,state?.mission?.arrival === 'open',state?.mission?.rift,state?.mission?.bell !== undefined);
    if (!document.hidden) adapt(dt);
    if (facility && state) facility.update(state.opened ?? []);
    if (state) {
      // The geometry of a place, for held items and thrown ones.
      const placeGeometry = (place: Place): Geometry | undefined => place === 'home' ? home().geometry :
        place === 'outside' ? layout && outdoors(layout.seed).geometry : layout && geometryFor(layout);
      const sameHere = (thing: {place?: Place}) => !state.mission || placeOf(thing) === here;
      const blend = 1 - Math.exp(-18 * dt);
      const creature = state.mission?.diver;
      const room = creature && creature.mode !== 'dormant' ? layout?.rooms.find(r => r.id === creature.bay) : undefined;
      diver.visible = here === 'inside' && !!room;
      const salvageKind = new Map(layout && state.mission ? spawnSalvage(layout).map(s => [s.id,s.kind]) : []);
      const heldKind = (p: Snapshot['players'][number]) => {
        const item = selected(p);
        return item && item !== lampSlot ? salvageKind.get(item) : undefined;
      };
      for (const p of state.players) {
        const down = state.mission?.down.some(d => d.id === p.id);
        const dead = !!state.mission?.dead?.includes(p.id);
        if (p.id === self) {
          // No body for whoever the camera looks through. One drawn earlier
          // (a partner you now watch, or your own body before the next
          // expedition) would otherwise stay frozen where it was last seen.
          const body = people.get(p.id);
          if (body) body.visible = false;
          // Your own held salvage, kept clear of walls like a held flashlight.
          const kind = down || dead ? undefined : heldKind(p);
          // Smaller and lower than the partner sees it, so it doesn't fill the view.
          holdItem(inHand,kind,0.55);
          const eyeHeight=(p.feetY??0)+(dead ? 0.3 : down && !reducedMotion ? 0.45 : 1.59);
          if (watching) {
            // A partner's position arrives once per snapshot: glide between them.
            camera.position.copy(glide('view'+p.id,state.update,p.x,eyeHeight,p.z,performance.now(),camera.position));
          } else {
            camera.position.y = reducedMotion ? eyeHeight : T.MathUtils.lerp(camera.position.y,eyeHeight,blend);
            camera.position.x = T.MathUtils.lerp(camera.position.x,p.x,blend);
            camera.position.z = T.MathUtils.lerp(camera.position.z,p.z,blend);
          }
          camera.rotation.set(pitch,yaw,0,'YXZ');
          // Held from where the camera is and where it looks, not from the
          // simulation's stepped position, so it stays steady in the hand.
          if (kind) {
            const g = placeGeometry(placeOf(p));
            const solids = g ? obstaclesAt(g,p.feetY ?? 0,placeOf(p) === 'inside' ? state.opened : []) : walls;
            const at = heldLamp({...p,x:camera.position.x,z:camera.position.z,yaw},solids);
            inHand.position.set(at.x,camera.position.y-1.59+1.18,at.z); inHand.rotation.set(0,yaw,0);
          }
        } else {
          let g = people.get(p.id);
          if (!g) { g = avatar(p.id); g.position.set(p.x,p.feetY ?? 0,p.z); }
          g.scale.y = down && !dead ? 0.35 : 1;
          // A dead operator lies face down where they fell.
          const pose = g.getObjectByName('pose')!;
          pose.rotation.x = dead ? -Math.PI/2 : 0;
          pose.position.set(0,dead ? 0.18 : 0,dead ? 0.9 : 0);
          holdItem(g.getObjectByName('held') as T.Mesh,down || dead ? undefined : heldKind(p));
          // Someone in another place jumps rather than glides when they come back.
          if (!sameHere(p)) tracks.delete('p'+p.id);
          g.position.copy(glide('p'+p.id,state.update,p.x,p.feetY ?? 0,p.z,performance.now(),g.position));
          g.visible = sameHere(p);
          g.rotation.y += Math.atan2(Math.sin(p.yaw-g.rotation.y),Math.cos(p.yaw-g.rotation.y))*blend;
        }
      }
      for (const [id,g] of people) if (!state.players.some(p => p.id === id)) { scene.remove(g); people.delete(id); }
      const l = state.lamp;
      const t = previousOwner === l.owner ? blend : 1;
      const now = performance.now();
      const lampWorld = placeGeometry(placeOf(l));
      torch.visible = sameHere(l);
      if (l.flight && lampWorld) {
        // A thrown flashlight tumbles end over end, still lit.
        const at = inFlight(lampWorld,placeOf(l) === 'inside' ? state.opened ?? [] : [],'lamp',l.flight,'lamp',{x:l.x,y:l.y-0.14,z:l.z},now);
        torch.position.set(at.x,at.y,at.z);
        torch.rotation.x = -at.t*9;
        tracks.delete('lamp');
      } else if (l.owner !== null && (l.owner !== self || watching) && previousOwner === l.owner) {
        torch.position.copy(glide('lamp',state.update,l.x,l.y,l.z,performance.now(),torch.position));
      } else {
        tracks.delete('lamp');
        torch.position.lerp(new T.Vector3(l.x,l.y,l.z),t);
      }
      torch.rotation.y += Math.atan2(Math.sin(l.yaw-torch.rotation.y),Math.cos(l.yaw-torch.rotation.y))*t;
      if (!l.flight) torch.rotation.x += (l.pitch-torch.rotation.x)*(previousFlight ? 1 : t);
      previousFlight = !!l.flight;
      // Clipped to the chest, the beam is shorter and dimmer. Its holder
      // doesn't see the flashlight itself, only its light.
      const stowed = !!l.stowed && l.owner !== null;
      beam.intensity = stowed ? 32 : 85; beam.distance = stowed ? 10 : 17; beam.angle = stowed ? 0.5 : 0.43;
      (cone.material as T.MeshBasicMaterial).opacity = stowed ? 0.02 : 0.045;
      barrel.visible = head.visible = lens.visible = !(stowed && l.owner === self);
      beam.visible = l.on; cone.visible = l.on && !(stowed && l.owner === self);
      lensMat.color.setHex(l.on ? 0xffe7a6 : 0x646951);
      previousOwner = l.owner;
      // Draw the camera's room and the rooms visible through its doorways.
      if (facility && layout && portals) {
        const g = geometryFor(layout), me = state.players.find(p => p.id === self);
        const feet = me?.feetY ?? 0;
        const start = surfaceAt(g,camera.position.x,camera.position.z,feet)?.room ?? (me && surfaceAt(g,me.x,me.z,feet)?.room);
        let drawn: Set<string> | undefined;
        if (start) {
          camera.updateMatrixWorld();
          viewProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
          drawn = visibleRooms(portals,start,viewProjection.elements,camera.position,state.opened ?? [],camera.far);
        }
        facility.show(drawn);
        stats.drawn = drawn?.size ?? facility.rooms; stats.rooms = facility.rooms;
        const shown = (x: number,z: number,y: number) => !drawn || drawn.has(surfaceAt(g,x,z,y)?.room ?? '');
        for (const p of state.players) {
          const g2 = people.get(p.id);
          if (g2) g2.visible = p.id !== self && sameHere(p) && shown(p.x,p.z,p.feetY ?? 0);
        }
        // While it drags itself out of a room, it shows from that room too.
        if (diver.visible && drawn && room) diver.visible = drawn.has(room.id) || (!!creature?.from && drawn.has(creature.from.bay));
        // Pose the Diver only while it is drawn.
        if (diver.visible && room && creature && state.mission) poseDiver(layout,room,creature,state.mission,state.update,now,dt,reducedMotion);
        const mission = state.mission;
        if (mission) {
          // Salvage lying in the facility; carried items are drawn in hand.
          facility.salvage(items(layout,mission).filter(i => i.owner === null && i.place === 'inside').map(i => {
            if (i.flight) {
              const at = inFlight(g,state.opened ?? [],i.id,i.flight,i.kind,i,now), [,h] = itemKinds[i.kind].size;
              // Cull it with the room whose floor is below it.
              let under: string | undefined, top = -Infinity;
              for (const f of g.surfaces) {
                if (Math.abs(at.x-f.x) > f.w/2 || Math.abs(at.z-f.z) > f.d/2 || f.y > at.y || f.y < top) continue;
                top = f.y; under = f.room;
              }
              return {...i,x:at.x,y:at.y-h/2,z:at.z,room:under ?? i.room};
            }
            const moved = mission.haul.some(h => h.id === i.id);
            return {...i,room:moved ? surfaceAt(g,i.x,i.z,i.y)?.room ?? i.room : i.room};
          }));
        }
      }
    }
    if (state?.mission && layout && here) {
      // Salvage lying in this place outside the facility.
      const mission = state.mission, wanted = new Set<string>();
      if (here !== 'inside') {
        const g = here === 'home' ? home().geometry : outdoors(layout.seed).geometry;
        for (const i of items(layout,mission)) {
          // Banked salvage is drawn only while it flies into the rift.
          if (i.owner !== null || (i.banked && !i.flight) || i.place !== here) continue;
          let mesh = loose.get(i.id);
          if (!mesh) { mesh = new T.Mesh(cube,itemMaterial(i.kind)); loose.set(i.id,mesh); scene.add(mesh); }
          const [w,h,d] = itemKinds[i.kind].size;
          const at = i.flight ? inFlight(g,[],i.id,i.flight,i.kind,i,performance.now()) : {x:i.x,y:i.y+h/2,z:i.z};
          mesh.position.set(at.x,at.y,at.z); mesh.scale.set(w,h,d); mesh.rotation.y = (i.x*7+i.z*3)%Math.PI;
          wanted.add(i.id);
        }
      }
      for (const [id,mesh] of loose) if (!wanted.has(id)) { scene.remove(mesh); loose.delete(id); }
      if (here === 'home' && homeWorld) {
        const c = mission.contract, last = c.receipts.at(-1);
        homeWorld.terminal(['SALVAGE CONTRACT','Quota  '+c.credited+' / '+c.quota,'Expedition  '+(c.index+1)+' / '+c.expeditions,
          ...(last ? ['Last sale  '+last.credited,...last.items.slice(0,3).map(i => '+ '+itemName(i.kind)+'  '+i.value)] : ['Step into the rift to begin'])]);
      }
      stats.drawn = here === 'inside' ? stats.drawn : 0;
    }
    renderer.render(scene,camera);
    stats.calls = renderer.info.render.calls;
  }
  function resize() {
    renderer.setSize(innerWidth,innerHeight,false);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  }
  resize(); window.addEventListener('resize',resize);
  return Object.assign(render,{stats,previews});
}
