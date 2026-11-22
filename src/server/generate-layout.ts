import { cellsOf, distances, generatorVersion, kindOf, validLayout } from '../layout.ts';
import type { Layout, Module, Passage } from '../layout.ts';
import { cell, destinationPool, opposite, orient, outward, roomTemplates, socketAt, storey, turnSide } from '../room-templates.ts';
import type { Side, TemplateKind } from '../room-templates.ts';

function randomSource(seed: number) {
  let n = seed >>> 0;
  return () => {
    n = (n + 0x6d2b79f5) >>> 0;
    let t = Math.imul(n ^ (n >>> 15),1 | n);
    t ^= t + Math.imul(t ^ (t >>> 7),61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Open { room: string; name: string; x: number; y: number; z: number; side: Side }
const bounds = {x:32, north:-48, south:4};

// Grows corridors, stairwells and destinations outward from Intake. Each branch
// is built tentatively and rolled back unless its destination fits.
class Facility {
  rooms: Module[] = [];
  passages: Passage[] = [];
  cells = new Set<string>();
  stairs = 0;
  corridors = 0;
  readonly random: () => number;
  constructor(random: () => number) { this.random = random; }
  pick<T>(values: T[]) { return values[Math.floor(this.random()*values.length)]; }
  shuffle<T>(values: T[]) {
    const copy = [...values];
    for (let i=copy.length-1;i>0;i--) { const j = Math.floor(this.random()*(i+1)); [copy[i],copy[j]] = [copy[j],copy[i]]; }
    return copy;
  }
  save() { return {rooms:[...this.rooms],passages:[...this.passages],cells:new Set(this.cells),stairs:this.stairs,corridors:this.corridors}; }
  restore(s: ReturnType<Facility['save']>) { Object.assign(this,s); }
  place(id: string, template: TemplateKind, x: number, y: number, z: number, turn: number) {
    const room: Module = {id,template,kind:kindOf(template),x,y,z,turn};
    const keys = cellsOf(room);
    if (keys.some(k => {
      const [cx,cz,level] = k.split(',').map(Number);
      return this.cells.has(k) || level > 1 || Math.abs(cx*cell) > bounds.x || cz*cell < bounds.north || cz*cell > bounds.south;
    })) return;
    for (const k of keys) this.cells.add(k);
    this.rooms.push(room);
    return room;
  }
  link(a: string, from: string, b: string, to: string) {
    this.passages.push({a,from,b,to,id:'door-'+this.passages.length,bulkhead:false});
  }
  linked(room: string, name: string) {
    return this.passages.some(p => (p.a === room && p.from === name) || (p.b === room && p.to === name));
  }
  open(filter: (r: Module) => boolean = () => true): Open[] {
    return this.rooms.filter(filter).flatMap(r => orient(r.template,r.turn).sockets
      .filter(s => !this.linked(r.id,s.name)).map(s => ({...socketAt(r,s.name)!,room:r.id})));
  }
  // Fit a template so one of its sockets meets `at`; pick a random workable turn.
  attach(at: Open, id: string, template: TemplateKind, sockets?: (name: string) => boolean) {
    for (const turn of this.shuffle([0,1,2,3])) {
      const t = orient(template,turn);
      for (const s of this.shuffle(t.sockets)) {
        if (s.side !== opposite(at.side) || (sockets && !sockets(s.name))) continue;
        const y = at.y-s.y;
        if (y !== 0 && y !== storey) continue;
        const room = this.place(id,template,at.x-s.x,y,at.z-s.z,turn);
        if (!room) continue;
        this.link(at.room,at.name,id,s.name);
        return {room,entry:s.name};
      }
    }
  }
  branch(from: Open, template: TemplateKind, id: string, run: number, climb: boolean) {
    const saved = this.save();
    let at = from;
    const fail = () => { this.restore(saved); return undefined; };
    if (climb && this.stairs < 3) {
      const upward = at.y === 0;
      const stair = this.attach(at,'stairwell-'+'abc'[this.stairs],'stairwell',n => n.startsWith(upward ? 'lower' : 'upper'));
      if (!stair) return fail();
      this.stairs++;
      const exits = this.open(r => r === stair.room).filter(s => s.name.startsWith(upward ? 'upper' : 'lower'));
      if (!exits.length) return fail();
      at = this.pick(exits);
    }
    for (let i=0;i<run;i++) {
      const [dx,dz] = outward(at.side);
      const corridor = this.place('corridor-'+(++this.corridors),'cross',at.x+dx*cell/2,at.y,at.z+dz*cell/2,0);
      if (!corridor) return fail();
      this.link(at.room,at.name,corridor.id,opposite(at.side));
      const ahead = this.random() < 0.6 ? at.side : turnSide(at.side,this.random() < 0.5 ? 1 : 3);
      at = {...socketAt(corridor,ahead)!,room:corridor.id};
    }
    return this.attach(at,id,template) ?? fail();
  }
}

// Replace each provisional cross with the piece whose sockets match its links.
function fitCorridors(rooms: Module[], passages: Passage[]) {
  const shapes: [TemplateKind,Side[]][] = [['straight',['north','south']],['corner',['north','east']],['tee',['north','east','south']],['cross',['north','east','south','west']]];
  for (const room of rooms.filter(r => r.kind === 'corridor')) {
    const used = passages.flatMap(p => [p.a === room.id ? p.from : null,p.b === room.id ? p.to : null]).filter(Boolean) as Side[];
    for (const [template,base] of shapes) {
      if (base.length !== used.length) continue;
      const turn = [0,1,2,3].find(t => base.every(s => used.includes(turnSide(s,t))));
      if (turn === undefined) continue;
      Object.assign(room,{template,turn});
      const rename = (side: string) => base.find(s => turnSide(s,turn) === side)!;
      for (const p of passages) {
        if (p.a === room.id) p.from = rename(p.from);
        if (p.b === room.id) p.to = rename(p.to);
      }
      break;
    }
  }
}

function grow(seed: number, random: () => number): Layout | undefined {
  const f = new Facility(random);
  f.place('intake','intake',-4,0,0,0);
  const drawn = f.shuffle(destinationPool).slice(0,9+Math.floor(random()*4));
  const loot = destinationPool.filter(k => roomTemplates[k].loot);
  for (const k of f.shuffle(loot)) if (drawn.filter(d => roomTemplates[d].loot).length < 2 && !drawn.includes(k)) drawn.push(k);
  drawn.splice(Math.floor(random()*(drawn.length+1)),0,'switchboard');
  const order: TemplateKind[] = [...drawn,'relay','exit'];
  for (const [index,kind] of order.entries()) {
    let placed = false;
    for (let attempt=0; attempt<40 && !placed; attempt++) {
      let options: Open[];
      if (index === 0) options = f.open(r => r.id === 'intake').filter(s => s.name === 'north1');
      else {
        options = f.open(r => r.id !== 'intake' && r.id !== 'exit');
        if (kind === 'relay' || kind === 'exit') {
          // Push the relay far from Intake, and the exit far from the relay.
          const steps = distances(f.rooms,f.passages,kind === 'relay' ? 'intake' : 'relay');
          const far = Math.max(...options.map(o => steps.get(o.room)!));
          options = options.filter(o => steps.get(o.room)! >= far-1-Math.floor(attempt/10));
        }
      }
      if (!options.length) break;
      const at = f.pick(options);
      const run = index === 0 ? 1+Math.floor(random()*2) : Math.floor(random()*4);
      const climb = f.stairs === 0 ? index >= 2 && random() < 0.5 : random() < 0.18;
      placed = !!f.branch(at,kind,kind,run,climb);
    }
    if (!placed && (index === 0 || order.length-index <= 3)) return;
  }
  // Join meeting doorways for loops, away from the single doors into Intake and Exit.
  const loose = f.open(r => r.id !== 'intake' && r.id !== 'exit');
  for (let i=0;i<loose.length;i++) for (let j=i+1;j<loose.length;j++) {
    const a = loose[i], b = loose[j];
    if (a.room === b.room || a.x !== b.x || a.y !== b.y || a.z !== b.z || opposite(a.side) !== b.side) continue;
    if (f.linked(a.room,a.name) || f.linked(b.room,b.name) || random() < 0.4) continue;
    f.link(a.room,a.name,b.room,b.name);
  }
  fitCorridors(f.rooms,f.passages);
  f.passages[0].bulkhead = true;
  const exitDoor = f.passages.find(p => p.b === 'exit');
  if (exitDoor) exitDoor.bulkhead = true;
  const callout = seed % 2 === 0 ? 'black-start' : 'line-test';
  return {callout,version:generatorVersion,seed,fallback:false,rooms:f.rooms,passages:f.passages,objectiveId:'relay',exitId:'exit',lampId:'inspection-light'};
}

let fallback: Layout | undefined;
export function generateLayout(seed: number, attempts = 8): Layout {
  seed >>>= 0;
  const random = randomSource(seed);
  for (let attempt=0; attempt<attempts; attempt++) {
    const layout = grow(seed,random);
    if (layout && validLayout(layout)) return layout;
  }
  // A fixed internal seed that is known to build a valid facility.
  if (!fallback) {
    for (let k=1; !fallback; k++) {
      const layout = grow(0,randomSource(0x9e3779b9+k));
      if (layout && validLayout(layout)) fallback = layout;
    }
  }
  return {...structuredClone(fallback),seed,fallback:true,callout:seed % 2 === 0 ? 'black-start' : 'line-test'};
}
