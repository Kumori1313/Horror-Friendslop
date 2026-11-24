import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchor, connections, geometryFor, stairwellLayout, zoneAt, type Layout } from '../src/layout.ts';
import { items, listen, pace, sprawl, stunTime, type Mission } from '../src/mission.ts';
import { Simulation } from '../src/server/simulation.ts';
import { itemKinds, spawnSalvage } from '../src/salvage.ts';
import { slotsOf } from '../src/room.ts';
import { surfaceAt } from '../src/room-templates.ts';
import { advanceMission, newMission } from '../src/server/mission.ts';
import { generateLayout } from '../src/server/generate-layout.ts';
import type { Player, Snapshot } from '../src/room.ts';

// The fixed walkthrough: Intake, a stairwell up to the Machinery hall, a
// closet off the hall's gallery, and a tunnel from the hall back to Intake.
// From the closet, the stairwell is two connections away and Intake three.
const tour = stairwellLayout();

function scene(layout: Layout, at: Record<number,{x: number; y: number; z: number}>) {
  const players: Player[] = Object.entries(at).map(([id,p]) => ({id:Number(id),x:p.x,z:p.z,feetY:p.y,yaw:0,pitch:0,connected:true,place:'inside'}));
  const mission: Mission = newMission(layout,{seed:1,expeditions:3,index:0,layout:layout.seed,quota:100,credited:0,receipts:[]});
  mission.awake = true;
  const state: Snapshot = {round:'r',update:0,players,lamp:{x:0,y:0.14,z:0,yaw:0,pitch:0,on:true,owner:null},mission};
  const g = geometryFor(layout);
  const locate = (p: Player) => surfaceAt(g,p.x,p.z,p.feetY ?? 0)?.room;
  const run = (seconds: number, random = () => 0) => { for (let t=0;t<seconds-1e-9;t+=1/30) advanceMission(layout,state,mission,1/30,locate,random); };
  const hang = (room: string, seconds = 0) => { const a = anchor(layout.rooms.find(r => r.id === room)!); mission.diver = {mode:'hanging',bay:room,seconds,...a,moves:0}; };
  const player = (id: number) => players.find(p => p.id === id)!;
  return {state,mission,run,hang,player,locate};
}
const at = (layout: Layout, room: string) => anchor(layout.rooms.find(r => r.id === room)!);

test('the Bell Diver moves one room at a time toward an operator two connections away, through a stairwell', () => {
  const {mission,run,hang,player} = scene(tour,{1:at(tour,'stairwell-a')});
  hang('closet');
  run(1/30);
  assert.deepEqual([mission.diver.bay,mission.diver.moves,mission.diver.seconds],['hall',1,pace(mission).step],'one connection closer');
  run(pace(mission).step);
  assert.equal(mission.diver.bay,'stairwell-a','into the stairwell');
  assert.deepEqual([mission.diver.x,mission.diver.y,mission.diver.z],[player(1).x,0,player(1).z],'above the operator, over their storey');
  assert.equal(mission.diver.moves,2);
});

test('three connections away is out of reach until the bell enrages it', () => {
  const calm = scene(tour,{1:at(tour,'intake')});
  calm.hang('closet');
  assert.equal(connections(tour)('closet','intake'),3);
  calm.run(1/30);
  assert.equal(calm.mission.diver.seconds,pace(calm.mission).wander,'it wanders instead of chasing');
  const angry = scene(tour,{1:at(tour,'intake')});
  angry.mission.enraged = true;
  angry.hang('closet');
  angry.run(1/30);
  assert.deepEqual([angry.mission.diver.bay,angry.mission.diver.seconds],['hall',pace(angry.mission).step],'enraged, it chases from three connections');
});

