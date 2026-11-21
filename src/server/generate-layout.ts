import { distances, generatorVersion, pitch, validLayout } from '../layout.ts';
import type { Kind, Layout, Module, Passage } from '../layout.ts';

function randomSource(seed: number) {
  let n = seed >>> 0;
  return () => {
    n = (n + 0x6d2b79f5) >>> 0;
    let t = Math.imul(n ^ (n >>> 15),1 | n);
    t ^= t + Math.imul(t ^ (t >>> 7),61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function assemble(seed: number, cells: number[][], pairs: number[][], random: () => number, fallback: boolean): Layout {
  const kit: Kind[] = ['pump','stores','junction'];
  const rooms: Module[] = cells.map(([x,z],i) => ({
    id:'bay-'+i, x:x*pitch,z:z*pitch, kind:i === 0 ? 'intake' : kit[Math.floor(random()*kit.length)],
    rotation:Math.floor(random()*4),
  }));
  const passages: Passage[] = pairs.map(([a,b]) => ({
    a:rooms[a].id,b:rooms[b].id,id:'passage-'+a+'-'+b,bulkhead:a===0,
  }));
  function farthest(start: string, excluded: string[]) {
    const steps = distances(rooms,passages,start);
    return rooms.filter(r => !excluded.includes(r.id)).sort((a,b) => steps.get(b.id)!-steps.get(a.id)!)[0];
  }
  const objective = farthest(rooms[0].id,[rooms[0].id]);
  const exit = farthest(objective.id,[rooms[0].id,rooms[1].id,objective.id]);
  objective.kind = 'relay'; exit.kind = 'exit';
  const spare = rooms.filter(r => r.kind !== 'intake' && r !== objective && r !== exit);
  spare[0].kind = 'chiller';
  spare[1+Math.floor(random()*(spare.length-1))].kind = 'switchboard';
  passages.find(edge => edge.a===exit.id || edge.b===exit.id)!.bulkhead = true;
  const callout = seed % 2 === 0 ? 'black-start' : 'line-test';
  return {callout,version:generatorVersion,seed,fallback,rooms,passages,objectiveId:objective.id,exitId:exit.id,lampId:'inspection-light'};
}

export function generateLayout(seed: number, attempts = 8): Layout {
  seed >>>= 0;
  const random = randomSource(seed);
  const pick = <T>(values:T[]) => values[Math.floor(random()*values.length)];
  for (let attempt=0; attempt<attempts; attempt++) {
    const cells = [[0,0],[0,-1]], pairs = [[0,1]];
    const count = 12+Math.floor(random()*4);
    while (cells.length < count) {
      const frontier: number[][] = [];
      cells.forEach(([x,z],i) => {
        if (i === 0) return;
        for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx=x+dx,nz=z+dz;
          if (Math.abs(nx)<=2 && nz>=-4 && nz<=-1 && !cells.some(([a,b]) => a===nx && b===nz)) frontier.push([i,nx,nz]);
        }
      });
      if (!frontier.length) break;
      const [from,x,z] = pick(frontier);
      pairs.push([from,cells.length]); cells.push([x,z]);
    }
    const shortcuts: number[][] = [];
    for (let a=1;a<cells.length;a++) for (let b=a+1;b<cells.length;b++) {
      if (Math.abs(cells[a][0]-cells[b][0])+Math.abs(cells[a][1]-cells[b][1])===1 &&
          !pairs.some(([u,v])=>u===a && v===b)) shortcuts.push([a,b]);
    }
    if (!shortcuts.length) continue;
    while (shortcuts.length && pairs.length < cells.length+1) {
      pairs.push(shortcuts.splice(Math.floor(random()*shortcuts.length),1)[0]);
    }
    const layout = assemble(seed,cells,pairs,random,false);
    if (validLayout(layout)) return layout;
  }
  return assemble(seed,[[0,0],[0,-1],[0,-2],[1,-2],[1,-1],[2,-2],[-1,-1]],
    [[0,1],[1,2],[2,3],[3,4],[4,1],[3,5],[1,6]],randomSource(0),true);
}
