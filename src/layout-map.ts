import { anchor, geometryFor } from './layout.ts';
import { items } from './mission.ts';
import type { Layout } from './layout.ts';
import { storey } from './room-templates.ts';
import type { Snapshot } from './room.ts';

const letters: Record<string,string> = {intake:'I',stairwell:'≡'};

// Ground storey on the left, upper storey on the right, drawn from the room floors.
export function drawMap(canvas: HTMLCanvasElement, layout: Layout, state: Snapshot) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const g = geometryFor(layout);
  const xs = g.surfaces.flatMap(s => [s.x-s.w/2,s.x+s.w/2]), zs = g.surfaces.flatMap(s => [s.z-s.d/2,s.z+s.d/2]);
  const x0 = Math.min(...xs), z0 = Math.min(...zs);
  const panel = (canvas.width-12)/2;
  const scale = Math.min((panel-8)/(Math.max(...xs)-x0),(canvas.height-20)/(Math.max(...zs)-z0));
  const level = (y: number) => y >= storey-0.5 ? 1 : 0;
  const x = (v: number, y: number) => 4+level(y)*(panel+4)+(v-x0)*scale;
  const z = (v: number) => 16+(v-z0)*scale;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = '#9db3aa'; ctx.font = '10px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('GROUND',4,2); ctx.fillText('UPPER',panel+8,2);
  const byId = new Map(layout.rooms.map(r => [r.id,r]));
  for (const s of g.surfaces) {
    const kind = byId.get(s.room)!.kind;
    ctx.fillStyle = s.rise ? '#5f7a72' : kind === 'corridor' ? '#3b4d4a' : '#4a5f5a';
    const y = s.rise ? s.y+s.rise/2 : s.y;
    ctx.fillRect(x(s.x-s.w/2,y),z(s.z-s.d/2),s.w*scale,s.d*scale);
  }
  for (const d of g.doors) {
    ctx.fillStyle = state.opened?.includes(d.id) ? '#8eaaa1' : '#e4ab58';
    ctx.fillRect(x(d.x,d.y)-3,z(d.z)-3,6,6);
  }
  for (const room of layout.rooms) {
    const label = letters[room.kind] ?? '';
    if (!label) continue;
    const a = anchor(room);
    ctx.fillStyle = '#dbce9b'; ctx.fillRect(x(a.x,a.y)-6,z(a.z)-6,12,12);
    ctx.fillStyle='#15201f'; ctx.font='bold 10px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(label,x(a.x,a.y),z(a.z));
  }
  // Salvage still in the facility, as amber dots.
  if (state.mission) {
    ctx.fillStyle = '#e8b04f';
    for (const i of items(layout,state.mission)) {
      if (i.owner !== null || i.banked || i.place !== 'inside') continue;
      ctx.fillRect(x(i.x,i.y)-1.5,z(i.z)-1.5,3,3);
    }
  }
  const diver = state.mission?.diver;
  const lair = diver && byId.get(diver.bay);
  if (lair && ['tracking','warning','strike'].includes(diver.mode)) {
    const a = anchor(lair);
    ctx.strokeStyle = '#ff714d'; ctx.lineWidth = 2;
    ctx.strokeRect(x(a.x,a.y)-8,z(a.z)-8,16,16);
  }
  for (const p of state.players) {
    const px = x(p.x,p.feetY ?? 0), pz = z(p.z);
    ctx.fillStyle = p.id===1 ? '#ff8451' : '#6df5ed';
    if (state.mission?.down.some(d => d.id === p.id)) {
      ctx.fillStyle='#fff'; ctx.fillRect(px-4,pz-1,8,3); ctx.fillRect(px-1,pz-4,3,8);
      continue;
    }
    ctx.beginPath(); ctx.arc(px,pz,3,0,2*Math.PI); ctx.fill();
  }
}
