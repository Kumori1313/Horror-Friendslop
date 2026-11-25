import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gravity } from '../src/flight.ts';
import type { Geometry } from '../src/layout.ts';
import { Prediction } from '../src/prediction.ts';
import type { Input, Player } from '../src/room.ts';
import { moveOperator } from '../src/server/simulation.ts';

// A floor, a solid 3 m platform on it, and a gentle ramp (1 m over 6 m) beside.
const room = 'test';
const g: Geometry = {
  surfaces:[
    {x:0,z:0,w:40,d:40,y:0,room},
    {x:0,z:0,w:4,d:4,y:3,room},
    {x:10,z:0,w:6,d:3,y:0,rise:1,along:'x',room},
  ],
  walls:[{x:0,z:0,w:4,d:4,y:0,h:3,room,inward:1}],roofs:[],rails:[],props:[],doors:[],openings:[],
};
const dt = 1/30, east: Input = {forward:0,right:1,yaw:0,pitch:0}, idle: Input = {forward:0,right:0,yaw:0,pitch:0}, west: Input = {forward:0,right:-1,yaw:0,pitch:0};
const at = (x: number, z: number, feetY: number): Player => ({id:1,connected:true,x,z,feetY,yaw:0,pitch:0});

test('walking off a ledge falls under gravity instead of dropping to the floor at once', () => {
  const p = at(1.8,0,3);
  while (p.vy === undefined) moveOperator(p,east,dt,g);
  assert.ok((p.feetY ?? 0) > 2.9,'still near the ledge as the fall begins');
  // Let go: the fall carries on, and lands when the time to fall 3 m is up.
  let t = 0;
  while (p.vy !== undefined && t < 3) { moveOperator(p,idle,dt,g); t += dt; }
  assert.equal(p.feetY,0);
  assert.equal(p.vy,undefined,'landed');
  const expected = Math.sqrt(2*3/gravity);
  assert.ok(Math.abs(t-expected) < 0.1,'fell 3 m in '+t.toFixed(2)+' s, expected about '+expected.toFixed(2));
});

test('in the air an operator can steer, but the platform\'s side is a wall: they come down beside it', () => {
  const late = at(1.8,0,3);
  while (late.vy === undefined) moveOperator(late,east,dt,g);
  const x0 = late.x;
  for (let i=0;i<5;i++) moveOperator(late,east,dt,g);
  assert.ok(late.x > x0+0.4,'still moving east while falling');
  for (let i=0;i<40 && late.vy !== undefined;i++) moveOperator(late,west,dt,g);
  assert.equal(late.feetY,0);
  assert.ok(late.x >= 2.25-1e-9,'clear of the platform\'s side at x '+late.x.toFixed(2));
});

test('walking down a gentle ramp keeps the operator on their feet the whole way', () => {
  const p = at(12.8,0,surfaceAtRampTop());
  for (let i=0;i<60;i++) { moveOperator(p,west,dt,g); assert.equal(p.vy,undefined,'on the ramp at x '+p.x.toFixed(2)); }
  assert.ok(p.x < 7.5 && p.feetY === 0,'down on the floor');
});
function surfaceAtRampTop() { return 1*(12.8-7)/6; }

test('the guest\'s prediction falls exactly as the host does', () => {
  const host = at(1.8,0,3), prediction = new Prediction();
  prediction.reset(host,0);
  for (let i=0;i<40;i++) {
    const input = i < 12 ? east : idle;
    moveOperator(host,input,dt,g);
    prediction.step(i*dt*1000,dt,input,g,[],false);
    assert.deepEqual([prediction.self!.x,prediction.self!.feetY,prediction.self!.vy],[host.x,host.feetY,host.vy]);
  }
  assert.equal(host.feetY,0);
});
