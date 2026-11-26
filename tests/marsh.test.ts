import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collisionIndex, walkable } from '../src/layout.ts';
import { forceMap, mapKind, mapKinds } from '../src/map-kinds.ts';
import { groundAt, outdoors } from '../src/places.ts';
import { headHeight, poolAt, waterLevel } from '../src/room-templates.ts';
import { generateLayout } from '../src/server/generate-layout.ts';
import { inSight } from '../src/server/stalkers.ts';
import { Simulation } from '../src/server/simulation.ts';

// Marsh maps for these seeds; the draw is restored after each test.
const marsh = <T>(run: () => T) => { forceMap('marsh'); try { return run(); } finally { forceMap(); } };
const seeds = [3,19,77,101,512,2024,40000,77777];

test('each expedition draws its map kind from its seed, every kind turning up', () => {
  const count = new Map<string,number>();
  for (let seed=0;seed<2000;seed++) count.set(mapKind(seed),(count.get(mapKind(seed)) ?? 0)+1);
  for (const kind of mapKinds) assert.ok((count.get(kind) ?? 0) > 2000/mapKinds.length*0.8,kind+': '+count.get(kind));
  assert.equal(mapKind(1234),mapKind(1234));
  marsh(() => assert.equal(mapKind(1234),'marsh'));
});

test('a marsh is playable: every door, the bell and both spawns reachable, and the arrival, plot and doors dry', () => marsh(() => {
  for (const seed of seeds) {
    const map = outdoors(seed);
    assert.equal(map.kind,'marsh');
    const reached = walkable(map.geometry,map.spawns[0],[],0.5);
    for (const p of [...map.doors.map(d => d.exit),map.ringing,map.spawns[1]]) assert.ok(reached(p),'seed '+seed+': reach '+JSON.stringify(p));
    for (const p of [map.arrival,map.ringing,...map.doors.map(d => d.exit)]) assert.equal(poolAt(map.water,p.x,p.z),undefined,'seed '+seed+': dry at '+JSON.stringify(p));
  }
}));

test('its pools are wide and shallow, some hiding a sinkhole', () => marsh(() => {
  let sinkholes = 0;
  for (const seed of seeds) {
    const map = outdoors(seed), pools = map.water.pools ?? [];
    assert.ok(pools.length >= 12,'seed '+seed+': '+pools.length+' circles of water');
    for (const p of pools) {
      const depth = p.level-groundAt(map,p.x,p.z);
      if (p.depth > 1) { sinkholes++; assert.ok(depth > headHeight,'a sinkhole is over the head: '+depth.toFixed(2)); }
    }
    // Shallow pools can be waded: mostly under the knees.
    const shallow = pools.filter(p => p.depth < 1);
    assert.ok(shallow.every(p => p.depth <= 0.65));
  }
  assert.ok(sinkholes >= seeds.length/2,'sinkholes: '+sinkholes);
}));

test('the water never hangs in the air: wherever its sheet ends, the ground beside it stands at or above it', () => marsh(() => {
  // As in water.test.ts: the cells the water's mesh is drawn over.
  for (const seed of seeds) {
    const m = outdoors(seed), f = m.ground, n = f.n, cache = new Map<number,number | undefined>();
    const level = (i: number, k: number) => { const j = k*n+i; if (!cache.has(j)) cache.set(j,waterLevel(m.water,f.x0+i,f.z0+k)); return cache.get(j); };
    const corners = (i: number, k: number) => [[i,k],[i+1,k],[i+1,k+1],[i,k+1]] as const;
    const top = (i: number, k: number) => {
      const known = corners(i,k).map(([a,b]) => level(a,b)).filter((l): l is number => l !== undefined);
      if (!known.length) return;
      const t = Math.max(...known);
      return corners(i,k).some(([a,b]) => f.h[b*n+a] < (level(a,b) ?? t)-0.01) ? t : undefined;
    };
    const hanging: string[] = [];
    for (let k=2;k<n-4;k++) for (let i=2;i<n-4;i++) {
      const t = top(i,k);
      if (t === undefined) continue;
      for (const [di,dk,edge] of [[1,0,[[i+1,k],[i+1,k+1]]],[-1,0,[[i,k],[i,k+1]]],[0,1,[[i,k+1],[i+1,k+1]]],[0,-1,[[i,k],[i+1,k]]]] as const) {
        if (top(i+di,k+dk) !== undefined) continue;
        const gap = Math.max(...edge.map(([a,b]) => (level(a,b) ?? t)-f.h[b*n+a]));
        if (gap > 0.05) hanging.push((f.x0+i)+','+(f.z0+k)+' by '+gap.toFixed(2));
      }
    }
    assert.deepEqual(hanging,[],'seed '+seed);
  }
}));

