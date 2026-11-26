import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groundAt, outdoors } from '../src/places.ts';
import type { Snapshot } from '../src/room.ts';
import { generateLayout } from '../src/server/generate-layout.ts';
import { Simulation } from '../src/server/simulation.ts';
import { diff, Held, patch, quantize, seenBy, Sent } from '../src/wire.ts';

test('a patch rebuilds the value exactly: keys added, changed and removed, lists by id reordered, grown and shrunk', () => {
  const a = {n:1,s:'x',gone:true,o:{p:1,q:[1,2]},list:[{id:1,x:1},{id:2,x:2}],plain:[1,2,3],empty:[] as {id: number}[]};
  const b = {n:2,s:'x',o:{p:1,q:[1,2,3],r:null},list:[{id:3,x:3},{id:1,x:1.5}],plain:[1,2],empty:[{id:9}],added:{deep:{deeper:1}}};
  const d = diff(a,b);
  assert.deepEqual(patch(a,d),b);
  assert.equal(diff(b,structuredClone(b)),undefined,'nothing changed');
  assert.deepEqual(patch(b,diff(b,a)),a);
  // The base is left as it was.
  const before = structuredClone(a);
  patch(a,d);
  assert.deepEqual(a,before);
});

test('a guest is sent the creatures where it looks, and the Lurker anywhere', () => {
  const {sim} = crew();
  const m = sim.state.mission!;
  m.gnawers = [{id:1,x:0,y:0,z:0,yaw:0,mode:'roam',nest:{x:0,y:0,z:0}}];
  m.stalkers = [{id:1,x:0,y:0,z:0,yaw:0,mode:'roam'}];
  m.lurkers = [{id:1,x:0,y:0,z:0,yaw:0,mode:'lurk'}];
  const guest = sim.state.players.find(p => p.id === 2)!, host = sim.state.players.find(p => p.id === 1)!;
  guest.place = 'inside';
  let v = seenBy(sim.state,2).mission!;
  assert.ok(v.gnawers && !v.stalkers && v.lurkers);
  guest.place = 'outside';
  v = seenBy(sim.state,2).mission!;
  assert.ok(!v.gnawers && v.stalkers && v.lurkers);
  // Dead, watching a partner inside.
  m.dead = [2]; host.place = 'inside';
  v = seenBy(sim.state,2).mission!;
  assert.ok(v.gnawers && !v.stalkers);
  assert.ok(sim.state.mission!.stalkers,'the host keeps them all');
});

test('rounding keeps a millimetre and leaves a throw\'s flight exact', () => {
  const q = quantize({x:1.23456789,n:3,flight:{x:1.23456789},list:[0.1+0.2]});
  assert.deepEqual(q,{x:1.235,n:3,flight:{x:1.23456789},list:[0.3]});
});

// Host and guest over a lossy link: the host sends at 10/s, a patch against
// the snapshot the guest last confirmed (confirmations arrive late and only
// every few frames); some frames are lost. Every snapshot the guest rebuilds
// is what the host sent, and the bytes it took are counted.
function link(sim: Simulation, seconds: number, each: () => void, loss = 0.25) {
  const sent = new Sent(), held = new Held();
  let r = 99;
  const random = () => (r = (Math.imul(r,1103515245)+12345) >>> 0)/2**32;
  let have: {epoch: number; update: number} | undefined, latest = -1, bytes = 0, frames = 0, wholes = 0;
  const confirmations: {at: number; have: {epoch: number; update: number}}[] = [];
  for (let tick=0;tick<seconds*30;tick++) {
    sim.tick(1/30); each();
    // Confirmations reach the host a few frames late.
    while (confirmations.length && confirmations[0].at <= tick) have = confirmations.shift()!.have;
    if (tick % 3) continue;
    const view = seenBy(sim.state,2), frame = {type:'state',...sent.frame(view,have),ack:0,echo:0,epoch:sent.epoch};
    bytes += JSON.stringify(frame).length; frames++;
    if (frame.state) wholes++;
    if (random() < loss) continue;
    const got: Snapshot | undefined = frame.state ? held.whole(frame.epoch,frame.state) : held.patched(frame.epoch,frame.base!,frame.patch);
    if (!got) continue;
    assert.deepEqual(got,quantize(view),'update '+sim.state.update);
    latest = got.update;
    if (tick % 9 === 0) confirmations.push({at:tick+6,have:{epoch:held.epoch,update:latest}});
  }
  return {perSecond:Math.round(bytes/seconds),average:Math.round(bytes/frames),wholes};
}
function crew(seed = 19) {
  const sim = new Simulation(generateLayout(seed),'coop','inside');
  sim.join(); sim.join();
  let r = 5;
  sim.random = () => (r = (Math.imul(r,1103515245)+12345) >>> 0)/2**32;
  // Nobody stays down: the creatures keep coming.
  const keepUp = () => { const m = sim.state.mission!; m.down = []; delete m.flat; for (const p of sim.state.players) p.hp = 100; };
  return {sim,keepUp};
}
export const budget = 4000;

test('inside, with the Diver awake and two Gnawers about, snapshots cost under the budget', t => {
  const {sim,keepUp} = crew();
  sim.state.mission!.awake = true;
  let n = 0;
  const each = () => { keepUp(); n++; for (const p of sim.state.players) sim.inputs.set(p.id,{forward:n % 120 < 60 ? 1 : -1,right:p.id === 1 ? 0.5 : -0.5,yaw:n/40,pitch:0}); };
  const result = link(sim,20,each);
  t.diagnostic(JSON.stringify({inside:result}));
  assert.ok(result.perSecond < budget,result.perSecond+' B/s');
});

test('outside late, with three stalkers and the Lurker hunting a moving crew, snapshots cost under the budget', t => {
  const {sim,keepUp} = crew();
  const map = outdoors(19);
  for (const [i,p] of sim.state.players.entries()) Object.assign(p,{place:'outside',x:map.exit.x+i*2,z:map.exit.z+3,feetY:groundAt(map,map.exit.x+i*2,map.exit.z+3)});
  sim.state.mission!.clock = 430;
  let n = 0;
  const each = () => { keepUp(); n++; for (const p of sim.state.players) sim.inputs.set(p.id,{forward:n % 90 < 45 ? 1 : -1,right:0,yaw:p.id+n/60,pitch:0}); };
  const result = link(sim,30,each);
  t.diagnostic(JSON.stringify({outside:result,stalkers:sim.state.mission!.stalkers?.length}));
  assert.equal(sim.state.mission!.stalkers?.length,3);
  assert.ok(result.perSecond < budget,result.perSecond+' B/s');
});
