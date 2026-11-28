import { drawMap } from './layout-map.ts';
import { facilityNames } from './facility-kinds.ts';
import { wallet } from './mission.ts';
import type { Layout } from './layout.ts';
import { batteryLife, chargeOf, type Snapshot } from './room.ts';
import type { RoomConnection } from './connection.ts';
import type { Crew } from './creator-session.ts';

export interface RenderStats { scale: number; drawn: number; rooms: number; calls: number }
export function mountDiagnostics(sceneStarted: number, interrupt?: () => void, render?: RenderStats, grant?: () => void) {
  document.querySelector('main')!.insertAdjacentHTML('beforeend',`
    <aside id="diagnostics" hidden>
      <h2>Room diagnostics</h2>
      <div id="floor-plan" hidden>
        <canvas id="layout-map" width="300" height="175" aria-label="Facility floor plan"></canvas>
        <small>I · Intake　S · Spire stairs　≡ · Stairwell　amber · salvage</small>
      </div>
      <pre id="stats"></pre><button id="outage">Simulate 2 s outage</button>
      <button id="grant">Grant 200 to the wallet</button>
    </aside>`);
  document.querySelector('footer')!.insertAdjacentHTML('beforeend','<button id="debug" aria-expanded="false">Diagnostics · G</button>');
  const panel = document.getElementById('diagnostics')!;
  const debug = document.getElementById('debug')!;
  const stats = document.getElementById('stats')!;
  const floorPlan = document.getElementById('floor-plan')!;
  const map = document.querySelector<HTMLCanvasElement>('#layout-map')!;
  let readyMs = 0, frameP95 = 0;
  let sampleStart = performance.now();
  const frameTimes: number[] = [];
  function toggle() {
    panel.hidden = !panel.hidden;
    debug.setAttribute('aria-expanded',String(!panel.hidden));
  }
  debug.onclick = toggle;
  const outage = document.getElementById('outage')!;
  outage.hidden = !interrupt;
  outage.onclick = interrupt ?? null;
  // Money for the shop, where this browser runs the simulation (solo or the hub host).
  const grantButton = document.getElementById('grant')!;
  grantButton.hidden = !grant;
  grantButton.onclick = grant ?? null;
  window.addEventListener('keydown',e => {
    if (e.code === 'KeyG' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey &&
        !document.querySelector<HTMLDialogElement>('#preferences')!.open) toggle();
  });
  function update(s: Snapshot, layout: Layout | undefined, metrics: RoomConnection['metrics'] | undefined, crew: Crew | undefined, delay: number) {
    if (panel.hidden) return;
    floorPlan.hidden = !layout;
    if (layout) drawMap(map,layout,s);
    const opened = s.opened ?? [];
    const l = s.lamp;
    const pos = (x: number,z: number) => x.toFixed(2) + ', ' + z.toFixed(2);
    stats.textContent = [
      'Build   ' + import.meta.env.VITE_RELAY_BUILD, 'Round   ' + s.round, 'Update  ' + s.update,
      'Frame p95  '+(frameP95 ? frameP95.toFixed(1)+' ms' : 'sampling'),
      'Scene ready  '+Math.round(readyMs)+' ms',
      ...(render ? ['Render  '+Math.round(render.scale*100)+'% · rooms '+render.drawn+'/'+render.rooms+' · draws '+render.calls] : []),
      ...(metrics ? [
        'RTT     ' + Math.round(metrics.rtt) + ' ms',
        crew ? 'Network   '+(crew.host ? 'Lobby creator (host)' : 'Guest')+' · Supabase Realtime' : 'Delay   ' + delay + ' ms each way',
        'RX/TX   ' + Math.round(metrics.downRate) + ' / ' + Math.round(metrics.upRate) + ' B/s',
        'Recovery  ' + Math.round(metrics.recovery) + ' ms',
      ] : ['Local solo simulation']),
      ...s.players.map(player => 'P' + player.id + '  x,z  ' + pos(player.x,player.z) + (player.connected ? '' : ' (reconnecting)')),
      ...(s.mission ? ['Shift   '+s.mission.stage, ...s.mission.down.map(d => 'Down    P'+d.id)] : []),
      'Light   ' + (l.owner ? 'P' + l.owner : 'floor') + (l.on ? ' · on' : ' · off'),
      'Lamp x,z  ' + pos(l.x,l.z),
      ...(layout ? [
        'Layout v' + layout.version + ' · ' + facilityNames[layout.facility] + ' · seed ' + layout.seed + (layout.fallback ? ' (fallback)' : ''),
        'Rooms   ' + layout.rooms.length + ' · passages ' + layout.passages.length,
        ...(s.mission ? ['Contract  '+s.mission.contract.seed+' · expedition '+(s.mission.contract.index+1)+'/'+s.mission.contract.expeditions+' · '+s.mission.contract.credited+'/'+s.mission.contract.quota+' · wallet '+wallet(s.mission.contract),
          'Salvage moved  '+s.mission.haul.length+(s.mission.awake ? ' · Diver awake' : ''),
          'Battery  '+chargeOf(l)+'/'+batteryLife+' s'+(l.on ? '' : ' (off)')+' · clock '+(s.mission.clock ?? 0)+' s'] : []),
        'Open doors  ' + (opened.join(', ') || 'none'),
      ] : []),
    ].join('\n');
  }
  function frame(now: number, elapsed: number, active: boolean) {
    if (active && !document.hidden) {
      frameTimes.push(elapsed);
      if (now-sampleStart >= 2000) {
        frameTimes.sort((a,b) => a-b);
        frameP95 = frameTimes[Math.ceil(frameTimes.length*0.95)-1];
        frameTimes.length = 0;
        sampleStart = now;
      }
    } else {
      sampleStart = now;
      frameTimes.length = 0;
    }
    if (active && !readyMs) readyMs = performance.now()-sceneStarted;
  }
  function setTouch(touch: boolean) { debug.textContent = touch ? 'Diagnostics' : 'Diagnostics · G'; }
  return {update,frame,setTouch};
}
