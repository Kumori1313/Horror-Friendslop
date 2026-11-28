import type { Geometry, Layout } from './layout.ts';
import { doorHeight, doorWidth } from './room-templates.ts';
import type { Point3 } from './room-templates.ts';

// A doorway seen from one side: the rectangle an operator can look through.
export interface Portal { from: string; to: string; door?: string; corners: Point3[]; shaft?: boolean }
export type PortalGraph = Map<string,Portal[]>;
type Rect = [number,number,number,number];

export function portalGraph(layout: Layout, g: Geometry): PortalGraph {
  const graph: PortalGraph = new Map(layout.rooms.map(r => [r.id,[]]));
  for (const o of g.openings) {
    const passage = layout.passages[o.index];
    const alongX = o.side === 'north' || o.side === 'south';
    const corners = [-1,1].flatMap(s => [0,doorHeight].map(h => ({
      x:o.x+(alongX ? s*doorWidth/2 : 0), y:o.y+h, z:o.z+(alongX ? 0 : s*doorWidth/2),
    })));
    const door = passage?.bulkhead ? passage.id : undefined;
    graph.get(o.a)!.push({from:o.a,to:o.b,door,corners,shaft:o.shaft});
    graph.get(o.b)!.push({from:o.b,to:o.a,door,corners,shaft:o.shaft});
  }
  return graph;
}

// Rooms the camera can see: its own room, then every room whose doorway falls
// inside the screen window left by the doorways before it. A doorway's screen
// bounds contain everything seen through it, so a visible room is never left out.
// `viewProjection` holds a column-major 4×4 matrix (Three's Matrix4.elements).
export function visibleRooms(graph: PortalGraph, start: string, viewProjection: ArrayLike<number>, eye: Point3,
  opened: readonly string[], far = 48, depth = 14) {
  const e = viewProjection;
  const seen = new Map<string,Rect[]>([[start,[[-1,-1,1,1]]]]);
  const queue: [string,Rect,number][] = [[start,[-1,-1,1,1],0]];
  for (let i=0;i<queue.length;i++) {
    const [room,window,level] = queue[i];
    if (level >= depth) continue;
    for (const portal of graph.get(room) ?? []) {
      if (portal.door && !opened.includes(portal.door)) continue;
      const [a,,,d] = portal.corners;
      // Nearest point of the doorway rectangle, for the fog cutoff.
      const nx = Math.max(Math.min(a.x,d.x),Math.min(eye.x,Math.max(a.x,d.x)));
      const ny = Math.max(a.y,Math.min(eye.y,d.y));
      const nz = Math.max(Math.min(a.z,d.z),Math.min(eye.z,Math.max(a.z,d.z)));
      if (!portal.shaft && Math.hypot(nx-eye.x,ny-eye.y,nz-eye.z) > far) continue;
      // Successive flights share one open column. A side room still needs
      // a real doorway in the remaining screen window.
      const rect = portal.shaft ? window : screenBounds(e,portal.corners);
      if (!rect) continue;
      const clipped: Rect = [Math.max(rect[0],window[0]),Math.max(rect[1],window[1]),Math.min(rect[2],window[2]),Math.min(rect[3],window[3])];
      if (clipped[0] >= clipped[2] || clipped[1] >= clipped[3]) continue;
      const earlier = seen.get(portal.to) ?? [];
      if (earlier.some(r => r[0] <= clipped[0] && r[1] <= clipped[1] && r[2] >= clipped[2] && r[3] >= clipped[3])) continue;
      seen.set(portal.to,[...earlier,clipped]);
      queue.push([portal.to,clipped,level+1]);
    }
  }
  return new Set(seen.keys());
}

// Screen bounds of a doorway after clipping it to the part in front of the
// camera, so a doorway beside or behind the viewer does not claim the screen.
function screenBounds(e: ArrayLike<number>, corners: Point3[]): Rect | undefined {
  const near = 1e-3;
  const clip = [0,1,3,2].map(i => {
    const c = corners[i];
    return [e[0]*c.x+e[4]*c.y+e[8]*c.z+e[12],e[1]*c.x+e[5]*c.y+e[9]*c.z+e[13],e[3]*c.x+e[7]*c.y+e[11]*c.z+e[15]];
  });
  const kept: number[][] = [];
  clip.forEach((p,i) => {
    const q = clip[(i+1)%clip.length];
    if (p[2] > near) kept.push(p);
    if ((p[2] > near) !== (q[2] > near)) {
      const t = (near-p[2])/(q[2]-p[2]);
      kept.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t,near]);
    }
  });
  if (!kept.length) return;
  const xs = kept.map(p => p[0]/p[2]), ys = kept.map(p => p[1]/p[2]);
  return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
}
