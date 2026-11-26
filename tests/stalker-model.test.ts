import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Stalker } from '../src/mission.ts';
import { createStalkerModel } from '../src/stalker-model.ts';

const data = await readFile(new URL('../public/models/stalker.glb',import.meta.url));
const asset = await new GLTFLoader().parseAsync(Uint8Array.from(data).buffer,'');
const roam: Stalker = {id:1,x:0,y:0,z:0,yaw:0,mode:'roam'};

test('walk seals the five valves, tracking reveals the eye, and the windup plants both foreclaws', () => {
  const model = createStalkerModel(asset);
  const valves = Array.from({length:5},(_,i)=>model.group.getObjectByName('Valve'+i)!);
  const wrists = ['HandL','HandR'].map(n=>model.group.getObjectByName(n)!);
  const heights = () => wrists.map(b=>b.getWorldPosition(new Vector3()).y);
  model.pose(roam,0,1/60,false);
  const closed = valves.map(b=>b.quaternion.clone());
  const resting = heights();
  for (let i=0;i<45;i++) model.pose({...roam,mode:'stalk'},0.045,1/60,false);
  valves.forEach((b,i)=>assert.ok(b.quaternion.angleTo(closed[i])>1.3));
  for (let i=0;i<=60;i++) model.pose({...roam,mode:'windup',windupProgress:i/60},0,1/60,true);
  heights().forEach((h,i)=>assert.ok(h<0.40 && resting[i]-h>0.48));
  for (let i=0;i<60;i++) model.pose(roam,0.02,1/60,false);
  valves.forEach((b,i)=>assert.ok(b.quaternion.angleTo(closed[i])<0.025));
  model.dispose();
});

test('a late snapshot uses the windup pose immediately and a charge advances its own gait', () => {
  const charging = createStalkerModel(asset), other = createStalkerModel(asset);
  charging.pose({...roam,mode:'windup',windupProgress:0.92},0,1/60,false);
  other.pose(roam,0,1/60,false);
  const hand = charging.group.getObjectByName('HandR')!;
  const low = hand.getWorldPosition(new Vector3());
  assert.ok(low.y<0.40);
  const otherHand = other.group.getObjectByName('HandR')!;
  const still = otherHand.getWorldPosition(new Vector3());
  let reach = 0;
  for (let i=0;i<50;i++) {
    charging.pose({...roam,mode:'charge'},12/60,1/60,false);
    reach = Math.max(reach,low.distanceTo(hand.getWorldPosition(new Vector3())));
  }
  assert.ok(reach>0.4);
  assert.ok(otherHand.getWorldPosition(new Vector3()).distanceTo(still)<1e-6);
  charging.dispose(); other.dispose();
});
