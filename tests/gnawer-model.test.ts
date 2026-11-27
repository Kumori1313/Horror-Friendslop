import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createGnawerModel } from '../src/gnawer-model.ts';
import type { Gnawer } from '../src/mission.ts';

const data = await readFile(new URL('../public/models/gnawer.glb',import.meta.url));
const asset = await new GLTFLoader().parseAsync(Uint8Array.from(data).buffer,'');
const roam: Gnawer = {id:1,x:0,y:0,z:0,yaw:0,mode:'roam',nest:{x:0,y:0,z:0}};
const where = (model: ReturnType<typeof createGnawerModel>, name: string) => { model.group.updateMatrixWorld(true); return model.group.getObjectByName(name)!.getWorldPosition(new Vector3()); };

test('it faces forward (-z), its jaws between its mandibles ahead of its head, following it round', () => {
  const model = createGnawerModel(asset);
  model.pose(roam,0,1/60,false);
  const head = where(model,'Head'), mouth = model.jaws(new Vector3());
  assert.ok(head.z < -0.2 && mouth.z < head.z-0.1,'mouth '+mouth.z.toFixed(2)+' ahead of head '+head.z.toFixed(2));
  assert.ok(Math.abs(mouth.x) < 0.05 && mouth.y > 0.05 && mouth.y < 0.35);
  // Turned and moved, the jaws go with it.
  model.group.position.set(4,1,-2); model.group.rotation.y = Math.PI/2;
  const turned = model.jaws(new Vector3());
  assert.ok(turned.x < 4-0.3 && Math.abs(turned.z+2) < 0.05,'facing -x now: '+turned.toArray().map(v => v.toFixed(2)));
  model.dispose();
});

test('it scuttles only as it moves, idles standing, takes each mode\'s clip, and snaps at each new bite', () => {
  const model = createGnawerModel(asset), leg = () => where(model,'TibiaForeL');
  // Moving: the legs move, in the roaming scuttle.
  model.pose(roam,0,1/60,false);
  const start = leg();
  let moved = 0;
  for (let i=0;i<20;i++) { model.pose(roam,1.8/60,1/60,false); moved = Math.max(moved,leg().distanceTo(start)); }
  assert.ok(moved > 0.02,'legs moved '+moved.toFixed(3));
  assert.equal(model.playing!(),'Scuttle');
  // Standing a while, it idles.
  for (let i=0;i<30;i++) model.pose(roam,0,1/60,false);
  assert.equal(model.playing!(),'Idle');
  // Each mode its own clip.
  for (const [mode,clip] of [['seek','Seek'],['chase','Chase'],['carry','Haul'],['flee','Flee']] as const) {
    model.pose({...roam,mode},2/60,1/60,false);
    assert.equal(model.playing!(),clip,mode);
  }
  // A new bite swings the mandibles on their hinges.
  assert.ok(asset.animations.find(c => c.name === 'Bite')!.tracks.some(t => t.name.startsWith('MandibleL.')),'the bite clip moves the mandibles');
  for (let i=0;i<30;i++) model.pose(roam,0,1/60,false);
  const mandible = model.group.getObjectByName('MandibleL')!, rest = mandible.quaternion.clone();
  let swing = 0;
  for (let i=0;i<40;i++) { model.pose({...roam,bites:1},0,1/60,false); swing = Math.max(swing,mandible.quaternion.angleTo(rest)); }
  assert.ok(swing > 0.1,'the bite swings a mandible by '+swing.toFixed(3)+' rad');
  model.dispose();
});

test('the first sight of a Gnawer that has already bitten plays no bite', () => {
  const model = createGnawerModel(asset);
  model.pose({...roam,bites:3},0,1/60,false);
  const mandible = model.group.getObjectByName('MandibleL')!, before = mandible.quaternion.clone();
  let swing = 0;
  for (let i=0;i<20;i++) { model.pose({...roam,bites:3},0,1/60,false); swing = Math.max(swing,mandible.quaternion.angleTo(before)); }
  assert.ok(swing < 0.1,'no bite: '+swing.toFixed(3)+' rad');
  model.dispose();
});
