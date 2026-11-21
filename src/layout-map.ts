import { pitch } from './layout.ts';
import type { Layout } from './layout.ts';
import type { Snapshot } from './room.ts';

export function drawMap(canvas: HTMLCanvasElement, layout: Layout, state: Snapshot) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const xs = layout.rooms.map(r => r.x), zs = layout.rooms.map(r => r.z);
  const x0 = Math.min(...xs), z0 = Math.min(...zs);
  const scale = Math.min((canvas.width-34)/(Math.max(...xs)-x0+pitch),(canvas.height-20)/(Math.max(...zs)-z0+pitch));
  const x = (v:number) => 17+(v-x0+pitch/2)*scale;
  const z = (v:number) => 10+(v-z0+pitch/2)*scale;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const byId = new Map(layout.rooms.map(r => [r.id,r]));
  for (const link of layout.passages) {
    const a = byId.get(link.a)!, b = byId.get(link.b)!;
    ctx.strokeStyle = link.bulkhead && !state.opened?.includes(link.id) ? '#e4ab58' : '#8eaaa1';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x(a.x),z(a.z)); ctx.lineTo(x(b.x),z(b.z)); ctx.stroke();
  }
  for (const room of layout.rooms) {
    const label = {intake:'I',relay:'R',exit:'X',junction:'',pump:'',stores:'',switchboard:'S',chiller:'C'}[room.kind];
    ctx.fillStyle = label ? '#dbce9b' : '#78938a';
    ctx.fillRect(x(room.x)-9,z(room.z)-9,18,18);
    ctx.fillStyle='#15201f'; ctx.font='bold 13px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(label,x(room.x),z(room.z));
  }
  const diver = state.mission?.diver;
  if (diver && ['tracking','warning','strike'].includes(diver.mode)) {
    const bay = byId.get(diver.bay)!;
    ctx.strokeStyle = '#ff714d'; ctx.lineWidth = 2;
    ctx.strokeRect(x(bay.x)-10,z(bay.z)-10,20,20);
  }
  for (const p of state.players) {
    ctx.fillStyle=p.id===1?'#ff8451':'#6df5ed';
    if (state.mission?.down.some(d => d.id === p.id)) {
      ctx.fillStyle='#fff'; ctx.fillRect(x(p.x)-4,z(p.z)-1,8,3); ctx.fillRect(x(p.x)-1,z(p.z)-4,3,8);
      continue;
    }
    ctx.beginPath(); ctx.arc(x(p.x),z(p.z),3,0,2*Math.PI); ctx.fill();
  }
}
