import { generatorVersion, kindOf } from '../layout.ts';
import type { Layout, Passage } from '../layout.ts';
import { storey } from '../room-templates.ts';
import type { Placement, TemplateLink } from '../room-templates.ts';

// Three straight flights climb north, east, then south around the tower core.
// The landings turn into the next flight and branch into rooms on every floor.
const rooms: Placement[] = [
  {id:'intake',template:'intake',x:-4,y:0,z:0,turn:0},
  {id:'spire-flight-1',template:'stairwell',x:0,y:0,z:-16,turn:0},
  {id:'spire-flight-2',template:'stairwell',x:16,y:storey,z:-16,turn:1},
  {id:'spire-flight-3',template:'stairwell',x:16,y:2*storey,z:0,turn:2},
  {id:'corridor-1',template:'straight',x:-4,y:0,z:-4,turn:1},
  {id:'workshop',template:'workshop',x:-12,y:0,z:-4,turn:0},
  {id:'pump',template:'pump',x:-12,y:0,z:-12,turn:0},
  {id:'lockers',template:'lockers',x:0,y:storey,z:-20,turn:0},
  {id:'control',template:'control',x:-8,y:storey,z:-20,turn:0},
  {id:'stairwell-a',template:'stairwell',x:16,y:storey,z:-24,turn:1},
  {id:'chiller',template:'chiller',x:12,y:2*storey,z:-20,turn:0},
  {id:'office',template:'office',x:8,y:2*storey,z:-20,turn:0},
  {id:'stores',template:'stores',x:16,y:3*storey,z:4,turn:0},
  {id:'closet',template:'closet',x:24,y:3*storey,z:8,turn:0},
];

const links: TemplateLink[] = [
  {a:'intake',from:'north1',b:'spire-flight-1',to:'lower-south'},
  {a:'spire-flight-1',from:'upper-east',b:'spire-flight-2',to:'lower-south'},
  {a:'spire-flight-2',from:'upper-east',b:'spire-flight-3',to:'lower-south'},
  {a:'spire-flight-1',from:'lower-west',b:'corridor-1',to:'north'},
  {a:'corridor-1',from:'south',b:'workshop',to:'east0'},
  {a:'workshop',from:'north0',b:'pump',to:'south0'},
  {a:'spire-flight-2',from:'lower-west',b:'lockers',to:'south1'},
  {a:'lockers',from:'west0',b:'control',to:'east0'},
  {a:'lockers',from:'north1',b:'stairwell-a',to:'lower-east'},
  {a:'stairwell-a',from:'upper-east',b:'chiller',to:'north1'},
  {a:'spire-flight-2',from:'upper-west',b:'chiller',to:'south1'},
  {a:'chiller',from:'west0',b:'office',to:'east0'},
  {a:'spire-flight-3',from:'upper-north',b:'stores',to:'north0'},
  {a:'stores',from:'east1',b:'closet',to:'west0'},
];

export function spireLayout(seed: number): Layout {
  return {
    version:generatorVersion,seed:seed >>> 0,facility:'spire',fallback:false,lampId:'inspection-light',
    rooms:rooms.map(room => ({...room,kind:kindOf(room.template)})),
    passages:links.map((link,index): Passage => ({...link,id:'door-'+index,bulkhead:index === 0})),
  };
}
