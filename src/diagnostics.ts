import { drawMap } from './layout-map.ts';
import type { Layout } from './layout.ts';
import type { Snapshot } from './room.ts';
import type { RoomConnection } from './connection.ts';
import type { Crew } from './creator-session.ts';

export function mountDiagnostics(sceneStarted: number, interrupt: () => void) {
  document.querySelector('main')!.insertAdjacentHTML('beforeend',`
    <aside id="diagnostics" hidden>
      <h2>Room diagnostics</h2>
      <div id="floor-plan" hidden>
        <canvas id="layout-map" width="300" height="175" aria-label="Facility floor plan"></canvas>
        <small>I · Intake　S · Switchboard　C · Chiller　R · Relay　X · Exit</small>
      </div>
      <pre id="stats"></pre><button id="outage">Simulate 2 s outage</button>
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
  document.getElementById('outage')!.onclick = interrupt;
  window.addEventListener('keydown',e => {
    if (e.code === 'KeyG' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey &&
        !document.querySelector<HTMLDialogElement>('#preferences')!.open) toggle();
  });
  function update(s: Snapshot, layout: Layout | undefined, metrics: RoomConnection['metrics'], crew: Crew | undefined, delay: number) {
    if (panel.hidden) return;
    floorPlan.hidden = !layout;
    if (layout) drawMap(map,layout,s);
    const opened = s.opened ?? [];
    const l = s.lamp;
    const pos = (x: number,z: number) => x.toFixed(2) + ', ' + z.toFixed(2);
    stats.textContent = [
      'Build   ' + import.meta.env.VITE_RELAY_BUILD, 'Round   ' + s.round, 'Update  ' + s.update, 'RTT     ' + Math.round(metrics.rtt) + ' ms',
      'Frame p95  '+(frameP95 ? frameP95.toFixed(1)+' ms' : 'sampling'),
      'Scene ready  '+Math.round(readyMs)+' ms',
      crew ? 'Network   '+(crew.host ? 'Lobby creator (host)' : 'Guest')+' · Supabase Realtime' : 'Delay   ' + delay + ' ms each way',
      'RX/TX   ' + Math.round(metrics.downRate) + ' / ' + Math.round(metrics.upRate) + ' B/s',
      'Recovery  ' + Math.round(metrics.recovery) + ' ms',
      ...s.players.map(player => 'P' + player.id + '  x,z  ' + pos(player.x,player.z) + (player.connected ? '' : ' (reconnecting)')),
      ...(s.mission ? ['Shift   '+s.mission.stage, ...s.mission.down.map(d => 'Down    P'+d.id)] : []),
      'Light   ' + (l.owner ? 'P' + l.owner : 'floor') + (l.on ? ' · on' : ' · off'),
      'Lamp x,z  ' + pos(l.x,l.z),
      ...(layout ? [
        'Layout v' + layout.version + ' · seed ' + layout.seed + (layout.fallback ? ' (fallback)' : ''),
        'Rooms   ' + layout.rooms.length + ' · passages ' + layout.passages.length,
        'Relay   ' + layout.objectiveId + ' · Exit ' + layout.exitId,
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