test('the chase breaks off when the operator gets out of reach', () => {
  // Find, on a generated facility, a room two connections from the Diver and
  // one more that is three connections from the room the Diver moves into.
  const layout = generateLayout(11), hops = connections(layout), ids = layout.rooms.map(r => r.id);
  let found: [string,string,string] | undefined;
  for (const d of ids) for (const r of ids) {
    if (found || hops(d,r) !== 2) continue;
    const next = ids.find(n => hops(d,n) === 1 && hops(n,r) === 1)!;
    const away = ids.find(a => hops(next,a) === 3 && hops(r,a) <= 2);
    if (away) found = [d,r,away];
  }
  assert.ok(found,'the facility has such rooms');
  const [from,toward,away] = found!;
  const {mission,run,hang,player} = scene(layout,{1:at(layout,toward)});
  hang(from);
  run(1/30);
  const step = mission.diver.bay;
  assert.equal(hops(step,toward),1,'it chases');
  Object.assign(player(1),{x:at(layout,away).x,z:at(layout,away).z,feetY:at(layout,away).y});
  run(pace(mission).step);
  assert.equal(mission.diver.seconds,pace(mission).wander,'out of reach after its next move, it wanders');
});

test('every move is heard within two connections of the room it enters, once, and not three connections away', () => {
  // On a generated facility: the Diver moves toward an operator two rooms
  // away; listeners stand 0, 1, 2 and 3 connections from the room it enters.
  const layout = generateLayout(11), hops = connections(layout), ids = layout.rooms.map(r => r.id);
  let plan: {from: string; toward: string; next: string; rooms: string[]} | undefined;
  for (const from of ids) for (const toward of ids) {
    if (plan || hops(from,toward) !== 2) continue;
    const next = ids.find(n => hops(from,n) === 1 && hops(n,toward) === 1)!;
    const rooms = [0,1,2,3].map(d => ids.find(r => hops(next,r) === d));
    if (rooms.every(Boolean)) plan = {from,toward,next,rooms:rooms as string[]};
  }
  assert.ok(plan,'the facility has such rooms');
  const {mission,run,hang} = scene(layout,{1:at(layout,plan!.toward)});
  hang(plan!.from);
  const heard = new Map<string,number | undefined>(), plays = new Map(plan!.rooms.map(r => [r,0]));
  const hear = () => { for (const room of plan!.rooms) {
    const r = listen(layout,room,mission.diver,heard.get(room));
    heard.set(room,r.heard);
    if (r.clip !== undefined) { plays.set(room,plays.get(room)!+1); assert.equal(r.clip,mission.diver.clip); }
  } };
  hear();
  for (let i=0;i<10;i++) { run(1/30,() => 0.7); hear(); }
  assert.equal(mission.diver.bay,plan!.next);
  assert.equal(mission.diver.clip,1,'the host picked the second clip');
  assert.deepEqual([...plays.values()],[1,1,1,0]);
  // The next move plays once more for every listener within range of where it goes.
  run(pace(mission).step); hear();
  assert.equal(mission.diver.moves,2);
  const second = mission.diver.bay;
  assert.deepEqual([...plays.values()],plan!.rooms.map((r,i) => [1,1,1,0][i]+Number(hops(second,r) <= 2)));
  // A listener who joins or refreshes after a move hears nothing replayed.
  assert.equal(listen(layout,plan!.next,mission.diver,undefined).clip,undefined);
});

test('it waits, then falls, and strikes everyone on its storey of its room when it lands', () => {
  const g = geometryFor(tour);
  const gallery = g.surfaces.find(s => s.room === 'hall' && s.y === 4 && !s.rise)!;
  const floor = at(tour,'hall');
  const {mission,run,hang,player,state} = scene(tour,{1:floor,2:{x:gallery.x,y:4,z:gallery.z},3:{...floor,x:floor.x+2}});
  const p = pace(mission);
  assert.equal(p.wait+p.fall,4,'4 s from stepping beneath it to the impact');
  hang('hall',99);
  state.lamp.owner = 1;
  run(p.wait-0.1);
  assert.deepEqual([mission.diver.mode,mission.down.length],['hanging',0],'still waiting');
  run(0.2);
  assert.equal(mission.diver.mode,'falling');
  // Operator 3 gets out while it falls; the fall carries on regardless.
  Object.assign(player(3),at(tour,'tunnel'),{feetY:0});
  run(p.fall-0.2);
  assert.deepEqual([mission.diver.mode,mission.down.length],['falling',0],'nobody is hit before it lands');
  run(0.2);
  assert.deepEqual(mission.down.map(d => d.id),[1],'only the operator still on its floor when it lands');
  assert.equal(mission.diver.mode,'strike');
  assert.equal(state.lamp.owner,null,'the struck operator drops the light');
  run(sprawl);
  assert.equal(mission.diver.mode,'rising');
  run(p.rise);
  assert.equal(mission.diver.mode,'quiet');
  run(p.quiet);
  assert.equal(mission.diver.mode,'hanging','back on the ceiling');
});

