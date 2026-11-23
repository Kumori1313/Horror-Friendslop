import * as T from 'three';
import type { Kind } from './layout.ts';

// What a drawn box is: room shell parts come from the room's palette, while
// props keep their own colour over a metal, rust, painted or wooden surface.
export type Finish = 'wall' | 'floor' | 'ceiling' | 'grate' | 'ramp' | 'trim' | 'metal' | 'rust' | 'paint' | 'wood' | 'matte';
export type Surface = 'concrete' | 'plaster' | 'panel' | 'corrugated' | 'diamond' | 'grating' | 'rust' | 'tile' | 'brushed' | 'wood';

// `tile` is the size in metres that one texture repeat covers, so every
// surface keeps the same scale however long it is. Walls and floors that fill
// the screen catch the flashlight as specular highlights only; `reflect` marks
// the small brushed-steel props, trims and salvage that also sample the
// reflection map, which keeps the per-pixel cost down on phones.
export const surfaces: Record<Surface,{tile: number; metalness: number; roughness: number; reflect?: boolean}> = {
  concrete:{tile:2,metalness:0,roughness:0.95},
  plaster:{tile:2,metalness:0,roughness:0.9},
  panel:{tile:1.2,metalness:0.4,roughness:0.5},
  corrugated:{tile:1,metalness:0.45,roughness:0.45},
  diamond:{tile:0.6,metalness:0.5,roughness:0.4},
  grating:{tile:0.5,metalness:0.45,roughness:0.5},
  rust:{tile:1.5,metalness:0.25,roughness:0.8},
  tile:{tile:0.8,metalness:0,roughness:0.35},
  brushed:{tile:1,metalness:0.85,roughness:0.3,reflect:true},
  wood:{tile:1,metalness:0,roughness:0.85},
};

type Palette = {wall: Surface; floor: Surface; ceiling: Surface};
// Rooms read differently at a glance: tiled cold rooms, rusted plant rooms,
// corrugated halls, plastered offices, and plain concrete connectors.
export const palettes: Record<Kind,Palette> = {
  intake:{wall:'panel',floor:'diamond',ceiling:'panel'},
  relay:{wall:'panel',floor:'diamond',ceiling:'panel'},
  switchboard:{wall:'plaster',floor:'tile',ceiling:'concrete'},
  chiller:{wall:'corrugated',floor:'diamond',ceiling:'panel'},
  pump:{wall:'rust',floor:'concrete',ceiling:'rust'},
  stores:{wall:'corrugated',floor:'concrete',ceiling:'concrete'},
  closet:{wall:'plaster',floor:'concrete',ceiling:'plaster'},
  boiler:{wall:'rust',floor:'diamond',ceiling:'rust'},
  lockers:{wall:'tile',floor:'tile',ceiling:'plaster'},
  control:{wall:'plaster',floor:'tile',ceiling:'plaster'},
  coldstore:{wall:'tile',floor:'diamond',ceiling:'panel'},
  filters:{wall:'panel',floor:'concrete',ceiling:'panel'},
  generator:{wall:'corrugated',floor:'diamond',ceiling:'corrugated'},
  gallery:{wall:'rust',floor:'concrete',ceiling:'concrete'},
  office:{wall:'plaster',floor:'wood',ceiling:'plaster'},
  workshop:{wall:'concrete',floor:'concrete',ceiling:'corrugated'},
  tunnel:{wall:'concrete',floor:'concrete',ceiling:'concrete'},
  hall:{wall:'corrugated',floor:'concrete',ceiling:'panel'},
  stairwell:{wall:'concrete',floor:'concrete',ceiling:'concrete'},
  corridor:{wall:'concrete',floor:'concrete',ceiling:'panel'},
};

// Wall trims run along every wall, so they use plain steel panel and skip the
// reflection map; only props and salvage use reflective brushed steel.
const fixed: Partial<Record<Finish,Surface>> = {grate:'grating',ramp:'diamond',trim:'panel',metal:'brushed',rust:'rust',paint:'panel',wood:'wood'};
export function surfaceFor(kind: Kind, finish: Finish): Surface | undefined {
  if (finish === 'wall' || finish === 'floor' || finish === 'ceiling') return palettes[kind][finish];
  return fixed[finish];
}
// Shell parts take their look from the texture, lightly tinted by the room.
export const shellFinish = (finish: Finish) => finish === 'wall' || finish === 'floor' || finish === 'ceiling' || finish === 'grate' || finish === 'ramp';

