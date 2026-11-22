import assert from 'node:assert/strict';
import { test } from 'node:test';
import { geometryFor } from '../src/layout.ts';
import { Prediction } from '../src/prediction.ts';
import type { Input, Snapshot } from '../src/room.ts';
import { generateLayout } from '../src/server/generate-layout.ts';
import { Simulation } from '../src/server/simulation.ts';

// A guest 60 ms from the host each way, sending inputs at most every 100 ms
// and receiving a snapshot every 100 ms, as the creator-hosted mode does.
function session() {
  const plan = generateLayout(19), g = geometryFor(plan);
  const host = new Simulation(plan);
  host.join(); host.join();
  const prediction = new Prediction();
  const inbound: [number,Input][] = [], outbound: [number,Snapshot][] = [];
  let now = 0, lastInput = -1e9, lastState = 0, hostClock = 0, sentInput: Input | undefined;
  const view = () => prediction.view(host.state,2,g).players.find(p => p.id === 2)!;
  prediction.reset(host.state.players[1],0);
  function frame(input: Input) {
    now += 1000/60;
    if (now-lastInput >= 100 && JSON.stringify(input) !== JSON.stringify(sentInput)) {
      inbound.push([now+60,{...input}]); lastInput = now; sentInput = input;
    }
    while (inbound.length && inbound[0][0] <= now) host.inputs.set(2,inbound.shift()![1]);
    while (hostClock+1000/30 <= now) { host.tick(1/30); hostClock += 1000/30; }
    if (now-lastState >= 100) { outbound.push([now+60,structuredClone(host.state)]); lastState = now; }
    while (outbound.length && outbound[0][0] <= now) {
      const s = outbound.shift()![1];
      prediction.correct(s.players.find(p => p.id === 2)!,now,false,g);
    }
    prediction.step(now,1/60,input,g,host.state.opened ?? [],false);
    return view();
  }
  return {host,frame,view,g};
}

test('a predicted guest moves on the first frame, smoothly, and settles on the host position', () => {
  const {host,frame,g} = session();
  const north: Input = {forward:1,right:0,yaw:0,pitch:0}, idle: Input = {forward:0,right:0,yaw:0,pitch:0};
  const start = host.state.players[1].z;
  assert.ok(frame(north).z < start,'the guest sees its own step immediately');
  assert.equal(host.state.players[1].z,start,'the host has not heard the input yet');
  let previous = frame(north), worst = 0;
  // Walk into the closed Intake bulkhead, then wait while it stays shut.
  for (let i=0;i<150;i++) {
    const p = frame(north);
    worst = Math.max(worst,Math.hypot(p.x-previous.x,p.z-previous.z));
    previous = p;
  }
  const door = g.doors[0];
  assert.ok(previous.z > door.z,'prediction stops at the bulkhead like the host');
  assert.ok(worst <= 3.3/60+0.02,'no visible jumps: worst step '+worst.toFixed(3)+' m');
  host.state.opened!.push(door.id);
  for (let i=0;i<40;i++) previous = frame(north);
  assert.ok(previous.z < door.z-0.5,'walks on once the host opens the bulkhead');
  for (let i=0;i<60;i++) previous = frame(idle);
  const auth = host.state.players[1];
  assert.ok(Math.hypot(previous.x-auth.x,previous.z-auth.z) < 0.02,'settles on the host position');
});

test('a correction the guest could not foresee arrives within a snapshot', () => {
  const {host,frame} = session();
  const north: Input = {forward:1,right:0,yaw:0,pitch:0};
  for (let i=0;i<20;i++) frame(north);
  // The host moves the guest somewhere else entirely (a resume or a revive).
  Object.assign(host.state.players[1],{x:4,z:4});
  let p = frame({forward:0,right:0,yaw:0,pitch:0});
  for (let i=0;i<20;i++) p = frame({forward:0,right:0,yaw:0,pitch:0});
  const auth = host.state.players[1];
  assert.ok(Math.hypot(auth.x-4,auth.z-4) < 0.5,'the host kept the guest near the new spot');
  assert.ok(Math.hypot(p.x-auth.x,p.z-auth.z) < 0.01,'the guest jumps to where the host put it');
});
