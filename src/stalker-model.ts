import * as T from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { Stalker } from './mission.ts';

const clips = {
  roam:'Walk', stalk:'Track', search:'Track', windup:'Drop',
  charge:'Charge', recover:'Recover', stunned:'Stagger', flee:'Walk'
} as const;

export interface StalkerModel {
  group: T.Group;
  pose(s: Stalker, travel: number, dt: number, reducedMotion: boolean): void;
  dispose(): void;
}

// The server moves and turns the creature. Each clip is performed in place.
export function createStalkerModel(asset: GLTF): StalkerModel {
  const group = new T.Group(), root = clone(asset.scene);
  group.add(root);
  const mixer = new T.AnimationMixer(root);
  const actions = new Map(asset.animations.map(clip => [clip.name,mixer.clipAction(clip)]));
  for (const name of ['Drop','Recover']) {
    const action = actions.get(name)!;
    action.setLoop(T.LoopOnce,1); action.clampWhenFinished = true;
  }
  let active: T.AnimationAction | undefined;
  function pose(s: Stalker, travel: number, dt: number, reducedMotion: boolean) {
    const name = clips[s.mode], next = actions.get(name)!;
    if (next !== active) {
      // Late arrivals start in the confirmed pose immediately. During play a
      // short blend opens/closes the five valves continuously, even on interrupts.
      const weight = active ? (next.isRunning() ? next.weight : 0) : 1;
      next.reset().setEffectiveWeight(weight).play();
      active = next;
    }
    const locomotion = name === 'Walk' || name === 'Track' || name === 'Charge';
    if (locomotion) {
      const stride = name === 'Charge' ? 5.4 : name === 'Track' ? 2.1 : 1.9;
      next.timeScale = dt>0 ? T.MathUtils.clamp(travel/dt/stride*next.getClip().duration,-2.5,2.5) : 0;
      if (reducedMotion) next.timeScale *= 0.45;
    } else if (s.mode === 'windup' && s.windupProgress !== undefined) {
      // The server's shorter enraged windup and a join halfway through the tell.
      next.time = s.windupProgress*next.getClip().duration; next.timeScale = 0;
    } else {
      next.timeScale = s.mode === 'stunned' && reducedMotion ? 0 : 1;
    }
    const blend = 1-Math.exp(-dt*(s.mode === 'charge' ? 26 : 16));
    for (const action of actions.values()) {
      if (action === next) action.setEffectiveWeight(T.MathUtils.lerp(action.weight,1,blend));
      else if (action.weight>0 && action.isScheduled()) {
        const weight = action.weight*(1-blend);
        if (weight<0.002) action.stop();
        else action.setEffectiveWeight(weight);
      }
    }
    mixer.update(dt);
  }
  return {group,pose,dispose() {
    mixer.stopAllAction(); mixer.uncacheRoot(root);
    const skeletons = new Set<T.Skeleton>();
    root.traverse(o => { if (o instanceof T.SkinnedMesh) skeletons.add(o.skeleton); });
    for (const skeleton of skeletons) skeleton.dispose();
    group.removeFromParent();
  }};
}