// Texture coordinates in metres, projected along the face's main axis.
export function worldUV(x: number, y: number, z: number, nx: number, ny: number, nz: number): [number,number] {
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  if (ay >= ax && ay >= az) return [x,z];
  if (ax >= az) return [z,y];
  return [x,y];
}

function random(seed: number) {
  return () => ((seed = (Math.imul(seed,1664525)+1013904223) >>> 0)/4294967296);
}
type Draw = (g: CanvasRenderingContext2D, r: () => number, s: number) => void;
const speckle = (g: CanvasRenderingContext2D, r: () => number, s: number, count: number, light: string, dark: string) => {
  for (let i=0;i<count;i++) { g.fillStyle = r() < 0.5 ? light : dark; g.fillRect(r()*s,r()*s,1+r()*2.5,1+r()*2.5); }
};
const stains = (g: CanvasRenderingContext2D, r: () => number, s: number, count: number, color: string) => {
  for (let i=0;i<count;i++) {
    const x = r()*s, y = r()*s, rad = s*(0.08+r()*0.2);
    const grad = g.createRadialGradient(x,y,0,x,y,rad); grad.addColorStop(0,color); grad.addColorStop(1,'#0000');
    g.fillStyle = grad; g.fillRect(x-rad,y-rad,rad*2,rad*2);
  }
};
const draws: Record<Surface,Draw> = {
  concrete:(g,r,s) => {
    g.fillStyle = '#8d918a'; g.fillRect(0,0,s,s);
    speckle(g,r,s,4000,'#ffffff10','#00000018'); stains(g,r,s,5,'#3b3f3a30');
    g.strokeStyle = '#5f645e'; g.lineWidth = 2; g.strokeRect(1,1,s-2,s-2);
    for (const [x,y] of [[s*0.25,s*0.25],[s*0.75,s*0.25],[s*0.25,s*0.75],[s*0.75,s*0.75]]) { g.fillStyle = '#4c514b'; g.beginPath(); g.arc(x,y,3,0,7); g.fill(); }
  },
  plaster:(g,r,s) => {
    g.fillStyle = '#b4b5a6'; g.fillRect(0,0,s,s);
    speckle(g,r,s,2500,'#ffffff12','#00000010'); stains(g,r,s,4,'#6d6a5530');
    g.fillStyle = '#7f7f70'; g.fillRect(0,s*0.62,s,3);
  },
  panel:(g,r,s) => {
    g.fillStyle = '#7d8786'; g.fillRect(0,0,s,s);
    for (let y=0;y<s;y+=2) { g.fillStyle = r() < 0.5 ? '#ffffff0b' : '#0000000c'; g.fillRect(0,y,s,1); }
    g.strokeStyle = '#4a5352'; g.lineWidth = 3; g.strokeRect(1.5,1.5,s-3,s-3);
    g.fillStyle = '#a3adab';
    for (const x of [10,s/2,s-10]) for (const y of [10,s-10]) { g.beginPath(); g.arc(x,y,3,0,7); g.fill(); }
    stains(g,r,s,2,'#2d332f28');
  },
  corrugated:(g,r,s) => {
    for (let x=0;x<s;x++) {
      const l = 118+Math.round(40*Math.sin(x/s*Math.PI*8));
      g.fillStyle = 'rgb('+(l-6)+','+l+','+(l-2)+')'; g.fillRect(x,0,1,s);
    }
    speckle(g,r,s,1200,'#ffffff0e','#00000016'); stains(g,r,s,3,'#4a3b2a30');
  },
  diamond:(g,r,s) => {
    g.fillStyle = '#626b6a'; g.fillRect(0,0,s,s);
    const step = s/8;
    for (let i=0;i<8;i++) for (let j=0;j<8;j++) {
      const cx = (i+0.5)*step, cy = (j+0.5)*step, flip = (i+j)%2 ? 1 : -1;
      g.save(); g.translate(cx,cy); g.rotate(flip*Math.PI/4);
      g.fillStyle = '#9aa4a2'; g.fillRect(-step*0.32,-step*0.07,step*0.64,step*0.14);
      g.fillStyle = '#3f4747'; g.fillRect(-step*0.32,step*0.04,step*0.64,step*0.04);
      g.restore();
    }
    speckle(g,r,s,900,'#ffffff0c','#00000014');
  },
  grating:(g,r,s) => {
    g.fillStyle = '#151b1a'; g.fillRect(0,0,s,s);
    g.fillStyle = '#76807e';
    for (let i=0;i<s;i+=s/8) { g.fillRect(i,0,4,s); g.fillRect(0,i,s,3); }
    speckle(g,r,s,500,'#ffffff10','#00000020');
  },
  rust:(g,r,s) => {
    g.fillStyle = '#6f5240'; g.fillRect(0,0,s,s);
    stains(g,r,s,10,'#8c4f2a55'); stains(g,r,s,6,'#5a5f5c60'); speckle(g,r,s,5000,'#c07a4a18','#1b100a26');
  },
  tile:(g,r,s) => {
    g.fillStyle = '#7b847e'; g.fillRect(0,0,s,s);
    const step = s/4;
    for (let i=0;i<4;i++) for (let j=0;j<4;j++) {
      const l = 196+Math.round(r()*14);
      g.fillStyle = 'rgb('+(l-8)+','+l+','+(l-4)+')'; g.fillRect(i*step+2,j*step+2,step-4,step-4);
    }
    stains(g,r,s,3,'#56503a30');
  },
  brushed:(g,r,s) => {
    g.fillStyle = '#9ea7a5'; g.fillRect(0,0,s,s);
    for (let y=0;y<s;y++) { g.fillStyle = r() < 0.5 ? '#ffffff12' : '#00000012'; g.fillRect(0,y,s,1); }
    speckle(g,r,s,300,'#ffffff18','#0000001a');
  },
  wood:(g,r,s) => {
    const plank = s/4;
    for (let i=0;i<4;i++) {
      g.fillStyle = ['#6b5137','#735840','#654c33','#6f5539'][i]; g.fillRect(0,i*plank,s,plank);
      for (let k=0;k<40;k++) { g.fillStyle = '#00000014'; g.fillRect(r()*s,i*plank+r()*plank,s*(0.2+r()*0.5),1); }
      g.fillStyle = '#2e2216'; g.fillRect(0,i*plank,s,2);
    }
  },
};

