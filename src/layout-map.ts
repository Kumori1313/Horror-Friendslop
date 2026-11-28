import { anchor, geometryFor, isSpireFlight } from './layout.ts';
import { facilityStoreys } from './facility-kinds.ts';
import { items } from './mission.ts';
import type { Layout } from './layout.ts';
import { storey } from './room-templates.ts';
import type { Snapshot } from './room.ts';

const letters: Record<string,string> = {intake:'I',stairwell:'≡'};

// Draw each storey from the same footprint, with upper floors in a second row if needed.
export function drawMap(canvas: HTMLCanvasElement, layout: Layout, state: Snapshot) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const g = geometryFor(layout);
  const xs = g.surfaces.flatMap(s => [s.x-s.w/2,s.x+s.w/2]), zs = g.surfaces.flatMap(s => [s.z-s.d/2,s.z+s.d/2]);
  const x0 = Math.min(...xs), z0 = Math.min(...zs);
  const floors = facilityStoreys[layout.facility], panelW = canvas.width/2, panelH = canvas.height/Math.ceil(floors/2);
  const scale = Math.min((panelW-16)/(Math.max(...xs)-x0),(panelH-20)/(Math.max(...zs)-z0));
  const level = (y: number) => Math.max(0,Math.min(floors-1,Math.floor((y+0.5)/storey)));
  const col = (floor: number) => (floor%2)*panelW, row = (floor: number) => Math.floor(floor/2)*panelH;
  const x = (v: number, y: number) => 8+col(level(y))+(v-x0)*scale;
  const z = (v: number, y: number) => 16+row(level(y))+(v-z0)*scale;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = '#9db3aa'; ctx.font = '10px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  for (let floor=0; floor<floors; floor++) {
    const label = floors === 2 ? (floor === 0 ? 'GROUND' : 'UPPER') : 'FLOOR '+(floor+1);
    ctx.fillText(label,8+col(floor),2+row(floor));
  }
  const byId = new Map(layout.rooms.map(r => [r.id,r]));
  for (const s of g.surfaces) {
    const kind = byId.get(s.room)!.kind;
    ctx.fillStyle = s.rise ? '#5f7a72' : kind === 'corridor' ? '#3b4d4a' : '#4a5f5a';
    const y = s.rise ? s.y+s.rise/2 : s.y;
    ctx.fillRect(x(s.x-s.w/2,y),z(s.z-s.d/2,y),s.w*scale,s.d*scale);
  }
  for (const d of g.doors) {
    ctx.fillStyle = state.opened?.includes(d.id) ? '#8eaaa1' : '#e4ab58';
    ctx.fillRect(x(d.x,d.y)-3,z(d.z,d.y)-3,6,6);
  }
  for (const room of layout.rooms) {
    const label = isSpireFlight(room) ? 'S' : letters[room.kind] ?? '';
    if (!label) continue;
    const a = anchor(room);
    ctx.fillStyle = '#dbce9b'; ctx.fillRect(x(a.x,a.y)-6,z(a.z,a.y)-6,12,12);
    ctx.fillStyle='#15201f'; ctx.font='bold 10px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(label,x(a.x,a.y),z(a.z,a.y));
  }
  // Salvage still in the facility, as amber dots.
  if (state.mission) {
    ctx.fillStyle = '#e8b04f';
    for (const i of items(layout,state.mission)) {
      if (i.owner !== null || i.banked || i.place !== 'inside') continue;
      ctx.fillRect(x(i.x,i.y)-1.5,z(i.z,i.y)-1.5,3,3);
    }
  }
  const diver = state.mission?.diver;
  const lair = diver && byId.get(diver.bay);
  if (lair && diver.mode !== 'dormant') {
    // Where it hangs; filled from the start of a drop until it lands.
    const a = anchor(lair), dx = diver.x ?? a.x, dy = diver.y ?? a.y, dz = diver.z ?? a.z;
    ctx.strokeStyle = ctx.fillStyle = '#ff714d'; ctx.lineWidth = 2;
    if (diver.drop !== undefined || diver.mode === 'falling' || diver.mode === 'strike') ctx.fillRect(x(dx,dy)-6,z(dz,dy)-6,12,12);
    else ctx.strokeRect(x(dx,dy)-6,z(dz,dy)-6,12,12);
  }
  for (const p of state.players) {
    const y = p.feetY ?? 0, px = x(p.x,y), pz = z(p.z,y);
    ctx.fillStyle = p.id===1 ? '#ff8451' : '#6df5ed';
    if (state.mission?.down.some(d => d.id === p.id)) {
      ctx.fillStyle='#fff'; ctx.fillRect(px-4,pz-1,8,3); ctx.fillRect(px-1,pz-4,3,8);
      continue;
    }
    ctx.beginPath(); ctx.arc(px,pz,3,0,2*Math.PI); ctx.fill();
  }
}
