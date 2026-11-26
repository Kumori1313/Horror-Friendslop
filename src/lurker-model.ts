import * as T from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { Lurker } from './mission.ts';

const forward = new T.Vector3(0,0,-1);
const docked = new T.Quaternion();
// The authored Grab closes on frame 22 and releases after frame 48, at 24 fps.
const claspTime = 21/24, releaseTime = 47/24;
const castSeconds = 0.20, returnSeconds = 0.32;

export interface LurkerModel {
  group: T.Group;
  pose(lurker: Lurker, chest: T.Vector3 | undefined, dt: number, reducedMotion: boolean): void;
  dispose(): void;
}

export function createLurkerModel(asset: GLTF): LurkerModel {
  const group = new T.Group();
  const root = clone(asset.scene);
  group.add(root);
  const hand = root.getObjectByName('Lurker_•_Grapnel')!;
  const shaft = root.getObjectByName('Lurker_•_Reach_shaft')!;
  const pivot = hand.parent!;
  const rest = shaft.userData.rest_length_m as number;
  const mixer = new T.AnimationMixer(root);
  const clip = (name: string) => T.AnimationClip.findByName(asset.animations,name)!;
  const patrol = mixer.clipAction(clip('Swim_Patrol'));
  const pursuit = mixer.clipAction(clip('Swim_Pursuit'));
  let swim = patrol.play();

  // Only the finger poses come from the Grab clip. Its fixed nine-metre cast
  // and reel would break contact as the victim struggles or the Lurker backs up.
  const grab = clip('Grab');
  const fingers = mixer.clipAction(new T.AnimationClip('Claw fingers',grab.duration,
    grab.tracks.filter(track => track.name.endsWith('.morphTargetInfluences'))));
  fingers.play().paused = true;
  const direction = new T.Vector3(), releaseRotation = new T.Quaternion();
  let previous: number | undefined, grabs: number | undefined, initialized = false;
  let cast = 0, recoil = returnSeconds, startLength = rest, releasePose = 0;

  function pose(l: Lurker, chest: T.Vector3 | undefined, dt: number, reducedMotion: boolean) {
    const desired = l.mode === 'hunt' ? pursuit : patrol;
    if (desired !== swim) {
      desired.reset().play().crossFadeFrom(swim,0.22,false);
      swim = desired;
    }
    const victim = chest && l.mode === 'grab' ? l.grab : undefined;
    let length = rest;
    if (victim !== undefined && chest) {
      if (victim !== previous || grabs !== l.grabs) {
        // First sight after a reload (or after loading the asset) can already be mid-drag.
        cast = initialized && !reducedMotion ? 0 : castSeconds;
        startLength = -hand.position.z;
      }
      cast = Math.min(castSeconds,cast+dt);
      const t = T.MathUtils.smoothstep(cast,0,castSeconds);
      pivot.parent!.worldToLocal(direction.copy(chest)).sub(pivot.position);
      const distance = direction.length();
      if (distance > 0.0001) pivot.quaternion.setFromUnitVectors(forward,direction.divideScalar(distance));
      // The fingers enclose the chest just beyond the palm.
      length = T.MathUtils.lerp(startLength,Math.max(0.01,distance-0.18),t);
      fingers.time = t*claspTime;
    } else {
      if (previous !== undefined) {
        recoil = 0;
        startLength = -hand.position.z;
        releaseRotation.copy(pivot.quaternion);
        releasePose = fingers.time;
      }
      recoil = Math.min(returnSeconds,recoil+dt);
      const t = T.MathUtils.smoothstep(recoil,0,returnSeconds);
      length = T.MathUtils.lerp(startLength,rest,t);
      pivot.quaternion.slerpQuaternions(releaseRotation,docked,t);
      // An interrupted cast relaxes from its current aperture without clamping.
      if (releasePose < claspTime) fingers.time = T.MathUtils.lerp(releasePose,0,t);
      else fingers.time = recoil < returnSeconds ? T.MathUtils.lerp(releaseTime,grab.duration,t) : 0;
    }
    previous = victim; grabs = l.grabs; initialized = true;
    shaft.scale.z = length/rest;
    hand.position.z = -length;
    mixer.update(reducedMotion ? dt*0.35 : dt);
  }

  function dispose() {
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
    root.traverse(node => { if (node instanceof T.SkinnedMesh) node.skeleton.dispose(); });
    group.removeFromParent();
  }
  return {group,pose,dispose};
}
