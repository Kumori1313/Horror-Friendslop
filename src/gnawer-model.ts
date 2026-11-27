import * as T from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { Gnawer } from './mission.ts';

// A clip for each of its modes; roaming, it idles when it stands still.
const clips = {roam:'Scuttle',seek:'Seek',chase:'Chase',carry:'Haul',flee:'Flee'} as const;
// How far it travels in one cycle of each walking clip at its own speed in
// that mode (gnawers.ts), so its feet keep pace with the ground.
const strides: Record<string,number> = {Scuttle:1.8*0.83,Seek:2.8*1.17,Chase:3.6*0.58,Haul:2.6*1,Flee:4.4*0.5};

export interface GnawerModel {
  group: T.Group;
  // `travel`: how far it moved this frame.
  pose(g: Gnawer, travel: number, dt: number, reducedMotion: boolean): void;
  // Where salvage it carries sits: between its mandibles.
  jaws(out: T.Vector3): T.Vector3;
  // The clip it is moving to (for tests).
  playing?(): string;
  dispose(): void;
}

// The server moves and turns the Gnawer; each clip plays in place, and a bite
// (each time `bites` goes up) snaps over whatever it is doing.
export function createGnawerModel(asset: GLTF): GnawerModel {
  const group = new T.Group(), root = clone(asset.scene);
  group.add(root);
  const mixer = new T.AnimationMixer(root);
  const actions = new Map(asset.animations.map(clip => [clip.name,mixer.clipAction(clip)]));
  const bite = actions.get('Bite')!;
  bite.setLoop(T.LoopOnce,1); bite.clampWhenFinished = false;
  const left = root.getObjectByName('MandibleL')!, right = root.getObjectByName('MandibleR')!, head = root.getObjectByName('Head')!;
  const a = new T.Vector3(), b = new T.Vector3(), h = new T.Vector3();
  let active: T.AnimationAction | undefined, bites: number | undefined, still = 0;
  function pose(g: Gnawer, travel: number, dt: number, reducedMotion: boolean) {
    // Standing still a moment while roaming, it idles.
    still = travel > 0.002 ? 0 : still+dt;
    const name = g.mode === 'roam' && still > 0.3 ? 'Idle' : clips[g.mode], next = actions.get(name)!;
    if (next !== active) {
      next.reset().setEffectiveWeight(active ? 0 : 1).play();
      active = next;
    }
    if (name in strides) next.timeScale = dt > 0 ? T.MathUtils.clamp(travel/dt/strides[name]*next.getClip().duration,0,2.5) : 0;
    else next.timeScale = 1;
    if (reducedMotion) next.timeScale *= 0.45;
    // A fresh bite (not one seen on first sight) plays once over the top.
    if (bites !== undefined && (g.bites ?? 0) > bites) bite.reset().setEffectiveWeight(1).play();
    bites = g.bites ?? 0;
    const blend = 1-Math.exp(-dt*14);
    for (const action of actions.values()) {
      if (action === bite) continue;
      if (action === next) action.setEffectiveWeight(T.MathUtils.lerp(action.weight,1,blend));
      else if (action.weight > 0 && action.isScheduled()) {
        const weight = action.weight*(1-blend);
        if (weight < 0.002) action.stop(); else action.setEffectiveWeight(weight);
      }
    }
    mixer.update(dt);
  }
  function jaws(out: T.Vector3) {
    root.updateMatrixWorld(true);
    left.getWorldPosition(a); right.getWorldPosition(b); head.getWorldPosition(h);
    // Midway between the mandibles, a little ahead of them, out from the head.
    return out.copy(a).add(b).multiplyScalar(0.5).sub(h).multiplyScalar(1.6).add(h);
  }
  return {group,pose,jaws,playing:() => active?.getClip().name ?? '',dispose() {
    mixer.stopAllAction(); mixer.uncacheRoot(root);
    const skeletons = new Set<T.Skeleton>();
    root.traverse(o => { if (o instanceof T.SkinnedMesh) skeletons.add(o.skeleton); });
    for (const skeleton of skeletons) skeleton.dispose();
    group.removeFromParent();
  }};
}
