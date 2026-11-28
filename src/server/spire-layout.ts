import { generatorVersion, kindOf } from '../layout.ts';
import type { Layout, Module, Passage } from '../layout.ts';
import { opposite, orient, socketAt, storey, turnSide } from '../room-templates.ts';
import type { Side, TemplateKind } from '../room-templates.ts';
import { randomSource } from './layout-random.ts';
import { facilityStoreys } from '../facility-kinds.ts';

interface Wing { side: Side; pit?: number }
// Each pit starts beyond the rooms on the same side of the tower below it.
// The north and south wings open on the upper floors, beyond the lower wings.
const lowerWings: readonly Wing[][] = [
  [{side:'east'},{side:'west'}],
  [{side:'east'},{side:'west',pit:34}],
  [{side:'east',pit:38},{side:'west'},{side:'north',pit:30}],
  [{side:'east',pit:54},{side:'west',pit:54},{side:'south',pit:34}],
];
const sideRooms: TemplateKind[] = ['closet','coldstore','survey','hoist-store'];
const endRooms: TemplateKind[] = ['stores','lockers','workshop','hoist-store'];

export function spireLayout(seed: number): Layout {
  const random = randomSource(seed ^ 0x9a51b3), rooms: Module[] = [], passages: Passage[] = [];
  const pick = (pool: TemplateKind[]) => pool[Math.floor(random()*pool.length)];
  const place = (id: string, template: TemplateKind, x: number, y: number, z: number, turn: number) => {
    const room = {id,template,kind:kindOf(template),x,y,z,turn};
    rooms.push(room);
    return room;
  };
  const link = (a: Module, from: string, b: Module, to: string) => {
    passages.push({a:a.id,from,b:b.id,to,id:'door-'+passages.length,bulkhead:passages.length === 0});
  };
  const facing = (room: Module, side: Side) => orient(room.template,room.turn).sockets.find(s => s.side === side && !s.shaft)!.name;
  const heading = (from: Side, to: Side) => [0,1,2,3].find(t => turnSide(from,t) === to)!;
  function attach(parent: Module, side: Side, id: string, template: TemplateKind, turn: number, entry: string) {
    const from = facing(parent,side), at = socketAt(parent,from)!;
    const door = orient(template,turn).sockets.find(s => s.name === entry)!;
    const room = place(id,template,at.x-door.x,at.y-door.y,at.z-door.z,turn);
    link(parent,from,room,entry);
    return room;
  }
  function corridor(parent: Module, side: Side, junction = false) {
    const id = 'corridor-'+rooms.length;
    if (junction) return attach(parent,side,id,'cross',0,opposite(side));
    return attach(parent,side,id,'straight',heading('south',opposite(side)),'south');
  }
  function destination(parent: Module, side: Side, room: TemplateKind) {
    const id = room === 'office' ? room : room+'-'+rooms.length;
    return attach(parent,side,id,room,heading('north',opposite(side)),'north0');
  }

  const floors = facilityStoreys('spire',seed), upperSide = seed & 1 ? 'east' : 'west';
  const wings: readonly Wing[][] = [
    ...lowerWings,
    [{side:'north',pit:46},{side:'south',pit:46},{side:upperSide,pit:66}],
    [{side:'north',pit:58},{side:'south',pit:58},{side:opposite(upperSide),pit:66}],
  ];
  const intake = place('intake','intake',-4,0,0,0);
  const tower = Array.from({length:floors},(_,i) => place('spire-floor-'+(i+1),i === floors-1 ? 'spire-crown' : 'spire-flight',0,i*storey,-12,0));
  link(intake,'north1',tower[0],'south');
  for (let i=1;i<floors;i++) link(tower[i-1],'upper',tower[i],'lower');

  let shortcut: Module | undefined;
  for (let i=0;i<floors;i++) for (const {side,pit} of wings[i]) {
    const lower = side === 'east' && i === 1, upper = side === 'east' && i === 2;
    let hall = corridor(corridor(tower[i],side),side);
    if (upper) hall = corridor(hall,side);
    const junction = corridor(hall,side,true);
    const left = turnSide(side,3), right = turnSide(side,1);
    const office = i === 0 && side === 'east';
    destination(junction,left,office ? 'office' : pick(sideRooms));
    if (lower) {
      shortcut = attach(corridor(junction,right),right,'stairwell-a','stairwell',2,'lower-south');
    } else if (upper) {
      let foot = junction;
      for (let j=0;j<5;j++) foot = corridor(foot,right,j === 4);
      link(foot,'west',shortcut!,'upper-west');
    } else {
      // Provision both wings with storage and let the second branch vary.
      destination(junction,right,pick(sideRooms));
    }

    let end = junction;
    if (pit) {
      const radial = upper ? 24 : 20;
      for (let at=radial+2;at<pit;at+=4) end = corridor(end,side);
      const hazard = i === 1 || (i === 2 && random() < 0.55) ? 'counterweight' : 'transfer';
      attach(end,side,hazard+'-'+rooms.length,hazard,heading('west',opposite(side)),'west0');
    } else {
      if (random() < 0.5) end = corridor(end,side);
      destination(end,side,pick(endRooms));
    }
  }
  return {version:generatorVersion,seed:seed >>> 0,facility:'spire',fallback:false,lampId:'inspection-light',rooms,passages};
}
