import { roomNames } from './layout.ts';
import type { Layout } from './layout.ts';
import type { Player, Snapshot } from './room.ts';
import type { Preferences } from './preferences.ts';
import { answerStation, finished } from './mission.ts';

const el = (id: string) => document.getElementById(id)!;

// Build the audio context on the Enter gesture so mobile browsers can play the warning.
export function missionHud(preferences: Preferences) {
  let audio: AudioContext | undefined;
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
    el('mission').hidden = briefing || end;
    el('result').hidden = !end;
    if (end) {
      const won = m.stage === 'won';
      el('result-title').textContent = won ? 'Crew extracted' : 'Signal lost';
      el('result-detail').textContent = won ? 'Both operators made it out. Create a fresh lobby for another facility.' :
        'The crew could not complete the shift. Create a fresh lobby to try again.';
      return;
    }
    const receiver = roomNames[answerStation(layout).kind];
    if (lastStage && m.stage !== lastStage) {
      if (m.stage === 'trace') { tone(70,220,0.65,0.25); subtitle('Switchboard winding up'); }
      if (m.stage === 'answer') { tone(540,680,0.35,0.18); subtitle('Relay test tone'); }
      if (m.stage === 'extract') { tone(340,110,0.6,0.2); subtitle('Exit circuit engaged'); }
    }
    lastStage = m.stage;
    const ownLight = state.lamp.owner === self.id;
    const orders = {
      prime: 'Charge the orange Switchboard pad (S). Send a partner with the light to Relay (R).',
      trace: ownLight ? 'Carry the lit flashlight to the gold Relay pad. Send the test tone.' :
        state.lamp.owner ? 'Wait on the '+receiver+' pad for the test tone.' :
        'Take the light to Relay. A teammate answers from '+receiver+'.',
      answer: ownLight ? 'Hold the lit flashlight on the Relay pad until '+receiver+' answers.' :
        'Answer from the '+receiver+' pad while your partner lights Relay.',
      extract: 'Meet on the green pad at Exit. Extract together.',
      won:'',lost:'',
    };
    el('orders').textContent = orders[m.stage];
    const alerts: string[] = [];
    for (const d of m.down) alerts.push((d.id === self.id ? 'You are down. Your partner can revive you' :
      'Operator '+d.id+' is down. Reach them and revive')+' · '+Math.ceil(d.seconds)+'s');
    const diver = m.diver;
    const bay = layout.rooms.find(r => r.id === diver.bay);
    if (bay && diver.mode === 'tracking') {
      const beat = 'wire/'+bay.id;
      if (beat !== lastBeat) {
        tone(250,75,0.42,0.17);
        subtitle('Scraping in the wiring above '+roomNames[bay.kind]);
      }
      lastBeat = beat;
    } else if (bay && (diver.mode === 'warning' || diver.mode === 'strike')) {
      const label = roomNames[bay.kind]+' ('+bay.id+')';
      alerts.push(diver.mode === 'warning' ? 'Knocking above '+label+'! Clear the marked circle.' : 'Bell Diver striking '+label+'!');
      const beat = diver.mode === 'warning' ? bay.id+'/'+Math.ceil(diver.seconds) : '';
      if (beat && beat !== lastBeat) {
        tone(160,48,0.2,0.35);
        subtitle('Ceiling knock · '+roomNames[bay.kind]);
      }
      lastBeat = beat;
    } else lastBeat = '';
    const text = preferences.captions && performance.now() < captionUntil ? caption : '';
    if (el('sound-caption').textContent !== text) el('sound-caption').textContent = text;
    const warning = alerts.join(' · ');
    if (el('warning').textContent !== warning) el('warning').textContent = warning;
  }
  return {enableSound,update};
}
