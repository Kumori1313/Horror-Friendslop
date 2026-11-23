import { distances, roomLabel } from './layout.ts';
import type { Layout } from './layout.ts';
import type { Player, Snapshot } from './room.ts';
import type { Preferences } from './preferences.ts';
import { finished, itemName, lossPercent } from './mission.ts';

const el = (id: string) => document.getElementById(id)!;

// Build the audio context on the Enter gesture so mobile browsers can play the warning.
export function missionHud(preferences: Preferences) {
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
  let lastBeat = '', caption = '', captionUntil = 0;
  function subtitle(label: string) {
    caption = label;
    captionUntil = performance.now()+2500;
  }
  function enableSound() {
    if (!window.AudioContext) return;
    audio ??= new AudioContext();
    void audio.resume().catch(() => {});
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
  // Scraping carries through doors and stairs, fading over four connections.
  const hearing = [1,0.6,0.35,0.2];
  const outcomes = {quota:'Quota met',deadline:'Quota missed',wipe:'Crew lost',stranded:'Operator stranded',left:'Contract abandoned'};
  function line(label: string, value: string, kind = '') {
    const li = document.createElement('li');
    if (kind) li.className = kind;
    li.append(Object.assign(document.createElement('span'),{textContent:label}),Object.assign(document.createElement('span'),{textContent:value}));
    return li;
  }
  let lastLoaded = 0, wasAwake = false, shownReport = '';
  function update(layout: Layout, state: Snapshot, self: Player, room: string | undefined, briefing: boolean) {
    const m = state.mission!;
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
      if (m.stage === 'settled') tone(520,780,0.4,0.2);
      const last = c.receipts.at(-1), sold = last && last.expedition === c.index ? last : undefined;
      const left = c.expeditions-c.index-1;
      el('result-eyebrow').textContent = m.stage === 'settled' ? 'Expedition '+(c.index+1)+' of '+c.expeditions+' sold' : 'Contract report';
      el('result-title').textContent = m.stage === 'settled' ? 'Credited '+(sold?.credited ?? 0) : outcomes[m.outcome ?? 'deadline'];
      el('result-detail').textContent = 'Quota '+c.credited+' of '+c.quota+(m.stage === 'settled' ? ' · '+left+(left === 1 ? ' expedition' : ' expeditions')+' remaining' : '');
      const list = el('receipt');
      list.replaceChildren();
      if (sold) {
        for (const item of sold.items) list.append(line(itemName(item.kind),String(item.value)));
        if (!sold.items.length) list.append(line('Nothing loaded','0'));
        if (sold.deduction) list.append(line((sold.lost === 1 ? 'Operator' : sold.lost+' operators')+' left behind −'+lossPercent(sold.lost)+'%','−'+sold.deduction,'cut'));
        list.append(line('Credited',String(sold.credited),'total'));
      } else for (const r of c.receipts) list.append(line('Expedition '+(r.expedition+1),String(r.credited)));
      return;
    }
    shownReport = '';
    const loaded = m.haul.filter(h => h.loaded).length;
    if (loaded > lastLoaded) { tone(420,620,0.25,0.18); subtitle('Salvage loaded onto the lift'); }
    lastLoaded = loaded;
    if (m.awake && !wasAwake) { tone(120,60,0.9,0.22); subtitle('Something shifts in the ceiling wiring'); }
    wasAwake = !!m.awake;
    const alerts: string[] = [];
    for (const d of m.down) alerts.push((d.id === self.id ? 'You are down. Your partner can revive you' :
      'Operator '+d.id+' is down. Reach them and revive')+' · '+Math.ceil(d.seconds)+'s');
    const diver = m.diver;
    const bay = layout.rooms.find(r => r.id === diver.bay);
    if (bay && diver.mode === 'tracking') {
      const beat = 'wire/'+bay.id;
      const hops = beat !== lastBeat && room ? distances(layout.rooms,layout.passages,bay.id).get(room) : undefined;
      if (hops !== undefined && hops < hearing.length) {
        tone(250,75,0.42,0.17*hearing[hops]);
        subtitle(hops <= 1 ? 'Scraping in the wiring above '+roomLabel(bay) : 'Scraping in the wiring nearby');
      }
      lastBeat = beat;
    } else if (bay && (diver.mode === 'warning' || diver.mode === 'strike')) {
      const label = roomLabel(bay);
      alerts.push(diver.mode === 'warning' ? 'Knocking above '+label+'! Clear the marked circle.' : 'Bell Diver striking '+label+'!');
      const beat = diver.mode === 'warning' ? bay.id+'/'+Math.ceil(diver.seconds) : '';
      if (beat && beat !== lastBeat) {
        tone(160,48,0.2,0.35);
        subtitle('Ceiling knock · '+roomLabel(bay));
      }
      lastBeat = beat;
    } else lastBeat = '';
    const text = preferences.captions && performance.now() < captionUntil ? caption : '';
    if (el('sound-caption').textContent !== text) el('sound-caption').textContent = text;
    const warning = alerts.join(' · ');
    if (el('warning').textContent !== warning) el('warning').textContent = warning;
    el('mission').hidden = briefing || !(warning || text);
  }
  return {enableSound,update};
}
