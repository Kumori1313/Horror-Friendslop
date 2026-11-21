import { bindPreferences } from './preferences.ts';
import { answerStation, assignment, finished } from './mission.ts';
import { missionHud } from './mission-hud.ts';
import { drawMap } from './layout-map.ts';
import './style.css';
import { blockers, footprint, generatorVersion, geometryFor, nearbyDoor, roomNames } from './layout.ts';
import type { Layout, Geometry, Rect } from './layout.ts';
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

function start(render: ReturnType<typeof createScene>, admission?: () => Promise<Admission>, scope = 'local', sceneStarted = performance.now()) {
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
  let layout: Layout | undefined, geometry: Geometry | undefined;
  let obstacles: Rect[] | undefined;
  const map = element<HTMLCanvasElement>('layout-map');
  let doorState = '';
  const doorButton = element<HTMLButtonElement>('open-door');
  const { preferences, open: openSettings } = bindPreferences(pause);
  const hud = missionHud(preferences);
  let readyMs = 0, frameP95 = 0;
  let sampleStart = performance.now();
  const frameTimes: number[] = [];
  const operate = element<HTMLButtonElement>('operate');
  operate.onclick = () => { if (playing) connection.action('operate'); };
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
    sensitivity *= preferences.sensitivity;
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
  function openDoor() { if (playing && state && geometry) connection.action('open-door'); }
  doorButton.onclick = openDoor;
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
    if (!state || finished(state.mission?.stage)) return;
    if (state.mission) hud.enableSound();
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
    if (element<HTMLDialogElement>('preferences').open) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyO' && !e.repeat) { e.preventDefault(); openSettings(); return; }
    if (e.code === 'KeyG' && !e.repeat) diagnostics();
    if (!playing || !state) return;
    if (e.code.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'KeyQ') operate.click();
    if (e.code === 'KeyE') useFlashlight();
    if (e.code === 'KeyR') openDoor();
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
    const opened = s.opened ?? [];
    const door = geometry && nearbyDoor(p,geometry,opened);
    const down = s.mission?.down.some(d => d.id === id);
    doorButton.hidden = !door || !!down;
    const task = layout && obstacles && assignment(layout,s,p,obstacles);
    operate.hidden = !task;
    if (task) operate.textContent = task;
    if (layout && s.mission) {
      if (finished(s.mission.stage)) {
        if (playing) pause();
        brief.hidden = true;
        if (document.pointerLockElement) document.exitPointerLock();
      }
      hud.update(layout,s,p,!brief.hidden);
    }
    const reachable = canTake(p,l,obstacles);
    if (layout) {
      const current = layout.rooms.find(room => {
        const f = footprint(room);
        return Math.abs(f.x-p.x)<=f.w/2 && Math.abs(f.z-p.z)<=f.d/2;
      });
      element('sector').textContent = current ? roomNames[current.kind]+' · '+current.id : 'Connecting corridor';
    }
    if (touchMode) {
      take.disabled = !!down || (!holding && !reachable);
      take.textContent = holding ? 'Drop' : 'Pick up';
      toggle.disabled = !!down || !holding;
      toggle.textContent = l.on ? 'Light off' : 'Light on';
    }
    if (!brief.hidden) prompt.textContent = s.players.length === 2 ? 'Both seats occupied' : 'Waiting for a partner';
    else if (finished(s.mission?.stage)) prompt.textContent = 'Shift ended';
    else if (!playing) prompt.textContent = touchMode ? 'Tap the room to resume' : 'Click the room to resume';
    else if (task) prompt.textContent = touchMode ? task : 'Q  '+task;
    else if (down) prompt.textContent = 'Waiting for rescue';
    else if (door) prompt.textContent = touchMode ? 'Bulkhead within reach' : 'R  Open bulkhead';
    else if (holding) prompt.textContent = touchMode ? 'You hold the flashlight' : 'E  Drop flashlight   ·   F  Switch ' + (l.on ? 'off' : 'on');
    else if (l.owner) prompt.textContent = 'Operator ' + l.owner + ' holds the flashlight';
    else prompt.textContent = reachable ? (touchMode ? 'Flashlight within reach' : 'E  Pick up flashlight') : 'Move closer to the flashlight';
    if (!panel.hidden) {
      if (layout) drawMap(map,layout,s);
      const pos = (x: number,z: number) => x.toFixed(2) + ', ' + z.toFixed(2);
      stats.textContent = [
        'Build   ' + import.meta.env.VITE_RELAY_BUILD, 'Round   ' + s.round, 'Update  ' + s.update, 'RTT     ' + Math.round(connection.metrics.rtt) + ' ms',
        'Frame p95  '+(frameP95 ? frameP95.toFixed(1)+' ms' : 'sampling'),
        'Scene ready  '+Math.round(readyMs)+' ms',
        'Delay   ' + delay + ' ms each way',
        'RX/TX   ' + Math.round(connection.metrics.downRate) + ' / ' + Math.round(connection.metrics.upRate) + ' B/s',
        'Recovery  ' + Math.round(connection.metrics.recovery) + ' ms',
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
  }
  const connection = new RoomConnection(url.href,saved,{
    joined(seat,ticket,plan) {
      if (admission && plan?.version !== generatorVersion) {
        connection.stop();
        status.textContent = 'Incompatible layout version';
        prompt.textContent = 'Update the game and runtime, then refresh.';
        return;
      }
      if (plan && (!layout || plan.seed !== layout.seed || plan.version !== layout.version)) {
        layout = plan;
        geometry = geometryFor(plan);
        obstacles = blockers(geometry,[]);
        doorState = '';
        element('sector').hidden = false;
        element('floor-plan').hidden = false;
        const backup = plan.callout === 'black-start';
        element('brief-type').textContent = backup ? 'Black start' : 'Line test';
        element('brief-instructions').textContent = (backup ? 'Charge the Switchboard pad first. ' : '')+'One operator answers from '+roomNames[answerStation(plan).kind]+'. Another takes the lit flashlight to Relay. When the ceiling knocks, clear the circle. Diagnostics shows the floor plan.';
      }
      id = seat;
      sessionStorage.setItem(key,JSON.stringify(ticket));
    },
    snapshot(snapshot, first) {
      state = snapshot;
      const opened = snapshot.opened ?? [];
      if (geometry && doorState !== opened.join(',')) {
        doorState = opened.join(',');
        obstacles = blockers(geometry,opened);
      }
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
      element('mission').hidden = true;
      element('result').hidden = true;
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
    const elapsed = now-previous;
    previous = now;
    const dt = Math.min(elapsed/1000,0.1);
    if (state && !document.hidden) {
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
    if (playing) {
      yaw += (Number(keys.has('ArrowLeft'))-Number(keys.has('ArrowRight'))) * dt * 2 * preferences.sensitivity;
      pitch = Math.max(-1.35,Math.min(1.35,pitch + (Number(keys.has('ArrowUp'))-Number(keys.has('ArrowDown'))) * dt * 1.6 * preferences.sensitivity));
      if (now-lastSent >= 33) { input(); lastSent = now; }
    }
    render(state,id,yaw,pitch,dt,layout,preferences.reducedMotion);
    if (state && !readyMs) readyMs = performance.now()-sceneStarted;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

try {
  if (location.pathname.startsWith('/relay-room/')) {
    const { mountLobby } = await import('./lobby.ts');
    await mountLobby((auth,scope) => {
      const started = performance.now();
      start(createScene(canvas,true),auth,scope,started);
    });
  } else start(createScene(canvas));
}
catch (error) {
  status.textContent = '3D view unavailable';
  prompt.textContent = 'Enable WebGL 2 in a desktop browser and reload.';
  console.error(error);
}
