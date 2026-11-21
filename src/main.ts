import { bindPreferences } from './preferences.ts';
import { assignment, finished } from './mission.ts';
import { missionHud } from './mission-hud.ts';
import { mountDiagnostics } from './diagnostics.ts';
import './style.css';
import { blockers, footprint, generatorVersion, geometryFor, nearbyDoor, roomLabel } from './layout.ts';
import type { Layout, Geometry, Rect } from './layout.ts';
import { canTake } from './room.ts';
import { SoloSession } from './solo-session.ts';
import { CreatorSession, type Crew } from './creator-session.ts';
import { RoomConnection, type Events } from './connection.ts';
import type { Ticket, Snapshot } from './room.ts';
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
const reticle = element('reticle');

function start(render: ReturnType<typeof createScene>, mode?: Crew | 'solo', sceneStarted = performance.now()) {
  const solo = mode === 'solo';
  const crew = solo ? undefined : mode;
  element('local-solo').hidden = !!mode;
  const key = 'relay-room-seat-v2';
  let saved: Ticket | null = null;
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (!mode && nav?.type !== 'navigate') {
    try { saved = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { /* Fresh session */ }
  }
  const url = new URL('/live',location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const delay = Math.max(0,Math.min(500,Number(new URLSearchParams(location.search).get('delay')) || 0));
  let id = 0, yaw = 0, pitch = -0.12;
  let state: Snapshot | undefined;
  let layout: Layout | undefined, geometry: Geometry | undefined;
  let obstacles: Rect[] | undefined;
  let doorState = '';
  const doorButton = element<HTMLButtonElement>('open-door');
  const { preferences, open: openSettings } = bindPreferences(pause);
  const hud = missionHud(preferences);
  const diagnostics = import.meta.env.DEV || import.meta.env.MODE === 'diagnostics'
    ? mountDiagnostics(sceneStarted,solo ? undefined : () => { if (state) network?.interrupt(2000); })
    : undefined;
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
    diagnostics?.setTouch(touchMode);
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
    if (solo && state && !finished(state.mission?.stage)) updateHud(state);
  }
  function control() {
    if (!state || finished(state.mission?.stage)) return;
    if (state.mission) hud.enableSound();
    brief.hidden = true; reticle.hidden = false; playing = true;
    // Arrow-key look remains available when pointer capture is unavailable.
    showControls();
    if (!touchMode) canvas.requestPointerLock?.()?.catch(() => {});
  }
  enter.onclick = control;
  canvas.onclick = () => { if (!playing || (!touchMode && !document.pointerLockElement)) control(); };
  window.addEventListener('blur',pause);
  document.addEventListener('visibilitychange',() => {
    if (document.hidden) pause();
    else if (state) network?.interrupt(0);
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
    if (!playing || !state) return;
    if (e.code.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'KeyQ') operate.click();
    if (e.code === 'KeyE') useFlashlight();
    if (e.code === 'KeyR') openDoor();
    if (e.code === 'KeyF') switchLight();
    if (e.code === 'Escape') {
      pause();
      if (document.pointerLockElement) document.exitPointerLock();
    }
    input();
  });
  window.addEventListener('keyup',e => { keys.delete(e.code); if (playing) input(); });

  function updateHud(s: Snapshot) {
    const p = s.players.find(player => player.id === id);
    if (!p) return;
    status.textContent = solo ? 'Solo operator' : 'Operator ' + id + '  ·  ' + s.players.filter(player => player.connected).length + '/2 online';
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
      element('sector').textContent = current ? roomLabel(current) : 'Connecting corridor';
    }
    if (touchMode) {
      take.disabled = !!down || (!holding && !reachable);
      take.textContent = holding ? 'Drop' : 'Pick up';
      toggle.disabled = !!down || !holding;
      toggle.textContent = l.on ? 'Light off' : 'Light on';
    }
    if (!brief.hidden) prompt.textContent = solo ? '' : s.players.length === 2 ? 'Both seats occupied' : 'Waiting for a partner';
    else if (finished(s.mission?.stage)) prompt.textContent = 'Shift ended';
    else if (!playing) prompt.textContent = touchMode ? 'Tap the room to resume' : 'Click the room to resume';
    else if (task) prompt.textContent = touchMode ? task : 'Q  '+task;
    else if (down) prompt.textContent = 'Waiting for rescue';
    else if (door) prompt.textContent = touchMode ? 'Bulkhead within reach' : 'R  Open bulkhead';
    else if (holding) prompt.textContent = touchMode ? 'You hold the flashlight' : 'E  Drop flashlight   ·   F  Switch ' + (l.on ? 'off' : 'on');
    else if (l.owner) prompt.textContent = 'Operator ' + l.owner + ' holds the flashlight';
    else prompt.textContent = reachable ? (touchMode ? 'Flashlight within reach' : 'E  Pick up flashlight') : '';
    diagnostics?.update(s,layout,network?.metrics,crew,delay);
  }
  const events: Events = {
    joined(seat,ticket,plan) {
      if (crew && plan?.version !== generatorVersion) {
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
        const backup = plan.callout === 'black-start';
        element('brief-type').textContent = backup ? 'Black start' : 'Line test';
      }
      id = seat;
      if (!mode) sessionStorage.setItem(key,JSON.stringify(ticket));
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
        if (!mode) sessionStorage.removeItem(key);
        brief.hidden = false;
        enter.disabled = false;
        enter.textContent = crew ? 'Return to Game Hub' : 'Join again';
        if (reason === 'Already playing in another tab') {
          element('live-leave').hidden = true;
          enter.onclick = () => location.assign('/game-hub/');
        } else enter.onclick = crew ? () => element('live-leave').click() : () => location.reload();
      }
    },
  };
  const connection = mode === 'solo' ? new SoloSession(events)
    : crew ? new CreatorSession(crew,events) : new RoomConnection(url.href,saved,events,delay);
  const soloSession = connection instanceof SoloSession ? connection : undefined;
  const network = connection instanceof SoloSession ? undefined : connection;
  if (soloSession) {
    const leave = element<HTMLButtonElement>('live-leave');
    leave.hidden = false;
    leave.textContent = 'Leave solo';
    leave.onclick = () => { soloSession.discard(); location.assign(location.pathname); };
    const replay = element<HTMLButtonElement>('replay');
    replay.textContent = 'New solo shift';
    replay.onclick = () => { soloSession.discard(); location.reload(); };
  }
  connection.connect();
  window.addEventListener('pagehide',() => connection.stop());
  window.addEventListener('pageshow',e => { if (e.persisted) location.reload(); });
  let previous = performance.now(), lastSent = 0;
  function frame(now: number) {
    const elapsed = now-previous;
    previous = now;
    const dt = Math.min(elapsed/1000,0.1);
    if (playing) {
      yaw += (Number(keys.has('ArrowLeft'))-Number(keys.has('ArrowRight'))) * dt * 2 * preferences.sensitivity;
      pitch = Math.max(-1.35,Math.min(1.35,pitch + (Number(keys.has('ArrowUp'))-Number(keys.has('ArrowDown'))) * dt * 1.6 * preferences.sensitivity));
      if (now-lastSent >= 33) { input(); lastSent = now; }
    }
    if (playing && !document.hidden) soloSession?.tick(dt);
    render(state,id,yaw,pitch,dt,layout,preferences.reducedMotion);
    diagnostics?.frame(now,elapsed,!!state);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return (reason: string) => { connection.stop(); events.offline(reason,true); };
}

try {
  const query = new URLSearchParams(location.search);
  if (query.get('solo') === '1' && !query.has('room') && !query.has('lobby')) {
    start(createScene(canvas,true),'solo');
  } else if (location.pathname.startsWith('/relay-room/')) {
    const { mountLobby } = await import('./lobby.ts');
    await mountLobby(crew => {
      const started = performance.now();
      return start(createScene(canvas,true),crew,started);
    });
  } else start(createScene(canvas));
}
catch (error) {
  status.textContent = '3D view unavailable';
  prompt.textContent = 'Enable WebGL 2 in a desktop browser and reload.';
  console.error(error);
}
