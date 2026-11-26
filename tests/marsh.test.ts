import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkable } from '../src/layout.ts';
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
    assert.ok(pools.length >= 15,'seed '+seed+': '+pools.length+' circles of water');
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

test('boardwalks cross the pools, and carry the trails across the water', () => marsh(() => {
  for (const seed of seeds) {
    const map = outdoors(seed);
    assert.ok(map.boardwalks.length >= 10,'seed '+seed+': '+map.boardwalks.length+' decks');
    // Every deck stands over water, a step above it.
    for (const b of map.boardwalks) { const pool = poolAt(map.water,b.x,b.z)!; assert.ok(pool && Math.abs(b.y-pool.level-0.18) < 1e-6); }
    for (const line of map.trails) for (const p of line) {
      const pool = poolAt(map.water,p.x,p.z);
      if (!pool || pool.level-groundAt(map,p.x,p.z) < 0.12) continue;
      assert.ok(map.boardwalks.some(b => Math.abs(b.x-p.x) <= b.w/2 && Math.abs(b.z-p.z) <= b.d/2),'seed '+seed+': a deck under the trail at '+p.x.toFixed(1)+','+p.z.toFixed(1));
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
  // In a wide shallow pool, ankle to knee deep, versus the dry plot.
  const pool = pools.filter(q => q.depth < 1).sort((a,b) => b.r-a.r)[0];
  const mud = walk(pool.x,pool.z+pool.r*0.3), dry = walk(map.exit.x,map.exit.z+3);
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