test('the wait resets when the room empties, the fall is committed once it starts, and both are quicker once enraged', () => {
  const floor = at(tour,'hall');
  // Operator 2 waits in Intake, so a strike doesn't wipe the crew.
  const {mission,run,hang,player} = scene(tour,{1:floor,2:at(tour,'intake')});
  mission.enraged = true;
  const p = pace(mission);
  assert.equal(p.wait+p.fall,2.5);
  hang('hall',99);
  run(1);
  assert.ok(mission.diver.drop! < p.wait && mission.diver.drop! > p.wait-1.1);
  Object.assign(player(1),at(tour,'tunnel'),{feetY:0});
  run(1/30);
  assert.equal(mission.diver.drop,undefined,'leaving during the wait resets it');
  Object.assign(player(1),floor,{feetY:0});
  run(p.wait-0.1);
  assert.equal(mission.diver.mode,'hanging');
  run(0.2);
  assert.equal(mission.diver.mode,'falling');
  Object.assign(player(1),at(tour,'tunnel'),{feetY:0});
  run(p.fall);
  assert.deepEqual([mission.diver.mode,mission.down.length],['strike',0],'it lands anyway, on nobody');
});

test('it drags itself into a room before it can start a drop there', () => {
  const {mission,run,hang} = scene(tour,{1:at(tour,'hall'),2:at(tour,'intake')});
  hang('closet');
  const p = pace(mission);
  run(1/30);
  assert.deepEqual([mission.diver.bay,mission.diver.from?.bay,mission.diver.moves],['hall','closet',1]);
  assert.equal(mission.diver.travel,p.travel,'on its way');
  run(p.travel-0.1);
  assert.equal(mission.diver.drop,undefined,'no drop while it is still dragging');
  run(0.2);
  assert.deepEqual([mission.diver.travel,mission.diver.from],[undefined,undefined],'arrived');
  assert.ok(mission.diver.drop! < p.wait,'the wait starts once it is in place');
});

test('large rooms split into zones no more than 8 m a side', () => {
  const zones = (layout: Layout, room: string) => {
    const g = geometryFor(layout), found = new Set<string>();
    for (const s of g.surfaces) if (s.room === room) for (let x=s.x-s.w/2+0.1;x<s.x+s.w/2;x+=0.5) for (let z=s.z-s.d/2+0.1;z<s.z+s.d/2;z+=0.5) found.add(zoneAt(layout,room,x,z));
    return found.size;
  };
  assert.equal(zones(tour,'tunnel'),4,'the L-shaped service tunnel');
  assert.equal(zones(tour,'hall'),4,'the 12 m Machinery hall');
  assert.equal(zones(tour,'stairwell-a'),2,'a 16 m stairwell');
  assert.equal(zones(tour,'closet'),1);
});

test('it strikes only its zone of a long room, and drags itself across zones to chase', () => {
  const g = geometryFor(tour), tunnel = g.surfaces.filter(s => s.room === 'tunnel' && !s.rise);
  // Two spots in the tunnel's floor in different zones.
  const spots = tunnel.flatMap(s => [-0.4,0,0.4].map(f => ({x:s.x+f*s.w,y:0,z:s.z+f*s.d})));
  const a = spots[0], b = spots.find(s => zoneAt(tour,'tunnel',s.x,s.z) !== zoneAt(tour,'tunnel',a.x,a.z))!;
  const {mission,run,player} = scene(tour,{1:a,2:b,3:at(tour,'intake')});
  mission.diver = {mode:'hanging',bay:'tunnel',seconds:99,x:a.x,y:0,z:a.z,moves:0};
  const p = pace(mission);
  run(p.wait+p.fall+0.1);
  assert.deepEqual(mission.down.map(d => d.id),[1],'operator 2, in another zone of the tunnel, is safe');
  // Back on the ceiling with only operator 2 in the tunnel, it crosses to their zone.
  mission.down = [];
  Object.assign(player(1),at(tour,'intake'),{feetY:0});
  mission.diver = {mode:'hanging',bay:'tunnel',seconds:0,x:a.x,y:0,z:a.z,moves:0};
  run(1/30);
  assert.deepEqual([mission.diver.bay,mission.diver.moves,mission.diver.from?.bay,mission.diver.x,mission.diver.z],['tunnel',1,'tunnel',b.x,b.z],'a move within the room, which rattles');
});

