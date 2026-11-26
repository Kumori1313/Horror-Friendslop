import { forceMap, isMapKind } from './map-kinds.ts';
import { bindPreferences } from './preferences.ts';
import { assignment, finished, flatOn, gone, heldBy, itemName, nearestPickup, prices, swingTime, wallet, wareInfo } from './mission.ts';
import { spawnSalvage, type ItemKind } from './salvage.ts';
import { missionHud } from './mission-hud.ts';
import { mountDiagnostics } from './diagnostics.ts';
import './style.css';
import { generatorVersion, geometryFor, nearbyDoor, roomAt, roomLabel, solidsAt } from './layout.ts';
import type { Layout, Geometry } from './layout.ts';
import { batteryLife, chargeOf, hotbarSize, lampSlot, selected, slotsOf, walls, wares } from './room.ts';
import { SoloSession } from './solo-session.ts';
import { CreatorSession, type Crew } from './creator-session.ts';
import { RoomConnection, type Events } from './connection.ts';
import type { Action, Command, Input, Lamp, Player, Ticket, Snapshot } from './room.ts';
import { bindDrag } from './touch.ts';
import { createScene } from './scene.ts';
import { Prediction } from './prediction.ts';
import { doorReach, home, outdoors, placeNames, placeOf, type Place } from './places.ts';
import { passageFor } from './server/simulation.ts';

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
  const frozen = (s: Snapshot) => !!s.mission && (finished(s.mission.stage) || s.mission.stage === 'settled' || s.mission.down.some(d => d.id === id) || !!s.mission.dead?.includes(id) || !!heldBy(s.mission,id) || flatOn(s.mission,id));
  // A dead operator watches a partner still in the expedition.
  const watched = (s: Snapshot) => s.mission?.dead?.includes(id) ? s.players.find(p => p.id !== id && !gone(s.mission!,p.id)) : undefined;
  let layout: Layout | undefined, geometry: Geometry | undefined;
  // This operator's place, and the collision geometry for it. The facility's
  // is built only once someone is inside it.
  let place: Place = 'inside', lastTransit: number | undefined;
  const placeGeometry = (at: Place): Geometry | undefined => !layout ? undefined : at === 'home' ? home().geometry :
    at === 'outside' ? outdoors(layout.seed).geometry : geometryFor(layout);
  const openedHere = (s: Snapshot) => place === 'inside' ? s.opened ?? [] : [];
  const doorButton = element<HTMLButtonElement>('open-door');
  const { preferences, open: openSettings } = bindPreferences(pause);
  // Game Hub crews go by the names chosen in the lobby.
  const operator = (seat: number) => crew?.names[seat] ?? 'Operator '+seat;
  const hud = missionHud(preferences,operator);
  const testing = import.meta.env.DEV || import.meta.env.MODE === 'diagnostics';
  // Testing builds: let browser tests compare what is drawn with the state.
  if (testing) Object.assign(window,{relayDebug:{state:() => state,gnawersDrawn:render.gnawersDrawn,stalkersDrawn:render.stalkersDrawn}});
  const diagnostics = testing
    ? mountDiagnostics(sceneStarted,solo ? undefined : () => { if (state) network?.interrupt(2000); },render.stats,
      solo || crew?.host ? () => { const host = connection as {grant?: (amount: number) => void}; host.grant?.(200); } : undefined)
    : undefined;
  const operate = element<HTMLButtonElement>('operate');
  // Q at the home terminal opens the shop; everything else goes to the host.
  let shopping = false;
  operate.onclick = () => { if (!playing) return; if (shopping) openShop(); else connection.action('operate'); };
  const shop = element<HTMLDialogElement>('shop'), wareList = element('wares');
  const wareButtons = new Map(wares.map(ware => {
    const li = document.createElement('li'), button = document.createElement('button');
    button.type = 'button';
    button.onclick = () => { if (state) connection.action('buy',{buy:ware}); };
    li.append(Object.assign(document.createElement('strong'),{textContent:wareInfo[ware].name}),button,Object.assign(document.createElement('small'),{textContent:wareInfo[ware].about}));
    wareList.append(li);
    return [ware,button];
  }));
  function showShop(s: Snapshot) {
    const c = s.mission?.contract;
    if (!c) return;
    element('shop-funds').textContent = 'Wallet '+wallet(c)+'   ·   Quota '+c.credited+' of '+c.quota;
    for (const [ware,button] of wareButtons) {
      const unavailable = ware === 'lamp' && !s.lamp.lost;
      button.textContent = unavailable ? 'Not needed' : 'Buy · '+prices[ware];
      button.disabled = unavailable || wallet(c) < prices[ware] || s.mission?.stage !== 'home';
    }
  }
  function openShop() {
    if (!state || shop.open) return;
    pause();
    if (document.pointerLockElement) document.exitPointerLock();
    showShop(state);
    shop.showModal();
  }
  let playing = false;
  const keys = new Set<string>();
  let touchMode = matchMedia('(pointer: coarse)').matches;
  let stickX = 0, stickY = 0;
  const touchControls = element('touch-controls');
  const pad = element('move-pad');
  const thumb = element('thumb');
  const take = element<HTMLButtonElement>('take');
  const dropButton = element<HTMLButtonElement>('drop');
  const throwButton = element<HTMLButtonElement>('throw');
  const toggle = element<HTMLButtonElement>('toggle');
  const hotbar = element('hotbar');
  const charge = element('charge');
  // One button per slot, each with a preview of its item rendered once per kind.
  const slotButtons = Array.from({length:hotbarSize},(_,i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = '<img alt=""><span class="key">'+(i+1)+'</span><span class="battery" hidden><i></i></span>';
    b.onclick = () => select(i);
    hotbar.append(b);
    return b;
  });
  const slotName = document.createElement('span');
  slotName.className = 'name';
  function showControls() {
    touchControls.hidden = !playing || !touchMode;
    element('control-hint').textContent = touchMode ? 'Left pad to walk · Swipe the room to look · Jump button' : 'WASD to walk · Space to jump · Mouse or arrows to look'+(testing ? ' · Shift to sprint (testing)' : '');
    diagnostics?.setTouch(touchMode);
  }
  function look(dx: number, dy: number, sensitivity: number) {
    if (state && watched(state)) return;
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
  function act(action: Action, extra?: Command) { if (playing && state) connection.action(action,extra); }
  // F switches the flashlight, or loads a spare cell selected in the hotbar.
  const loading = (s: Snapshot) => {
    const p = s.players.find(q => q.id === id), item = p && selected({...p,hand:handOf(p)});
    return s.lamp.owner === id && !!item && kindOf(item) === 'cell';
  };
  function switchLight() { if (state?.lamp.owner === id) act(loading(state) ? 'load' : 'toggle'); }
  function openDoor() { if (geometry) act('open-door'); }
  doorButton.onclick = openDoor;
  take.onclick = () => act('take');
  dropButton.onclick = () => act('drop');
  element('next').onclick = () => { if (state?.mission?.stage === 'settled') connection.action('next'); };
  toggle.onclick = switchLight;
  // The selected slot shows at once; the host's copy catches up a round trip later.
  let hand: {slot: number; until: number} | undefined;
  const handOf = (p: Player) => hand && performance.now() < hand.until ? hand.slot : p.hand ?? 0;
  function withHand(s: Snapshot): Snapshot {
    const p = s.players.find(player => player.id === id);
    return p && handOf(p) !== (p.hand ?? 0) ? {...s,players:s.players.map(q => q === p ? {...p,hand:handOf(p)} : q)} : s;
  }
  function select(slot: number) {
    if (!playing || !state) return;
    slot = (slot+hotbarSize) % hotbarSize;
    hand = {slot,until:performance.now()+1500};
    act('select',{slot});
    updateHud(state);
  }
  // Hold to throw: the longer the hold, up to 0.9 s, the harder the throw.
  let charging: number | undefined, lastSwing = -Infinity;
  const power = () => charging === undefined ? 0 : Math.min(1,(performance.now()-charging)/900);
  function startThrow() {
    const p = state?.players.find(player => player.id === id);
    const item = p && selected({...p,hand:handOf(p)});
    // A stun baton swings at once instead of being thrown, but only once the
    // last swing has finished.
    if (playing && item && kindOf(item) === 'baton') {
      if (performance.now()-lastSwing < swingTime*1000) return;
      lastSwing = performance.now(); act('swing'); render.swing(); return;
    }
    if (!playing || !p || !geometry || !item || charging !== undefined) return;
    charging = performance.now();
    charge.hidden = false;
  }
  function endThrow(cancel = false) {
    if (charging === undefined) return;
    const strength = power();
    charging = undefined;
    charge.hidden = true;
    if (!cancel) act('throw',{aim:{yaw,pitch,power:strength}});
  }
  throwButton.addEventListener('pointerdown',e => { e.preventDefault(); startThrow(); });
  throwButton.addEventListener('pointerup',() => endThrow());
  throwButton.addEventListener('pointercancel',() => endThrow(true));
  window.addEventListener('mousedown',e => { if (e.button === 0 && playing && document.pointerLockElement === canvas) startThrow(); });
  window.addEventListener('mouseup',e => { if (e.button === 0) endThrow(); });
  let lastWheel = 0;
  window.addEventListener('wheel',e => {
    const p = state?.players.find(player => player.id === id);
    if (!playing || !p || !e.deltaY || performance.now()-lastWheel < 90) return;
    lastWheel = performance.now();
    select(handOf(p)+Math.sign(e.deltaY));
  },{passive:true});
  showControls();
  // A tap is held long enough for the host to see it (the guest sends its
  // controls at most every 100 ms); holding jumps again on each landing.
  let jumpUntil = 0, touchJump = false;
  function jump(down: boolean) {
    if (down) { jumpUntil = performance.now()+200; setTimeout(() => { if (playing) input(); },220); }
    input();
  }
  const jumpButton = element<HTMLButtonElement>('jump');
  jumpButton.addEventListener('pointerdown',e => { e.preventDefault(); touchJump = true; jump(true); });
  for (const end of ['pointerup','pointercancel','pointerleave'] as const) jumpButton.addEventListener(end,() => { if (touchJump) { touchJump = false; jump(false); } });
  function controls(): Input {
    if (!playing) return {forward:0,right:0,yaw,pitch};
    return {
      forward: Math.max(-1,Math.min(1,Number(keys.has('KeyW')) - Number(keys.has('KeyS')) - stickY)),
      right: Math.max(-1,Math.min(1,Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + stickX)), yaw, pitch,
      // Testing builds only: hold Shift to sprint.
      ...(testing && (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? {sprint:true} : {}),
      ...(keys.has('Space') || touchJump || performance.now() < jumpUntil ? {jump:true} : {}),
    };
  }
  function input() { connection.input(controls()); }
  function pause() {
    endThrow(true);
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
    // Browsers allow fullscreen only from a tap, so this is the moment: the
    // tap that enters or resumes play. Leaving it (the back gesture) just
    // waits for the next resume.
    else if (preferences.fullscreen && document.fullscreenEnabled && !document.fullscreenElement) {
      document.documentElement.requestFullscreen({navigationUI:'hide'}).catch(() => {});
    }
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
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'Space') jump(true);
    if (e.code === 'KeyQ') operate.click();
    if (e.code === 'KeyE') act('take');
    if (e.code === 'KeyR') openDoor();
    if (e.code === 'KeyF') switchLight();
    if (e.code === 'KeyX') act('drop');
    if (e.code === 'KeyT') startThrow();
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit && +digit[1] <= hotbarSize) select(+digit[1]-1);
    if (e.code === 'Escape') {
      pause();
      if (document.pointerLockElement) document.exitPointerLock();
    }
    input();
  });
  window.addEventListener('keyup',e => {
    keys.delete(e.code);
    if (e.code === 'KeyT') endThrow();
    if (playing) input();
  });

  // Each slot's item: the flashlight, salvage from this facility, or something bought.
  let kinds = new Map<string,ItemKind>(), kindsFor: Layout | undefined;
  function kindOf(item: string): ItemKind | 'lamp' | undefined {
    if (item === lampSlot) return 'lamp';
    if (layout && kindsFor !== layout) { kinds = new Map(spawnSalvage(layout).map(s => [s.id,s.kind])); kindsFor = layout; }
    return kinds.get(item) ?? state?.mission?.haul.find(h => h.id === item)?.kind;
  }
  const nameOf = (kind: ItemKind | 'lamp') => kind === 'lamp' ? 'Flashlight' : itemName(kind);
  let previews: Record<string,string> | undefined;
  // The flashlight's slot shows how much battery is left.
  function showHotbar(p: Player, lamp: Lamp) {
    previews ??= render.previews();
    const slots = slotsOf(p), current = handOf(p), left = chargeOf(lamp)/batteryLife;
    slots.forEach((item,i) => {
      const b = slotButtons[i], kind = item ? kindOf(item) : undefined, img = b.querySelector('img')!;
      const meter = b.querySelector<HTMLElement>('.battery')!, bar = meter.firstElementChild as HTMLElement;
      meter.hidden = kind !== 'lamp';
      if (kind === 'lamp') {
        const width = Math.round(left*100)+'%';
        if (bar.style.width !== width) bar.style.width = width;
        meter.classList.toggle('low',left < 0.2);
      }
      const src = kind ? previews![kind] : '';
      if (img.getAttribute('src') !== src) { if (src) img.src = src; else img.removeAttribute('src'); }
      img.hidden = !kind;
      b.setAttribute('aria-label','Slot '+(i+1)+': '+(kind ? nameOf(kind) : 'empty'));
      b.setAttribute('aria-pressed',String(i === current));
      if (i === current) {
        slotName.textContent = kind ? nameOf(kind) : '';
        if (slotName.parentElement !== b) b.append(slotName);
      }
    });
  }

  function updateHud(s: Snapshot) {
    const p = s.players.find(player => player.id === id);
    if (!p) return;
    status.textContent = solo ? 'Solo operator' : operator(id) + '  ·  ' + s.players.filter(player => player.connected).length + '/2 online';
    const l = s.lamp;
    const holding = l.owner === id;
    const opened = openedHere(s);
    const door = place === 'inside' && geometry ? nearbyDoor(p,geometry,opened) : undefined;
    const down = s.mission?.down.some(d => d.id === id) || !!s.mission?.dead?.includes(id);
    // A door of the building, from outside or within: the main door or a fire exit.
    const passage = layout && s.mission?.stage === 'explore' && !down ? passageFor(p,layout,s.mission.arrival === 'closed') : undefined;
    const way = passage?.way, by = passage?.id === 'main' ? '' : ' by the fire exit';
    // At a door or the bell before everyone is through the rift.
    const map = layout && s.mission?.arrival === 'open' && place === 'outside' ? outdoors(layout.seed) : undefined;
    const waiting = !!map && (map.doors.some(d => Math.hypot(p.x-d.door.x,p.z-d.door.z) <= doorReach) || Math.hypot(p.x-map.bell.x,p.z-map.bell.z) <= doorReach+0.4);
    doorButton.hidden = (!door && !way) || !!down;
    doorButton.textContent = way === 'enter' ? 'Enter facility' : way === 'leave' ? 'Leave facility' : 'Open bulkhead';
    const solids = geometry ? solidsAt(geometry,p.feetY ?? 0,opened) : walls;
    const here = layout && geometry && place === 'inside' ? roomAt(layout,geometry,p) : undefined;
    const riftOpen = place === 'home' && (s.mission?.stage === 'home' || s.mission?.arrival === 'open');
    const task = layout && assignment(layout,s,p,solids);
    operate.hidden = !task;
    if (task) operate.textContent = task.label;
    shopping = task?.kind === 'shop';
    if (shop.open) showShop(s);
    const mission = s.mission, active = !down && !finished(mission?.stage) && mission?.stage !== 'settled';
    if (hand && (p.hand ?? 0) === hand.slot) hand = undefined;
    const me = {...p,hand:handOf(p)};
    const inHand = selected(me), heldKind = inHand ? kindOf(inHand) : undefined;
    const pick = active ? nearestPickup(layout,s,p,solids) : undefined;
    const pickName = pick ? ('lamp' in pick ? 'flashlight' : itemName(pick.item.kind)) : '';
    hotbar.hidden = !brief.hidden;
    if (brief.hidden) showHotbar(me,s.lamp);
    if (layout && s.mission) {
      if (finished(s.mission.stage) || s.mission.stage === 'settled') {
        if (playing) pause();
        brief.hidden = true;
        if (document.pointerLockElement) document.exitPointerLock();
      }
      hud.update(layout,s,p,here?.id,!brief.hidden);
    }
    const funds = place === 'home' && s.mission ? '  ·  Wallet '+wallet(s.mission.contract) : '';
    if (layout) element('sector').textContent = (place !== 'inside' ? placeNames[place] : here ? roomLabel(here) : 'Corridor')+funds;
    if (touchMode) {
      take.hidden = !pick;
      take.textContent = 'Pick up '+pickName;
      dropButton.hidden = throwButton.hidden = !heldKind || !active;
      if (!geometry) throwButton.hidden = true;
      throwButton.textContent = heldKind === 'baton' ? 'Swing' : 'Hold to throw';
      toggle.disabled = !!down || !holding || (!l.on && !chargeOf(l) && !loading(s));
      toggle.textContent = loading(s) ? 'Load cell' : l.on ? 'Light off' : 'Light on';
    }
    const held = heldKind ? (heldKind === 'lamp' ? 'flashlight' : itemName(heldKind)) : '';
    if (!brief.hidden) prompt.textContent = solo ? '' : s.players.length === 2 ? 'Both seats occupied' : 'Waiting for a partner';
    else if (finished(s.mission?.stage)) prompt.textContent = 'Contract ended';
    else if (s.mission?.stage === 'settled') prompt.textContent = 'Expedition sold';
    else if (!playing) prompt.textContent = touchMode ? 'Tap the room to resume' : 'Click the room to resume';
    else if (task) prompt.textContent = touchMode ? task.label : 'Q  '+task.label;
    else if (down) {
      const partner = watched(s);
      prompt.textContent = !s.mission?.dead?.includes(id) ? 'Waiting for rescue' : partner ? 'You died · Watching '+operator(partner.id) : 'You died';
    }
    else if (waiting) prompt.textContent = 'Waiting for the whole crew to come through the rift';
    else if (way) prompt.textContent = (touchMode ? '' : 'R  ')+(way === 'enter' ? 'Enter the facility' : 'Leave the facility')+by;
    else if (door) prompt.textContent = touchMode ? 'Bulkhead within reach' : 'R  Open bulkhead';
    else if (pick) prompt.textContent = touchMode ? pickName[0].toUpperCase()+pickName.slice(1)+' within reach' : 'E  Pick up '+pickName;
    else if (heldKind === 'baton') prompt.textContent = touchMode ? 'Tap Swing to stun the Bell Diver within reach' : 'Click or T  Swing the baton   ·   X  Drop it';
    else if (heldKind === 'flare') prompt.textContent = touchMode ? 'Throw or drop the flare to light it' : 'X  Drop to light   ·   Hold T or click  Throw to light';
    else if (heldKind === 'cell') prompt.textContent = holding ? (touchMode ? 'Tap Load cell to recharge the flashlight' : 'F  Load the spare cell into the flashlight   ·   X  Drop it') : 'Carry the flashlight to load this spare cell';
    else if (holding && !chargeOf(l)) prompt.textContent = 'The flashlight is flat. Find a spare cell';
    else if (held) prompt.textContent = touchMode ? 'Holding the '+held : 'X  Drop '+held+'   ·   Hold T or click  Throw'+(holding ? '   ·   F  Switch '+(l.on ? 'off' : 'on') : '');
    else if (holding) prompt.textContent = touchMode ? 'The flashlight is clipped on' : 'F  Switch the clipped flashlight '+(l.on ? 'off' : 'on');
    else if (place === 'outside' && s.mission?.rift && Math.hypot(p.x-s.mission.rift.x,p.z-s.mission.rift.z) < 6) prompt.textContent = 'Walk into the rift to leave, or throw salvage in';
    else if (riftOpen) prompt.textContent = s.mission?.stage === 'home' ? 'Walk into the rift to start the expedition' : 'Walk into the rift to follow your crew';
    else if (l.owner) prompt.textContent = operator(l.owner) + ' carries the flashlight';
    else if (l.lost && place === 'home') prompt.textContent = 'The flashlight was left behind. Buy another at the supply terminal';
    else prompt.textContent = '';
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
        geometry = undefined;
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
      place = auth && snapshot.mission ? placeOf(auth) : 'inside';
      geometry = placeGeometry(place);
      // Moving between places turns the view to face the way in.
      const moves = auth?.transit?.n ?? 0;
      if (auth && moves !== lastTransit) {
        if (lastTransit !== undefined && !first && auth.transit) {
          yaw = auth.transit.yaw; pitch = -0.12;
          prediction?.reset(auth,performance.now());
        }
        lastTransit = moves;
      }
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
    if (prediction && state) prediction.step(now,dt,controls(),geometry,openedHere(state),frozen(state));
    if (charging !== undefined) (charge.firstElementChild as HTMLElement).style.width = power()*100+'%';
    const shown = state && withHand(state);
    const partner = state && watched(state);
    if (partner) {
      // Turn smoothly with the partner, whose view arrives once per snapshot.
      const blend = 1-Math.exp(-10*dt);
      yaw += Math.atan2(Math.sin(partner.yaw-yaw),Math.cos(partner.yaw-yaw))*blend;
      pitch += (partner.pitch-pitch)*blend;
    }
    render(prediction && shown ? prediction.view(shown,id,geometry) : shown,partner?.id ?? id,yaw,pitch,dt,layout,preferences.reducedMotion,!!partner,preferences.creatureModels);
    diagnostics?.frame(now,elapsed,!!state);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return (reason: string) => { connection.stop(); events.offline(reason,true); };
}

try {
  const query = new URLSearchParams(location.search);
  // Testing: one outdoor map kind everywhere, from a test build
  // (`VITE_RELAY_TEST_MAP`, for both seats alike) or, solo in a testing
  // build, `?map=`. Never in a release build.
  const testMap = import.meta.env.MODE !== 'pages' ? (import.meta.env.VITE_RELAY_TEST_MAP as string | undefined) : undefined;
  const soloMap = query.get('solo') === '1' && (import.meta.env.DEV || import.meta.env.MODE === 'diagnostics') ? query.get('map') : null;
  for (const kind of [testMap,soloMap]) if (isMapKind(kind)) forceMap(kind);
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