// One shared material per surface, plus untextured and glowing materials.
// The textures are generated once and reused by every facility.
export function materialLibrary(anisotropy: number, reflections?: T.Texture) {
  const made = new Map<Surface,T.MeshStandardMaterial>();
  (Object.keys(surfaces) as Surface[]).forEach((key,index) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    draws[key](canvas.getContext('2d')!,random(1234+index*977),256);
    const map = new T.CanvasTexture(canvas);
    map.wrapS = map.wrapT = T.RepeatWrapping; map.colorSpace = T.SRGBColorSpace; map.anisotropy = anisotropy;
    const {tile,metalness,roughness,reflect} = surfaces[key];
    map.repeat.set(1/tile,1/tile);
    made.set(key,new T.MeshStandardMaterial({vertexColors:true,map,metalness,roughness,envMap:reflect ? reflections ?? null : null}));
  });
  const matte = new T.MeshStandardMaterial({vertexColors:true,roughness:0.86});
  const glow = new T.MeshStandardMaterial({vertexColors:true,roughness:0.86});
  glow.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance = vColor.rgb * 0.55;');
  };
  return {surfaces:made,matte,glow,reflections};
}
export type Library = ReturnType<typeof materialLibrary>;

// A dim industrial room, blurred into a reflection map once. Metal picks up
// faint strip lights and the flashlight's own glints without live reflections.
export function environment(renderer: T.WebGLRenderer) {
  const scene = new T.Scene();
  const shell = new T.Mesh(new T.BoxGeometry(20,8,20),new T.MeshBasicMaterial({color:0x111816,side:T.BackSide}));
  scene.add(shell);
  for (const x of [-5,0,5]) {
    const strip = new T.Mesh(new T.BoxGeometry(0.4,0.1,6),new T.MeshBasicMaterial({color:0x7d8a80}));
    strip.position.set(x,3.9,0); scene.add(strip);
  }
  const floor = new T.Mesh(new T.PlaneGeometry(20,20),new T.MeshBasicMaterial({color:0x1d2320}));
  floor.rotation.x = -Math.PI/2; floor.position.y = -3.9; scene.add(floor);
  const pmrem = new T.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene,0.04);
  pmrem.dispose();
  scene.traverse(o => { if (o instanceof T.Mesh) { o.geometry.dispose(); (o.material as T.Material).dispose(); } });
  return target.texture;
}