test('an item thrown into the Bell Diver drops beneath it and stuns it for 6 s', () => {
  const sim = new Simulation(generateLayout(19),'coop','inside');
  sim.join(); sim.join();
  const mission = sim.state.mission!, layout = sim.layout!;
  const p1 = sim.state.players[0], p2 = sim.state.players[1];
  const item = spawnSalvage(layout).find(i => !itemKinds[i.kind].heavy)!;
  // A corridor: a low ceiling, easy to reach.
  const room = layout.rooms.find(r => r.kind === 'corridor')!, spot = anchor(room);
  const intake = anchor(layout.rooms.find(r => r.id === 'intake')!);
  Object.assign(p2,{x:intake.x,z:intake.z,feetY:intake.y});
  const take = () => { const h = items(layout,mission).find(i => i.id === item.id)!; Object.assign(p1,{x:h.x,z:h.z,feetY:h.y}); sim.act(1,'take'); };
  take();
  mission.awake = true;
  let hit = false;
  for (const pitch of [0.5,0.7,0.9,1.1,1.3]) for (const power of [0.3,0.5,0.7,0.9]) {
    if (hit) break;
    Object.assign(p1,{x:spot.x,z:spot.z+1.6,feetY:spot.y,yaw:0});
    sim.act(1,'select',{slot:slotsOf(p1).indexOf(item.id)});
    mission.diver = {mode:'hanging',bay:room.id,seconds:99,x:spot.x,y:spot.y,z:spot.z,moves:0};
    sim.act(1,'throw',{aim:{yaw:0,pitch,power}});
    hit = mission.diver.incoming !== undefined;
    if (!hit) { for (let t=0;t<3;t+=1/30) sim.tick(1/30); take(); }
  }
  assert.ok(hit,'some throw from 1.6 m reaches it');
  const flight = mission.haul.find(h => h.id === item.id)!;
  assert.ok(flight.flight?.cut !== undefined && flight.flight.d >= flight.flight.cut!,'the flight stops where it struck');
  assert.deepEqual([flight.x,flight.z],[spot.x,spot.z],'and the item comes to rest beneath it');
  const arrives = mission.diver.incoming!;
  for (let t=0;t<arrives+0.05;t+=1/30) sim.tick(1/30);
  assert.ok(mission.diver.stun! > stunTime-0.2,'stunned when the item reaches it');
  // Operator 1 stands beneath it all along, unharmed while it is stunned.
  Object.assign(p1,{x:spot.x,z:spot.z,feetY:spot.y});
  for (let t=0;t<stunTime-0.3;t+=1/30) sim.tick(1/30);
  assert.deepEqual([mission.diver.mode,mission.diver.drop,mission.down.length],['hanging',undefined,0]);
  for (let t=0;t<0.5;t+=1/30) sim.tick(1/30);
  assert.equal(mission.diver.stun,undefined,'it comes round');
  assert.ok(mission.diver.drop !== undefined,'and starts its wait again');
});

test('a stun during the fall turns it into a climb, and nobody is struck', () => {
  const {mission,run,hang} = scene(tour,{1:at(tour,'hall'),2:at(tour,'intake')});
  hang('hall',99);
  mission.diver.mode = 'falling'; mission.diver.seconds = 0.4; mission.diver.incoming = 0.05;
  run(0.1);
  assert.equal(mission.diver.mode,'rising');
  run(3);
  assert.equal(mission.down.length,0);
});
