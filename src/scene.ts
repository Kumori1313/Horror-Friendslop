import * as T from 'three';
import { strikeRadius } from './mission.ts';
import { buildFacility } from './facility-scene.ts';
import { anchor, geometryFor, type Layout } from './layout.ts';
import { surfaceAt } from './room-templates.ts';
import { portalGraph, visibleRooms, type PortalGraph } from './visibility.ts';
import { walls } from './room.ts';
import type { Snapshot } from './room.ts';

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
  scene.add(new T.HemisphereLight(0xc0e0dc,0x605648,1.28));
  if (generated) {
    const skylight = new T.DirectionalLight(0xe2d8b7,1);
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
  function avatar(id: number) {
    const g = new T.Group(); scene.add(g);
    const suit = material(id === 1 ? 0xa76531 : 0x487b79);
    box(0,1.05,0,0.44,0.62,0.29,suit,g);
    box(0,1.65,0,0.34,0.35,0.32,dark,g);
    box(0,1.66,-0.16,0.28,0.09,0.04,teal,g);
    for (const x of [-0.13,0.13]) box(x,0.39,0,0.18,0.78,0.22,dark,g);
    for (const x of [-0.28,0.28]) box(x,1.01,-0.04,0.13,0.54,0.16,suit,g);
    box(0,1.23,0,0.45,0.055,0.30,yellow,g);
    people.set(id,g); return g;
  }
  // The diver hangs from the ceiling bell, then folds its tines down to the floor.
  const diver = new T.Group();
  const tines = new T.Group();
  const alarm = new T.MeshBasicMaterial({color:0xff6445});
  const bell = new T.Mesh(new T.ConeGeometry(0.58,0.65,10),material(0x463832));
  bell.position.y = 0.7;
  const ring = new T.Mesh(new T.RingGeometry(strikeRadius-0.08,strikeRadius,64),
    new T.MeshBasicMaterial({color:0xff774e,side:T.DoubleSide}));
  ring.rotation.x = -Math.PI/2; ring.position.y = 0.025;
  tines.add(bell);
  for (let i=0;i<6;i++) {
    const angle = i*Math.PI/3, x = Math.cos(angle), z = Math.sin(angle);
    const tine = box(x*0.43,-0.07,z*0.43,0.095,1.3,0.095,dark,tines);
    tine.rotation.z = z*0.16; tine.rotation.x = x*0.16;
    box(x*0.48,0.38,z*0.48,0.13,0.09,0.13,alarm,tines);
  }
  diver.add(tines,ring); scene.add(diver); diver.visible = false;
  const torch = new T.Group(); torch.rotation.order = 'YXZ'; scene.add(torch);
  const barrel = new T.Mesh(new T.CylinderGeometry(0.085,0.064,0.32,12),yellow);
  barrel.rotation.x = -Math.PI/2; torch.add(barrel);
  const head = new T.Mesh(new T.CylinderGeometry(0.13,0.082,0.12,16),dark);
  head.rotation.x = -Math.PI/2; head.position.z = -0.19; torch.add(head);
  const lensMat = new T.MeshBasicMaterial();
  const lens = new T.Mesh(new T.CircleGeometry(0.105,16),lensMat);
  lens.rotation.y = Math.PI; lens.position.z = -0.252; torch.add(lens);
  const beam = new T.SpotLight(0xffe2a3,85,17,0.43,0.55,1.4);
  beam.position.z = -0.26; beam.target.position.z = -4; torch.add(beam,beam.target);
  // A faint visible cone makes the direction readable to the other observer.
  const cone = new T.Mesh(new T.ConeGeometry(0.47,2.2,24,1,true),new T.MeshBasicMaterial({
    color: 0xffdd98, transparent: true, opacity: 0.045, depthWrite: false, side: T.DoubleSide,
  }));
  cone.position.z = -1.36; cone.rotation.x = Math.PI/2; torch.add(cone);
  camera.position.set(-0.7,1.59,3); camera.rotation.x = -0.12;
  let previousOwner: number | null | undefined;
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
  function render(state: Snapshot | undefined, self: number, yaw: number, pitch: number, dt: number, layout?: Layout, reducedMotion = false) {
    if (layout && layout !== loaded) {
      facility?.dispose();
      facility = buildFacility(layout,painted('#c6ccc6','#8e9890'));
      scene.add(facility.root);
      portals = portalGraph(layout,geometryFor(layout));
      loaded = layout;
    }
    if (!document.hidden) adapt(dt);
    if (facility && state) facility.update(state.opened ?? []);
    if (state) {
      const blend = 1 - Math.exp(-18 * dt);
      const creature = state.mission?.diver;
      const room = layout?.rooms.find(r => r.id === creature?.bay);
      const target = room && anchor(room);
      diver.visible = !!target && (creature?.mode === 'warning' || creature?.mode === 'strike');
      if (target && creature && diver.visible) {
        diver.position.set(target.x,target.y,target.z);
        tines.position.y = creature.mode === 'strike' ? 0.75 : 2.8+Math.cos(creature.seconds*7)*0.12;
        tines.rotation.y = creature.seconds*0.45;
      }
      for (const p of state.players) {
        const down = state.mission?.down.some(d => d.id === p.id);
        if (p.id === self) {
          const eyeHeight=(p.feetY??0)+(down && !reducedMotion ? 0.45 : 1.59);
          camera.position.y = reducedMotion ? eyeHeight : T.MathUtils.lerp(camera.position.y,eyeHeight,blend);
          camera.position.x = T.MathUtils.lerp(camera.position.x,p.x,blend);
          camera.position.z = T.MathUtils.lerp(camera.position.z,p.z,blend);
          camera.rotation.set(pitch,yaw,0,'YXZ');
        } else {
          let g = people.get(p.id);
          if (!g) { g = avatar(p.id); g.position.set(p.x,p.feetY ?? 0,p.z); }
          g.scale.y = down ? 0.35 : 1;
          g.position.copy(glide('p'+p.id,state.update,p.x,p.feetY ?? 0,p.z,performance.now(),g.position));
          g.rotation.y += Math.atan2(Math.sin(p.yaw-g.rotation.y),Math.cos(p.yaw-g.rotation.y))*blend;
        }
      }
      for (const [id,g] of people) if (!state.players.some(p => p.id === id)) { scene.remove(g); people.delete(id); }
      const l = state.lamp;
      const t = previousOwner === l.owner ? blend : 1;
      if (l.owner !== null && l.owner !== self && previousOwner === l.owner) {
        torch.position.copy(glide('lamp',state.update,l.x,l.y,l.z,performance.now(),torch.position));
      } else {
        tracks.delete('lamp');
        torch.position.lerp(new T.Vector3(l.x,l.y,l.z),t);
      }
      torch.rotation.y += Math.atan2(Math.sin(l.yaw-torch.rotation.y),Math.cos(l.yaw-torch.rotation.y))*t;
      torch.rotation.x += (l.pitch-torch.rotation.x)*t;
      beam.visible = cone.visible = l.on; lensMat.color.setHex(l.on ? 0xffe7a6 : 0x646951);
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
          if (g2) g2.visible = shown(p.x,p.z,p.feetY ?? 0);
        }
        if (diver.visible && drawn && room) diver.visible = drawn.has(room.id);
      }
    }
    renderer.render(scene,camera);
    stats.calls = renderer.info.render.calls;
  }
  function resize() {
    renderer.setSize(innerWidth,innerHeight,false);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  }
  resize(); window.addEventListener('resize',resize);
  return Object.assign(render,{stats});
}
