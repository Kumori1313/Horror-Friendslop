import './style.css';
import { canTake } from './room.ts';
import type { ClientMessage, ServerMessage, Snapshot } from './room.ts';
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

function start(render: ReturnType<typeof createScene>) {
  const socket = new WebSocket('ws://' + location.host + '/live');
  let id = 0, yaw = 0, pitch = -0.12, rtt = 0;
  let state: Snapshot | undefined;
  let playing = false;
  const keys = new Set<string>();
  function send(message: ClientMessage) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }
  function input() {
    send({ type: 'input', input: {
      forward: Number(keys.has('KeyW')) - Number(keys.has('KeyS')),
      right: Number(keys.has('KeyD')) - Number(keys.has('KeyA')), yaw, pitch,
    } });
  }
  function pause() {
    keys.clear(); playing = false; reticle.hidden = true; input();
  }
  function control() {
    if (!state || socket.readyState !== WebSocket.OPEN) return;
    brief.hidden = true; reticle.hidden = false; playing = true;
    // Arrow-key look remains available when pointer capture is unavailable.
    canvas.requestPointerLock?.()?.catch(() => {});
  }
  function diagnostics() {
    panel.hidden = !panel.hidden;
    debug.setAttribute('aria-expanded',String(!panel.hidden));
  }
  enter.onclick = control;
  canvas.onclick = () => { if (!playing || !document.pointerLockElement) control(); };
  debug.onclick = diagnostics;
  window.addEventListener('blur',pause);
  document.addEventListener('visibilitychange',() => { if (document.hidden) pause(); });
  document.addEventListener('pointerlockchange',() => { if (!document.pointerLockElement) pause(); });
  window.addEventListener('mousemove',e => {
    if (playing && document.pointerLockElement === canvas) {
      yaw -= e.movementX * 0.0022;
      pitch = Math.max(-1.35,Math.min(1.35,pitch-e.movementY*0.0022));
    }
  });
  window.addEventListener('keydown',e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyG' && !e.repeat) diagnostics();
    if (!playing || !state) return;
    if (e.code.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'KeyE') send({type:'action',action:state.lamp.owner === id ? 'drop' : 'take'});
    if (e.code === 'KeyF') send({type:'action',action:'toggle'});
    if (e.code === 'Escape') pause();
    input();
  });
  window.addEventListener('keyup',e => { keys.delete(e.code); if (playing) input(); });

  function updateHud(s: Snapshot) {
    const p = s.players.find(player => player.id === id);
    if (!p) return;
    status.textContent = 'Operator ' + id + '  ·  ' + s.players.length + '/2 online';
    const l = s.lamp;
    if (!brief.hidden) prompt.textContent = 'Open a second window for Operator 2';
    else if (!playing) prompt.textContent = 'Click the room to resume';
    else if (l.owner === id) prompt.textContent = 'E  Drop flashlight   ·   F  Switch ' + (l.on ? 'off' : 'on');
    else if (l.owner) prompt.textContent = 'Operator ' + l.owner + ' holds the flashlight';
    else prompt.textContent = canTake(p,l) ? 'E  Pick up flashlight' : 'Move closer to the flashlight';
    if (!panel.hidden) {
      const pos = (x: number,z: number) => x.toFixed(2) + ', ' + z.toFixed(2);
      stats.textContent = [
        'Round   ' + s.round, 'Update  ' + s.update, 'RTT     ' + rtt + ' ms',
        ...s.players.map(player => 'P' + player.id + '  x,z  ' + pos(player.x,player.z)),
        'Light   ' + (l.owner ? 'P' + l.owner : 'floor') + (l.on ? ' · on' : ' · off'),
        'Lamp x,z  ' + pos(l.x,l.z),
      ].join('\n');
    }
  }
  socket.onmessage = event => {
    const msg = JSON.parse(event.data) as ServerMessage;
    if (msg.type === 'joined') id = msg.id;
    if (msg.type === 'state') { state = msg.state; enter.disabled = false; updateHud(state); }
    if (msg.type === 'pong') rtt = Math.round(performance.now() - msg.time);
  };
  const ping = setInterval(() => send({type:'ping',time:performance.now()}),1000);
  socket.onclose = e => {
    clearInterval(ping); pause(); state = undefined; brief.hidden = false;
    if (document.pointerLockElement) document.exitPointerLock();
    status.textContent = e.reason || 'Room disconnected';
    prompt.textContent = 'Check the local server and retry.';
    enter.disabled = false; enter.textContent = 'Reconnect'; enter.onclick = () => location.reload();
  };
  window.addEventListener('pagehide',() => socket.close());
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

try { start(createScene(canvas)); }
catch (error) {
  status.textContent = '3D view unavailable';
  prompt.textContent = 'Enable WebGL 2 in a desktop browser and reload.';
  console.error(error);
}