test('boardwalks cross the pools and carry trails over water, coming ashore on dry land a step from the water at both ends', () => marsh(() => {
  for (const seed of seeds) {
    const map = outdoors(seed);
    assert.ok(map.boardwalks.length >= 10,'seed '+seed+': '+map.boardwalks.length+' decks');
    // Over water a deck stands a step above it; on land, never higher, and
    // down to half sunk in the mud.
    for (const b of map.boardwalks) {
      const pool = poolAt(map.water,b.x,b.z);
      if (pool) assert.ok(Math.abs(b.y-pool.level-0.18) < 0.011,'over water');
      else assert.ok(b.y >= groundAt(map,b.x,b.z)-0.1,'on land, not buried');
    }
    // From deck to neighbouring deck is never more than a step.
    for (const b of map.boardwalks) for (const o of map.boardwalks) if (Math.abs(o.x-b.x) <= 1.05 && Math.abs(o.z-b.z) <= 1.05) assert.ok(Math.abs(o.y-b.y) <= 0.32,'seed '+seed+': a step between decks at '+b.x+','+b.z);
    // Nothing solid (a boulder, a wreck, a ruin) stands on a deck.
    const index = collisionIndex(map.geometry);
    for (const b of map.boardwalks) assert.ok(index.clear(b.x,b.z,b.y,0.4),'seed '+seed+': clear deck at '+b.x+','+b.z);
    // Every run of decks ends on dry land.
    const near = (a: {x: number; z: number}, b: {x: number; z: number}) => a !== b && Math.abs(a.x-b.x) <= 1.05 && Math.abs(a.z-b.z) <= 1.05;
    for (const b of map.boardwalks) {
      if (map.boardwalks.filter(o => near(o,b)).length > 1) continue;
      assert.equal(poolAt(map.water,b.x,b.z),undefined,'seed '+seed+': a boardwalk ends on dry land at '+b.x+','+b.z);
    }
  }
}));

test('mud slows a walker; a sinkhole drowns one', () => marsh(() => {
  const seed = seeds.find(s => (outdoors(s).water.pools ?? []).some(p => p.depth > 1))!, map = outdoors(seed), pools = map.water.pools!;
  const sim = new Simulation(generateLayout(seed),'coop','inside');
  sim.join();
  const p = sim.state.players[0];
  const walk = (x: number, z: number) => {
    Object.assign(p,{place:'outside',x,z,feetY:groundAt(map,x,z),yaw:0}); delete p.vy;
    sim.inputs.set(1,{forward:1,right:0,yaw:0,pitch:0});
    for (let i=0;i<10;i++) sim.tick(1/30);
    return Math.hypot(p.x-x,p.z-z);
  };
  // Ankle to knee deep, with half a metre of the same ahead, versus the dry plot.
  const depth = (x: number, z: number) => (waterLevel(map.water,x,z) ?? -Infinity)-groundAt(map,x,z);
  let spot: {x: number; z: number} | undefined;
  for (const q of pools) for (let a=0;a<16 && !spot;a++) for (const f of [0.3,0.5,0.7]) {
    const x = q.x+Math.cos(a/16*Math.PI*2)*q.r*f, z = q.z+Math.sin(a/16*Math.PI*2)*q.r*f;
    if ([0,-0.4,-0.8].every(dz => depth(x,z+dz) > 0.18 && depth(x,z+dz) < 0.45)) { spot = {x,z}; break; }
  }
  assert.ok(spot,'mud to walk in');
  const mud = walk(spot!.x,spot!.z), dry = walk(map.exit.x,map.exit.z+3);
  assert.ok(mud < dry*0.85 && mud > dry*0.5,'mud '+mud.toFixed(2)+' m against '+dry.toFixed(2)+' m');
  const hole = pools.find(q => q.depth > 1)!;
  Object.assign(p,{x:hole.x,z:hole.z,feetY:groundAt(map,hole.x,hole.z)}); delete p.vy;
  sim.inputs.set(1,{forward:0,right:0,yaw:0,pitch:0});
  for (let i=0;i<30*8 && !sim.state.mission!.dead?.length;i++) sim.tick(1/30);
  assert.deepEqual(sim.state.mission!.dead,[1],'drowned in the sinkhole');
}));

test('fog shortens a stalker\'s sight: 20 m off in the open it sees in the hills, not in the marsh', () => {
  const sees = (kind: 'hills' | 'marsh') => {
    forceMap(kind);
    try {
      for (const seed of seeds) {
        const layout = generateLayout(seed), map = outdoors(seed);
        // Two points 20 m apart in plain sight of each other.
        for (let x=-50;x<=30;x+=5) for (let z=-50;z<=50;z+=5) {
          const a = {x,y:groundAt(map,x,z),z}, b = {x:x+20,y:groundAt(map,x+20,z),z};
          if (waterLevel(map.water,a.x,a.z) !== undefined || waterLevel(map.water,b.x,b.z) !== undefined || !inSight(layout,a,b)) continue;
          const sim = new Simulation(layout,'coop','inside');
          sim.join();
          const p = sim.state.players[0];
          Object.assign(p,{place:'outside',x:b.x,z:b.z,feetY:b.y}); delete p.vy;
          sim.inputs.set(1,{forward:0,right:0,yaw:0,pitch:0});
          sim.state.mission!.stalkers = [{id:1,x:a.x,y:a.y,z:a.z,yaw:-Math.PI/2,mode:'roam'}];
          for (let i=0;i<15;i++) sim.tick(1/30);
          return sim.state.mission!.stalkers![0].mode === 'stalk';
        }
      }
      throw Error('no open ground');
    } finally { forceMap(); }
  };
  assert.equal(sees('hills'),true);
  assert.equal(sees('marsh'),false);
});
