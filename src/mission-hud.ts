import { roomNames } from './layout.ts';
import type { Layout } from './layout.ts';
import type { Player, Snapshot } from './room.ts';
import { finished } from './mission.ts';

const el = (id: string) => document.getElementById(id)!;

// Build the audio context on the Enter gesture so mobile browsers can play the warning.
export function missionHud() {
  let audio: AudioContext | undefined;
  let lastBeat = '';
  function enableSound() {
    if (!window.AudioContext) return;
    audio ??= new AudioContext();
    void audio.resume().catch(() => {});
  }
  function knock() {
    if (audio?.state !== 'running') return;
    const source = audio.createOscillator(), gain = audio.createGain();
    const now = audio.currentTime;
    source.type = 'triangle';
    source.frequency.setValueAtTime(160,now);
    source.frequency.exponentialRampToValueAtTime(48,now+0.18);
    gain.gain.setValueAtTime(0.22,now);
    gain.gain.exponentialRampToValueAtTime(0.001,now+0.2);
    source.connect(gain).connect(audio.destination);
    source.start(now); source.stop(now+0.21);
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
    const ownLight = state.lamp.owner === self.id;
    const orders = {
      trace: ownLight ? 'Carry the lit flashlight to the gold Relay pad. Send the test tone.' :
        state.lamp.owner ? 'Stand on the gold pad at Intake. Wait for the test tone.' :
        'One operator takes the light to Relay. The other waits on the Intake pad.',
      answer: ownLight ? 'Hold the lit flashlight on the Relay pad until Intake answers.' :
        'Answer from the Intake pad while your partner lights the Relay pad.',
      extract: 'Meet on the green pad at Exit. Extract together.',
      won:'',lost:'',
    };
    el('orders').textContent = orders[m.stage];
    const alerts: string[] = [];
    for (const d of m.down) alerts.push((d.id === self.id ? 'You are down. Your partner can revive you' :
      'Operator '+d.id+' is down. Reach them and revive')+' · '+Math.ceil(d.seconds)+'s');
    const diver = m.diver;
    const bay = layout.rooms.find(r => r.id === diver.bay);
    if (bay && (diver.mode === 'warning' || diver.mode === 'strike')) {
      const label = roomNames[bay.kind]+' ('+bay.id+')';
      alerts.push(diver.mode === 'warning' ? 'Knocking above '+label+'! Clear the marked circle.' : 'Bell Diver striking '+label+'!');
      const beat = diver.mode === 'warning' ? bay.id+'/'+Math.ceil(diver.seconds) : '';
      if (beat && beat !== lastBeat) knock();
      lastBeat = beat;
    } else lastBeat = '';
    const warning = alerts.join(' · ');
    if (el('warning').textContent !== warning) el('warning').textContent = warning;
  }
  return {enableSound,update};
}
