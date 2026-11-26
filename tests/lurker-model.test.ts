import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Mesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createLurkerModel } from '../src/lurker-model.ts';
import type { Lurker } from '../src/mission.ts';

const file = await readFile(new URL('../public/models/lurker.glb',import.meta.url));
const asset = await new GLTFLoader().parseAsync(Uint8Array.from(file).buffer,'');
const patrol: Lurker = {id:1,x:0,y:0,z:0,yaw:0,mode:'lurk'};
const grab: Lurker = {...patrol,mode:'grab',grab:2,grabs:1};

test('claw follows the moving chest for the entire hold while swimming independently', () => {
  const held = createLurkerModel(asset), free = createLurkerModel(asset);
  held.group.position.set(12,-2,-3); held.group.rotation.y = 1.7;
  const hand = held.group.getObjectByName('Lurker_•_Grapnel') as Mesh;
  const shaft = held.group.getObjectByName('Lurker_•_Reach_shaft')!;
  const tail = held.group.getObjectByName('Spine6')!;
  const otherTail = free.group.getObjectByName(tail.name)!;
  const point = new Vector3(14,1,-8), end = new Vector3();
  held.pose(patrol,undefined,1/60,false); free.pose(patrol,undefined,1/60,false);
  const initialTail = tail.quaternion.clone();
  for (let frame=1;frame<=360;frame++) {
    // Long pause while held, then close the gap and finally widen it again.
    if (frame>180) point.z += frame<270 ? 0.025 : -0.035;
    held.pose(grab,point,1/60,false); free.pose(patrol,undefined,1/60,false);
    assert.ok(tail.quaternion.angleTo(otherTail.quaternion)<0.001);
    if (frame===30) assert.ok(tail.quaternion.angleTo(initialTail)>0.05);
    if (frame>=13) {
      end.set(0,0,-0.18); hand.localToWorld(end);
      assert.ok(end.distanceTo(point)<1e-5);
      assert.equal(hand.morphTargetInfluences![hand.morphTargetDictionary!.Clasp],1);
    }
  }
  const extended = shaft.scale.z;
  held.pose({...patrol,mode:'sunk'},undefined,1/60,false);
  assert.ok(shaft.scale.z>1 && shaft.scale.z<extended);
  for (let i=0;i<30;i++) held.pose(patrol,undefined,1/60,false);
  assert.ok(Math.abs(shaft.scale.z-1)<1e-5);
  assert.ok(hand.morphTargetInfluences!.every(v=>v===0));
  held.dispose(); free.dispose();
});

test('opening a scene mid-grab restores the latch immediately', () => {
  const model = createLurkerModel(asset), point = new Vector3(2,4,3);
  model.pose(grab,point,1/60,true);
  const hand = model.group.getObjectByName('Lurker_•_Grapnel') as Mesh;
  assert.ok(hand.localToWorld(new Vector3(0,0,-0.18)).distanceTo(point)<1e-5);
  assert.equal(hand.morphTargetInfluences![hand.morphTargetDictionary!.Clasp],1);
  model.dispose();
});
