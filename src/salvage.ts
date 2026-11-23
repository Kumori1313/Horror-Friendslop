import { anchor, walkable } from './layout.ts';
import type { Layout } from './layout.ts';
import { assembleTemplates, obstaclesAt, outward, roomTemplates, turnPoint } from './room-templates.ts';
import type { Point3, TemplateKind } from './room-templates.ts';
import { clearAt } from './room.ts';

// Salvage is part of the facility: every client derives the same items from
// the layout seed, and snapshots only carry the ones that have moved.
export type ItemKind = 'valve' | 'gauge' | 'fuse' | 'coil' | 'board' | 'battery' | 'toolbox' | 'bell';
// Heavy items throw shorter.
export const itemKinds: Record<ItemKind,{name: string; value: [number,number]; size: [number,number,number]; color: number; rare?: boolean; heavy?: boolean}> = {
  valve:{name:'Brass valve',value:[15,30],size:[0.36,0.2,0.36],color:0xb08d57},
  gauge:{name:'Pressure gauge',value:[20,40],size:[0.32,0.32,0.12],color:0xd8d2b8},
  fuse:{name:'Fuse cartridge',value:[10,25],size:[0.16,0.36,0.16],color:0xc9a64a},
  coil:{name:'Copper coil',value:[30,55],size:[0.4,0.3,0.4],color:0xb8693e,heavy:true},
  board:{name:'Circuit board',value:[35,60],size:[0.46,0.06,0.34],color:0x3f8a4f,rare:true},
  battery:{name:'Battery cell',value:[25,45],size:[0.3,0.44,0.24],color:0x6c7b8a,rare:true,heavy:true},
  toolbox:{name:'Toolbox',value:[40,70],size:[0.56,0.3,0.3],color:0xa83a32,rare:true,heavy:true},
  bell:{name:'Signal bell',value:[60,90],size:[0.34,0.42,0.34],color:0xd9b44a,rare:true},
};
// Half the width and height that a thrown item collides with. The flashlight
// is the lamp slot's item.
export function bodyOf(kind: ItemKind | 'lamp') {
  if (kind === 'lamp') return {r:0.13,h:0.14};
  const [w,h,d] = itemKinds[kind].size;
  return {r:Math.max(w,d)/2,h:h/2};
}
export interface Salvage extends Point3 { id: string; kind: ItemKind; value: number; room: string }

function random(seed: number) {
  let n = seed >>> 0;
  return () => {
    n = (n + 0x6d2b79f5) >>> 0;
    let t = Math.imul(n ^ (n >>> 15),1 | n);
    t ^= t + Math.imul(t ^ (t >>> 7),61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Open floor in a template where an item can rest: clear of walls and props,
// away from doorways and the pad, and reachable on foot from a doorway.
const spotCache = new Map<TemplateKind,Point3[]>();
function spots(kind: TemplateKind) {
  let found = spotCache.get(kind);
  if (found) return found;
  const t = roomTemplates[kind];
  const g = assembleTemplates([{id:'probe',template:kind,x:0,y:0,z:0,turn:0}],[],true);
  const door = t.sockets[0], [dx,dz] = outward(door.side);
  const reached = walkable(g,{x:door.x-dx*0.5,y:door.y,z:door.z-dz*0.5});
  found = [];
  for (const s of t.surfaces) {
    if (s.rise) continue;
    for (let x=s.x-s.w/2+0.5; x<=s.x+s.w/2-0.5; x+=0.5) for (let z=s.z-s.d/2+0.5; z<=s.z+s.d/2-0.5; z+=0.5) {
      const p = {x,y:s.y,z};
      if (!clearAt(x,z,0.45,obstaclesAt(g,s.y)) || !reached(p)) continue;
      if (t.sockets.some(k => Math.abs(k.y-s.y) < 1 && Math.hypot(k.x-x,k.z-z) < 1.4)) continue;
      if (t.pad && Math.abs(t.pad.y-s.y) < 1 && Math.hypot(t.pad.x-x,t.pad.z-z) < 1.2) continue;
      found.push(p);
    }
  }
  spotCache.set(kind,found);
  return found;
}

const spawned = new WeakMap<Layout,Salvage[]>();
// No room holds more than two items, and two is rare: a loot room always
// holds one and holds two 30% of the time; any other destination is empty
// 65% of the time, holds one 30% of the time, and two only 5%. Intake,
// corridors and stairwells stay clear.
export const maxPerRoom = 2;
export function spawnSalvage(layout: Layout): Salvage[] {
  let items = spawned.get(layout);
  if (items) return items;
  items = [];
  if (!layout.tour) {
    const next = random(layout.seed ^ 0x5a1f4e7);
    const common: ItemKind[] = ['valve','gauge','fuse','coil'];
    const all = Object.keys(itemKinds) as ItemKind[];
    for (const room of layout.rooms) {
      if (room.kind === 'intake' || room.kind === 'corridor' || room.kind === 'stairwell') continue;
      const loot = !!roomTemplates[room.template].loot;
      const roll = next();
      const count = loot ? (roll < 0.3 ? 2 : 1) : roll < 0.05 ? 2 : roll < 0.35 ? 1 : 0;
      const taken: Point3[] = [];
      const pool = [...spots(room.template)];
      for (let i=0; i<count && pool.length; ) {
        const spot = pool.splice(Math.floor(next()*pool.length),1)[0];
        if (taken.some(t => Math.hypot(t.x-spot.x,t.z-spot.z) < 1)) continue;
        taken.push(spot);
        const kind = loot ? all[Math.floor(next()*all.length)] : common[Math.floor(next()*common.length)];
        const [lo,hi] = itemKinds[kind].value;
        const value = Math.round((lo+next()*(hi-lo))*(loot ? 1.2 : 1)/5)*5;
        const p = turnPoint(spot,room.turn);
        items.push({id:room.id+'-'+i,kind,value,x:room.x+p.x,y:room.y+p.y,z:room.z+p.z,room:room.id});
        i++;
      }
    }
  }
  spawned.set(layout,items);
  return items;
}

export const facilityValue = (layout: Layout) => spawnSalvage(layout).reduce((sum,item) => sum+item.value,0);

// Each expedition of a contract has its own facility. The first uses the
// contract seed itself, so a pinned seed still opens on the same layout.
export function expeditionSeed(contract: number, index: number) {
  if (index === 0) return contract >>> 0;
  let h = (contract ^ Math.imul(index,0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16),0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13),0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// The cargo lift sits on Intake's pad.
export const liftOf = (layout: Layout) => anchor(layout.rooms.find(r => r.kind === 'intake')!);
