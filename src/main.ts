import './style.css';
import { canTake } from './room.ts';
import { RoomConnection } from './connection.ts';
import type { Admission, Ticket, Snapshot } from './room.ts';
import { bindDrag } from './touch.ts';
import { createScene } from './scene.ts';

function element<T extends HTMLElement>(id: string) {
  return document.getElementById(id) as T;
}
const canvas = element<HTMLCanvasElement>('scene');
const enter = element<HTMLButtonElement>('enter');
const brief = element('brief');
const status = element('connection');
const prompt = element('action');
const debug = element<HTMLButtonElement>('debug');
const panel = element('diagnostics');
const stats = element('stats');
const reticle = element('reticle');

function start(render: ReturnType<typeof createScene>, admission?: () => Promise<Admission>, scope = 'local') {
  const key = admission ? 'relay-room-seat-' + scope : 'relay-room-seat-v2';
  let saved: Ticket | null = null;
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (nav?.type !== 'navigate') {
    try { saved = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { /* Fresh session */ }
  }
  const url = new URL(admission ? '/relay-room/live' : '/live',location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (admission && import.meta.env.VITE_RELAY_RUNTIME_ORIGIN) {
    url.host = new URL(import.meta.env.VITE_RELAY_RUNTIME_ORIGIN).host;
    url.protocol = 'wss:';
  }
  const delay = Math.max(0,Math.min(500,Number(new URLSearchParams(location.search).get('delay')) || 0));
  let id = 0, yaw = 0, pitch = -0.12;
  let state: Snapshot | undefined;
  let playing = false;
  const keys = new Set<string>();
  let touchMode = matchMedia('(pointer: coarse)').matches;
  let stickX = 0, stickY = 0;
  const touchControls = element('touch-controls');
  const pad = element('move-pad');
  const thumb = element('thumb');
  const take = element<HTMLButtonElement>('take');
  const toggle = element<HTMLButtonElement>('toggle');
  function showControls() {
    touchControls.hidden = !playing || !touchMode;
    element('control-hint').textContent = touchMode ? 'Left pad to walk · Swipe the room to look' : 'WASD to walk · Mouse or arrows to look';
    debug.textContent = touchMode ? 'Diagnostics' : 'Diagnostics · G';
  }
  function look(dx: number, dy: number, sensitivity: number) {
    yaw -= dx * sensitivity;
    pitch = Math.max(-1.35,Math.min(1.35,pitch-dy*sensitivity));
  }
  const resetStick = bindDrag(pad,(dx,dy) => {
    const radius = (pad.clientWidth - thumb.offsetWidth) / 2;
    const scale = Math.max(radius,Math.hypot(dx,dy),1);
    stickX = dx / scale; stickY = dy / scale;
    thumb.style.transform = 'translate(' + (stickX * radius) + 'px,' + (stickY * radius) + 'px)';
    input();
  },false,() => playing,() => {
    stickX = stickY = 0;
    thumb.style.transform = '';
    if (playing) input();
  });
  const resetLook = bindDrag(canvas,(dx,dy) => look(dx,dy,0.005),true,() => playing);
  for (const surface of [enter,canvas] as HTMLElement[]) {
    surface.addEventListener('pointerdown', e => {
      touchMode = e.pointerType === 'touch';
      showControls();
    });
  }
  function useFlashlight() {
    if (playing && state) connection.action(state.lamp.owner === id ? 'drop' : 'take');
  }
  function switchLight() { if (playing && state) connection.action('toggle'); }
  take.onclick = useFlashlight;
  toggle.onclick = switchLight;
  showControls();
  function input() {
    connection.input({
      forward: Math.max(-1,Math.min(1,Number(keys.has('KeyW')) - Number(keys.has('KeyS')) - stickY)),
      right: Math.max(-1,Math.min(1,Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + stickX)), yaw, pitch,
    });
  }
  function pause() {
    keys.clear(); playing = false; resetStick(); resetLook(); showControls(); reticle.hidden = true; input();
  }
  function control() {
    if (!state) return;
    brief.hidden = true; reticle.hidden = false; playing = true;
    // Arrow-key look remains available when pointer capture is unavailable.
    showControls();
    if (!touchMode) canvas.requestPointerLock?.()?.catch(() => {});
  }
  function diagnostics() {
    panel.hidden = !panel.hidden;
    debug.setAttribute('aria-expanded',String(!panel.hidden));
  }
  enter.onclick = control;
  canvas.onclick = () => { if (!playing || (!touchMode && !document.pointerLockElement)) control(); };
  debug.onclick = diagnostics;
  window.addEventListener('blur',pause);
  document.addEventListener('visibilitychange',() => {
    if (document.hidden) pause();
    else if (state) connection.interrupt(0);
  });
  document.addEventListener('pointerlockchange',() => { if (!document.pointerLockElement) pause(); });
  window.addEventListener('mousemove',e => {
    if (playing && document.pointerLockElement === canvas) {
      look(e.movementX,e.movementY,0.0022);
    }
  });
  window.addEventListener('keydown',e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyG' && !e.repeat) diagnostics();
    if (!playing || !state) return;
    if (e.code.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'KeyE') useFlashlight();
    if (e.code === 'KeyF') switchLight();
    if (e.code === 'Escape') pause();
    input();
  });
  window.addEventListener('keyup',e => { keys.delete(e.code); if (playing) input(); });

  function updateHud(s: Snapshot) {
    const p = s.players.find(player => player.id === id);
    if (!p) return;
    status.textContent = 'Operator ' + id + '  ·  ' + s.players.filter(player => player.connected).length + '/2 online';
    const l = s.lamp;
    const holding = l.owner === id;
    if (touchMode) {
      take.disabled = !holding && !canTake(p,l);
      take.textContent = holding ? 'Drop' : 'Pick up';
      toggle.disabled = !holding;
      toggle.textContent = l.on ? 'Light off' : 'Light on';
    }
    if (!brief.hidden) prompt.textContent = s.players.length === 2 ? 'Both seats occupied' : 'Waiting for a partner';
    else if (!playing) prompt.textContent = touchMode ? 'Tap the room to resume' : 'Click the room to resume';
    else if (holding) prompt.textContent = touchMode ? 'You hold the flashlight' : 'E  Drop flashlight   ·   F  Switch ' + (l.on ? 'off' : 'on');
    else if (l.owner) prompt.textContent = 'Operator ' + l.owner + ' holds the flashlight';
    else prompt.textContent = canTake(p,l) ? (touchMode ? 'Flashlight within reach' : 'E  Pick up flashlight') : 'Move closer to the flashlight';
    if (!panel.hidden) {
      const pos = (x: number,z: number) => x.toFixed(2) + ', ' + z.toFixed(2);
      stats.textContent = [
        'Round   ' + s.round, 'Update  ' + s.update, 'RTT     ' + Math.round(connection.metrics.rtt) + ' ms',
        'Delay   ' + delay + ' ms each way',
        'RX/TX   ' + Math.round(connection.metrics.downRate) + ' / ' + Math.round(connection.metrics.upRate) + ' B/s',
        'Recovery  ' + Math.round(connection.metrics.recovery) + ' ms',
        ...s.players.map(player => 'P' + player.id + '  x,z  ' + pos(player.x,player.z) + (player.connected ? '' : ' (reconnecting)')),
        'Light   ' + (l.owner ? 'P' + l.owner : 'floor') + (l.on ? ' · on' : ' · off'),
        'Lamp x,z  ' + pos(l.x,l.z),
      ].join('\n');
    }
  }
  const connection = new RoomConnection(url.href,saved,{
    joined(seat,ticket) {
      id = seat;
      sessionStorage.setItem(key,JSON.stringify(ticket));
    },
    snapshot(snapshot, first) {
      state = snapshot;
      if (first) {
        const self = state.players.find(p => p.id === id)!;
        yaw = self.yaw;
        pitch = self.pitch;
        enter.disabled = false;
      }
      updateHud(state);
    },
    offline(reason, ended) {
      state = undefined;
      pause();
      if (document.pointerLockElement) document.exitPointerLock();
      status.textContent = ended ? reason : 'Reconnecting…';
      prompt.textContent = ended ? 'Join a new session when ready.' : 'Waiting for a fresh room snapshot.';
      if (ended) {
        sessionStorage.removeItem(key);
        brief.hidden = false;
        enter.disabled = false;
        enter.textContent = admission ? 'Return to Game Hub' : 'Join again';
        enter.onclick = admission ? () => element('live-leave').click() : () => location.reload();
      }
    },
  },delay,admission);
  connection.connect();
  element('outage').onclick = () => { if (state) connection.interrupt(2000); };
  window.addEventListener('pagehide',() => connection.stop());
  window.addEventListener('pageshow',e => { if (e.persisted) location.reload(); });
  let previous = performance.now(), lastSent = 0;
  function frame(now: number) {
    const dt = Math.min((now-previous)/1000,0.1); previous = now;
    if (playing) {
      yaw += (Number(keys.has('ArrowLeft'))-Number(keys.has('ArrowRight'))) * dt * 2;
      pitch = Math.max(-1.35,Math.min(1.35,pitch + (Number(keys.has('ArrowUp'))-Number(keys.has('ArrowDown'))) * dt * 1.6));
      if (now-lastSent >= 33) { input(); lastSent = now; }
    }
    render(state,id,yaw,pitch,dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

try {
  if (location.pathname.startsWith('/relay-room/')) {
    const { mountLobby } = await import('./lobby.ts');
    await mountLobby((auth,scope) => start(createScene(canvas),auth,scope));
  } else start(createScene(canvas));
}
catch (error) {
  status.textContent = '3D view unavailable';
  prompt.textContent = 'Enable WebGL 2 in a desktop browser and reload.';
  console.error(error);
}
