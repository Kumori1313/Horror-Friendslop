import { bindPreferences } from './preferences.ts';
import { assignment, collectable, finished, itemName, pack } from './mission.ts';
import { packSize } from './salvage.ts';
import { missionHud } from './mission-hud.ts';
import { mountDiagnostics } from './diagnostics.ts';
import './style.css';
import { generatorVersion, geometryFor, nearbyDoor, roomAt, roomLabel, solidsAt } from './layout.ts';
import type { Layout, Geometry } from './layout.ts';
import { canTake, walls } from './room.ts';
import { SoloSession } from './solo-session.ts';
import { CreatorSession, type Crew } from './creator-session.ts';
import { RoomConnection, type Events } from './connection.ts';
import type { Input, Ticket, Snapshot } from './room.ts';
import { bindDrag } from './touch.ts';
import { createScene } from './scene.ts';
import { Prediction } from './prediction.ts';

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
  // Clients without the simulation on hand predict their own operator.
  let prediction: Prediction | undefined;
  const frozen = (s: Snapshot) => !!s.mission && (finished(s.mission.stage) || s.mission.stage === 'settled' || s.mission.down.some(d => d.id === id));
  let layout: Layout | undefined, geometry: Geometry | undefined;
  const doorButton = element<HTMLButtonElement>('open-door');
  const { preferences, open: openSettings } = bindPreferences(pause);
  const hud = missionHud(preferences);
  const diagnostics = import.meta.env.DEV || import.meta.env.MODE === 'diagnostics'
    ? mountDiagnostics(sceneStarted,solo ? undefined : () => { if (state) network?.interrupt(2000); },render.stats)
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
  const collect = element<HTMLButtonElement>('collect');
  const dropItem = element<HTMLButtonElement>('drop-item');
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
  function collectItem() { if (playing && state?.mission) connection.action('collect'); }
  function dropSalvage() { if (playing && state?.mission) connection.action('drop-item'); }
  collect.onclick = collectItem;
  dropItem.onclick = dropSalvage;
  element('next').onclick = () => { if (state?.mission?.stage === 'settled') connection.action('next'); };
  toggle.onclick = switchLight;
  showControls();
  function controls(): Input {
    if (!playing) return {forward:0,right:0,yaw,pitch};
    return {
      forward: Math.max(-1,Math.min(1,Number(keys.has('KeyW')) - Number(keys.has('KeyS')) - stickY)),
      right: Math.max(-1,Math.min(1,Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + stickX)), yaw, pitch,
    };
  }
  function input() { connection.input(controls()); }
  function pause() {
    keys.clear(); playing = false; resetStick(); resetLook(); showControls(); reticle.hidden = true; input();
    if (solo && state && !finished(state.mission?.stage)) updateHud(state);
  }
  function control() {
    if (!state || finished(state.mission?.stage) || state.mission?.stage === 'settled') return;
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
    if (e.code === 'KeyC') collectItem();
    if (e.code === 'KeyX') dropSalvage();
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
    const solids = geometry ? solidsAt(geometry,p.feetY ?? 0,opened) : walls;
    const here = layout && geometry ? roomAt(layout,geometry,p) : undefined;
    const task = layout && assignment(layout,s,p,solids);
    operate.hidden = !task;
    if (task) operate.textContent = task.label;
    const mission = s.mission, exploring = mission?.stage === 'explore' && !down;
    const carried = layout && mission ? pack(layout,mission,id) : [];
    const item = layout && mission && exploring ? collectable(layout,mission,p,solids) : undefined;
    element('pack').hidden = !mission;
    element('pack').textContent = 'Pack '+carried.length+'/'+packSize+(carried.length ? ' · '+carried.map(i => itemName(i.kind)).join(', ') : '');
    if (layout && s.mission) {
      if (finished(s.mission.stage) || s.mission.stage === 'settled') {
        if (playing) pause();
        brief.hidden = true;
        if (document.pointerLockElement) document.exitPointerLock();
      }
      hud.update(layout,s,p,here?.id,!brief.hidden);
    }
    const reachable = canTake(p,l,solids);
    if (layout) element('sector').textContent = here ? roomLabel(here) : 'Corridor';
    if (touchMode) {
      collect.hidden = !item;
      if (item) collect.textContent = 'Collect '+itemName(item.kind);
      dropItem.hidden = !carried.length || !exploring;
      take.disabled = !!down || (!holding && !reachable);
      take.textContent = holding ? 'Drop' : 'Pick up';
      toggle.disabled = !!down || !holding;
      toggle.textContent = l.on ? 'Light off' : 'Light on';
    }
    if (!brief.hidden) prompt.textContent = solo ? '' : s.players.length === 2 ? 'Both seats occupied' : 'Waiting for a partner';
    else if (finished(s.mission?.stage)) prompt.textContent = 'Contract ended';
    else if (s.mission?.stage === 'settled') prompt.textContent = 'Expedition sold';
    else if (!playing) prompt.textContent = touchMode ? 'Tap the room to resume' : 'Click the room to resume';
    else if (task) prompt.textContent = touchMode ? task.label : 'Q  '+task.label;
    else if (down) prompt.textContent = 'Waiting for rescue';
    else if (door) prompt.textContent = touchMode ? 'Bulkhead within reach' : 'R  Open bulkhead';
    else if (item) prompt.textContent = touchMode ? itemName(item.kind)+' within reach' : 'C  Collect '+itemName(item.kind);
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
        element('sector').hidden = false;
        element('brief-type').textContent = plan.tour ? 'Stairwell playtest' : 'Salvage contract';
        // A new expedition puts everyone back at Intake, facing its bulkhead.
        if (prediction) prediction.self = undefined;
        yaw = 0; pitch = -0.12;
      }
      id = seat;
      if (!mode) sessionStorage.setItem(key,JSON.stringify(ticket));
    },
    snapshot(snapshot, first) {
      state = snapshot;
      const auth = snapshot.players.find(p => p.id === id);
      if (prediction && auth) {
        if (first || !prediction.self) prediction.reset(auth,performance.now());
        else prediction.correct(auth,performance.now(),frozen(snapshot),geometry);
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
  const connection = mode === 'solo' ? new SoloSession(events,new URLSearchParams(location.search).get('layout')==='stairwell')
    : crew ? new CreatorSession(crew,events) : new RoomConnection(url.href,saved,events,delay);
  const soloSession = connection instanceof SoloSession ? connection : undefined;
  const network = connection instanceof SoloSession ? undefined : connection;
  if (network && !crew?.host) prediction = new Prediction();
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
    if (prediction && state) prediction.step(now,dt,controls(),geometry,state.opened ?? [],frozen(state));
    render(prediction && state ? prediction.view(state,id,geometry) : state,id,yaw,pitch,dt,layout,preferences.reducedMotion);
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
