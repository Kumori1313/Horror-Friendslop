import { roomLabel } from './layout.ts';
import type { Layout } from './layout.ts';
import type { Player, Snapshot } from './room.ts';
import type { Preferences } from './preferences.ts';
import { finished } from './mission.ts';

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
  let lastBeat = '', lastStage = '', caption = '', captionUntil = 0;
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
  function update(layout: Layout, state: Snapshot, self: Player, briefing: boolean) {
    const m = state.mission!;
    const end = finished(m.stage);
    el('result').hidden = !end;
    if (end) {
      el('mission').hidden = true;
      const details = 'Build ' + import.meta.env.VITE_RELAY_BUILD + ' · Layout v' + layout.version + ' · Seed ' + layout.seed;
      if (reference.value !== details) {
        reference.value = details;
        copy.textContent = 'Copy reference';
      }
      const won = m.stage === 'won';
      el('result-title').textContent = won ? (m.solo ? 'Operator extracted' : 'Crew extracted') : 'Signal lost';
      if (m.solo) {
        el('result-detail').textContent = won ? 'You made it out.' : 'Your operator went down.';
        return;
      }
      el('result-detail').textContent = won ? 'Both operators made it out. Create a fresh lobby for another facility.' :
        'The crew could not complete the shift. Create a fresh lobby to try again.';
      return;
    }
    if (lastStage && m.stage !== lastStage) {
      if (m.stage === 'trace') { tone(70,220,0.65,0.25); subtitle('Switchboard winding up'); }
      if (m.stage === 'answer') { tone(540,680,0.35,0.18); subtitle('Relay test tone'); }
      if (m.stage === 'extract') { tone(340,110,0.6,0.2); subtitle('Exit circuit engaged'); }
    }
    lastStage = m.stage;
    const alerts: string[] = [];
    for (const d of m.down) alerts.push((d.id === self.id ? 'You are down. Your partner can revive you' :
      'Operator '+d.id+' is down. Reach them and revive')+' · '+Math.ceil(d.seconds)+'s');
    const diver = m.diver;
    const bay = layout.rooms.find(r => r.id === diver.bay);
    if (bay && diver.mode === 'tracking') {
      const beat = 'wire/'+bay.id;
      if (beat !== lastBeat) {
        tone(250,75,0.42,0.17);
        subtitle('Scraping in the wiring above '+roomLabel(bay));
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
