import chainOne from './audio/chain-1.wav?url';
import chainTwo from './audio/chain-2.wav?url';
import type { Layout } from './layout.ts';
import type { Player, Snapshot } from './room.ts';
import type { Preferences } from './preferences.ts';
import { finished, healthOf, heldBy, hears, itemName, listen, lossPercent, maxHealth } from './mission.ts';
import { placeOf } from './places.ts';

const el = (id: string) => document.getElementById(id)!;

// Build the audio context on the Enter gesture so mobile browsers can play sound.
export function missionHud(preferences: Preferences, operator = (id: number) => 'Operator '+id) {
  let audio: AudioContext | undefined;
  const reference = document.querySelector<HTMLInputElement>('#report-reference')!;
  const copy = document.querySelector<HTMLButtonElement>('#copy-reference')!;
  reference.onclick = () => reference.select();
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(reference.value);
      copy.textContent = 'Copied';
    } catch {
      reference.focus();
      reference.select();
      copy.textContent = 'Select and copy';
    }
  };
  let caption = '', captionUntil = 0;
  function subtitle(label: string) {
    caption = label;
    captionUntil = performance.now()+2500;
  }
  // The Bell Diver's chains, fetched and decoded once, reused for every move.
  // Kept subtle, and balanced by ear in playtests: the short pickup clip
  // sounds quieter than the long pull, so it plays about 4 dB louder.
  const chains: (AudioBuffer | undefined)[] = [];
  const chainLevel = [0.32,0.28];
  function enableSound() {
    if (!window.AudioContext) return;
    const first = !audio;
    audio ??= new AudioContext();
    void audio.resume().catch(() => {});
    if (first) [chainOne,chainTwo].forEach((url,i) => {
      void fetch(url).then(r => r.arrayBuffer()).then(data => audio!.decodeAudioData(data)).then(b => { chains[i] = b; }).catch(() => {});
    });
  }
  function chain(clip: number) {
    const buffer = chains[clip];
    if (!audio || !buffer || audio.state !== 'running' || preferences.volume === 0 || document.hidden) return;
    const source = audio.createBufferSource(), gain = audio.createGain();
    source.buffer = buffer;
    gain.gain.value = chainLevel[clip]*preferences.volume;
    source.connect(gain).connect(audio.destination);
    source.start();
  }
  function tone(hz: number, endHz: number, duration: number, level: number) {
    if (audio?.state !== 'running' || preferences.volume === 0 || document.hidden) return;
    const source = audio.createOscillator(), gain = audio.createGain();
    const now = audio.currentTime;
    source.type = 'triangle';
    source.frequency.setValueAtTime(hz,now);
    source.frequency.exponentialRampToValueAtTime(endHz,now+duration);
    gain.gain.setValueAtTime(level*preferences.volume,now);
    gain.gain.exponentialRampToValueAtTime(0.0001,now+duration);
    source.connect(gain).connect(audio.destination);
    source.start(now); source.stop(now+duration+0.01);
  }
  const outcomes = {quota:'Quota met',deadline:'Quota missed',wipe:'Crew lost',left:'Contract abandoned'};
  const clock = (seconds: number) => Math.floor(seconds/60)+':'+String(Math.floor(seconds%60)).padStart(2,'0');
  function line(label: string, value: string, kind = '') {
    const li = document.createElement('li');
    if (kind) li.className = kind;
    li.append(Object.assign(document.createElement('span'),{textContent:label}),Object.assign(document.createElement('span'),{textContent:value}));
    return li;
  }
  let lastBanked = 0, wasRung = false, shownReport = '';
  // The Diver's moves already heard, so each rattles once; undefined until
  // the first snapshot, so joining or refreshing replays nothing.
  let heardMoves: number | undefined;
  let wasStunned = false;
  // Hits taken and Gnawer bites already shown; undefined until the first
  // snapshot, so joining or refreshing replays nothing.
  let seenHits: number | undefined;
  const seenBites = new Map<number,number>(), lastSeen = new Map<number,{x: number; z: number}>();
  let nextSkitter = 0, skitterHeard = 0;
  function noise(level: number, duration: number, hz: number) {
    if (audio?.state !== 'running' || preferences.volume === 0 || document.hidden) return;
    const now = audio.currentTime, length = Math.ceil(audio.sampleRate*duration), buffer = audio.createBuffer(1,length,audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i=0;i<length;i++) data[i] = (Math.random()*2-1)*(1-i/length)**3;
    const source = audio.createBufferSource(), filter = audio.createBiquadFilter(), gain = audio.createGain();
    source.buffer = buffer; filter.type = 'bandpass'; filter.frequency.value = hz; filter.Q.value = 3;
    gain.gain.value = level*preferences.volume;
    source.connect(filter).connect(gain).connect(audio.destination);
    source.start(now);
  }
  // Each operator's health, bottom left.
  function vitals(state: Snapshot, show: boolean) {
    const box = el('vitals'), m = state.mission!;
    box.hidden = !show;
    if (!show) return;
    const rows = state.players.filter(p => p.connected || m.down.some(d => d.id === p.id)).map(p => {
      const hp = healthOf(p), down = m.down.some(d => d.id === p.id), dead = m.dead?.includes(p.id);
      const kind = dead || down ? 'down' : hp <= 25 ? 'critical' : hp <= 50 ? 'low' : '';
      return {key:p.id+'/'+Math.round(hp)+'/'+kind,name:operator(p.id),hp:dead ? 0 : hp,kind,label:dead ? 'dead' : down ? 'down' : String(Math.round(hp))};
    });
    const key = rows.map(r => r.key+r.name).join('|');
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.replaceChildren(...rows.map(r => {
      const row = Object.assign(document.createElement('div'),{className:'vital '+r.kind});
      const fill = Object.assign(document.createElement('span'),{className:'fill'});
      fill.style.width = (100*r.hp/maxHealth)+'%';
      const bar = Object.assign(document.createElement('span'),{className:'bar'});
      bar.append(fill);
      row.append(Object.assign(document.createElement('span'),{className:'name',textContent:r.name}),bar,Object.assign(document.createElement('span'),{textContent:r.label}));
      return row;
    }));
  }
  // A hit: a red flash at the edges and a dull thud.
  function hurtCue(self: Player) {
    const hits = self.hits ?? 0;
    if (seenHits !== undefined && hits > seenHits) {
      const flash = el('hurt');
      flash.classList.remove('hit'); void flash.offsetWidth; flash.classList.add('hit');
      tone(120,55,0.35,0.35);
    }
    seenHits = hits;
  }
  // Gnawers: a skitter of claws while one moves nearby, a snap of teeth at a bite.
  function gnawerCues(state: Snapshot, self: Player) {
    const m = state.mission!, now = performance.now();
    for (const g of m.gnawers ?? []) {
      const d = Math.hypot(g.x-self.x,g.z-self.z), heard = placeOf(self) === 'inside' && d < 12 && Math.abs(g.y-(self.feetY ?? 0)) < 3;
      const last = lastSeen.get(g.id), moving = !!last && Math.hypot(last.x-g.x,last.z-g.z) > 0.01;
      lastSeen.set(g.id,{x:g.x,z:g.z});
      const bites = g.bites ?? 0, seen = seenBites.get(g.id);
      if (seen !== undefined && bites > seen && heard) { noise(0.5*(1-d/12),0.07,2600); noise(0.4*(1-d/12),0.05,1800); subtitle('Teeth snap shut'); }
      seenBites.set(g.id,bites);
      if (heard && moving && now >= nextSkitter) {
        nextSkitter = now+70+Math.random()*90;
        noise(0.12*(1-d/12),0.025,3200+Math.random()*1500);
        if (now-skitterHeard > 8000) subtitle('Something skitters nearby');
        skitterHeard = now;
      }
    }
  }
  // The Lurker: a heavy splash at a grab, a slow slosh while it moves near.
  const seenGrabs = new Map<number,number>(), lurkerSeen = new Map<number,{x: number; z: number}>();
  let nextSlosh = 0, sloshHeard = 0;
  function lurkerCues(state: Snapshot, self: Player) {
    const m = state.mission!, now = performance.now();
    for (const l of m.lurkers ?? []) {
      const d = Math.hypot(l.x-self.x,l.z-self.z), heard = placeOf(self) === 'outside' && d < 18;
      const last = lurkerSeen.get(l.id), moving = !!last && Math.hypot(last.x-l.x,last.z-l.z) > 0.01;
      lurkerSeen.set(l.id,{x:l.x,z:l.z});
      const grabs = l.grabs ?? 0, seen = seenGrabs.get(l.id);
      if (seen !== undefined && grabs > seen && heard) { noise(0.7*(1-d/18),0.5,500); noise(0.5*(1-d/18),0.35,260); subtitle('A heavy splash'); }
      seenGrabs.set(l.id,grabs);
      if (heard && moving && l.mode !== 'sunk' && now >= nextSlosh) {
        nextSlosh = now+400+Math.random()*500;
        noise(0.16*(1-d/18),0.4,300+Math.random()*200);
        if (now-sloshHeard > 10000) subtitle('Something moves in the water');
        sloshHeard = now;
      }
    }
  }
  function update(layout: Layout, state: Snapshot, self: Player, room: string | undefined, briefing: boolean) {
    const m = state.mission!;
    vitals(state,!briefing && m.stage === 'explore' && placeOf(self) !== 'home');
    if (m.stage === 'explore') { hurtCue(self); gnawerCues(state,self); lurkerCues(state,self); }
    const c = m.contract;
    const end = finished(m.stage), report = end || m.stage === 'settled';
    el('result').hidden = !report;
    el('next').hidden = m.stage !== 'settled';
    if (report) {
      el('mission').hidden = true;
      const details = 'Build '+import.meta.env.VITE_RELAY_BUILD+' · Layout v'+layout.version+' · Contract '+c.seed+' · Expedition '+(c.index+1)+' · Seed '+layout.seed;
      if (reference.value !== details) {
        reference.value = details;
        copy.textContent = 'Copy reference';
      }
      // Rebuild the receipt only when the contract changes.
      const key = m.stage+'/'+c.receipts.length+'/'+m.outcome;
      if (key === shownReport) return;
      shownReport = key;
      const wiped = m.stage === 'settled' && m.outcome === 'wipe';
      if (m.stage === 'settled') tone(wiped ? 300 : 520,wiped ? 150 : 780,0.4,0.2);
      const last = c.receipts.at(-1), sold = last && last.expedition === c.index && !wiped ? last : undefined;
      const left = c.expeditions-c.index-1;
      el('result-eyebrow').textContent = wiped ? 'Expedition '+(c.index+1)+' of '+c.expeditions : m.stage === 'settled' ? 'Expedition '+(c.index+1)+' of '+c.expeditions+' sold' : 'Contract report';
      el('result-title').textContent = wiped ? 'Crew lost' : m.stage === 'settled' ? 'Credited '+(sold?.credited ?? 0) : outcomes[m.outcome ?? 'deadline'];
      el('result-detail').textContent = wiped ? 'Nobody made it through the rift. Continue starts a fresh contract; nothing carries over.' :
        'Quota '+c.credited+' of '+c.quota+(m.stage === 'settled' ? ' · '+left+(left === 1 ? ' expedition' : ' expeditions')+' remaining' : '');
      const list = el('receipt');
      list.replaceChildren();
      if (wiped) list.append(line('Credited','0','total'));
      else if (sold) {
        for (const item of sold.items) list.append(line(itemName(item.kind),String(item.value)));
        if (!sold.items.length) list.append(line('Nothing through the rift','0'));
        if (sold.deduction) list.append(line((sold.lost === 1 ? 'Operator' : sold.lost+' operators')+' left behind −'+lossPercent(sold.lost)+'%','−'+sold.deduction,'cut'));
        list.append(line('Credited',String(sold.credited),'total'));
      } else for (const r of c.receipts) list.append(line('Expedition '+(r.expedition+1),String(r.credited)));
      return;
    }
    shownReport = '';
    const banked = m.haul.filter(h => h.banked).length;
    if (banked > lastBanked) { tone(420,620,0.25,0.18); subtitle('Salvage into the rift'); }
    lastBanked = banked;
    // The bell tolls for everyone, wherever they are.
    const rung = m.bell !== undefined;
    if (rung && !wasRung) {
      tone(330,320,2.2,0.3); tone(495,480,1.6,0.12);
      subtitle(placeOf(self) === 'inside' ? 'The bell tolls outside. Something stirs, enraged' : 'The bell tolls. A rift opens, marked by light');
    }
    wasRung = rung;
    // Each move of the Diver rattles its chains for operators within two room
    // connections of the room it enters.
    const heard = listen(layout,placeOf(self) === 'inside' ? room : undefined,m.diver,heardMoves);
    if (heard.clip !== undefined) {
      chain(heard.clip);
      subtitle('Chains rattle through the ceiling nearby');
    }
    heardMoves = heard.heard;
    // A thrown item rings off its bell as it stuns it.
    const stunned = m.diver.stun !== undefined;
    if (stunned && !wasStunned && placeOf(self) === 'inside' && hears(layout,room,m.diver)) {
      tone(1180,1120,0.7,0.07); tone(1770,1700,0.45,0.035);
      subtitle('A clang rings off the bell. It hangs still');
    }
    wasStunned = stunned;
    const alerts: string[] = [];
    if (m.rift) alerts.push('Rift closes in '+clock(m.rift.seconds));
    if (m.escaped?.includes(self.id)) alerts.push('You made it out. Waiting for the rift to close');
    if (m.dead?.includes(self.id)) alerts.push('You died. Your crew can still make it out');
    // Under water: the breath left, and partners going under.
    for (const d of m.drowning ?? []) alerts.push(d.id === self.id ? 'Under water! Get your head up · '+Math.max(0,Math.ceil(d.seconds))+'s' : operator(d.id)+' is under water');
    // Held by the Lurker.
    for (const p of state.players) if (heldBy(m,p.id)) alerts.push(p.id === self.id ? 'Something has you! Mash Space to struggle' : operator(p.id)+' is being dragged into the river! Hit it to free them');
    for (const id of m.dead ?? []) if (id !== self.id) alerts.push(operator(id)+' died');
    for (const id of m.escaped ?? []) if (id !== self.id) alerts.push(operator(id)+' made it out');
    for (const d of m.down) alerts.push((d.id === self.id ? 'You are down. Your partner can revive you' :
      operator(d.id)+' is down. Reach them and revive')+' · '+Math.ceil(d.seconds)+'s');
    const text = preferences.captions && performance.now() < captionUntil ? caption : '';
    if (el('sound-caption').textContent !== text) el('sound-caption').textContent = text;
    const warning = alerts.join(' · ');
    if (el('warning').textContent !== warning) el('warning').textContent = warning;
    el('mission').hidden = briefing || !(warning || text);
  }
  return {enableSound,update};
}
