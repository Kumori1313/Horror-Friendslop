export interface Preferences {
  sensitivity: number;
  volume: number;
  captions: boolean;
  reducedMotion: boolean;
  // Go fullscreen when play starts on a touch screen.
  fullscreen: boolean;
}

export function bindPreferences(pause: () => void) {
  const key = 'relay-room-preferences';
  const preferences: Preferences = {
    sensitivity:1, volume:0.6, captions:true,
    reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches, fullscreen:true,
  };
  const dialog = document.querySelector<HTMLDialogElement>('#preferences')!;
  let saved: Partial<Preferences> = {};
  try { saved = JSON.parse(localStorage.getItem(key) || '{}') ?? {}; } catch { /* Defaults */ }
  function save() {
    try { localStorage.setItem(key,JSON.stringify(preferences)); } catch { /* Session-only preferences */ }
  }
  for (const name of ['sensitivity','volume'] as const) {
    const field = dialog.querySelector<HTMLInputElement>('#'+name)!;
    const output = dialog.querySelector<HTMLOutputElement>('#'+name+'-value')!;
    const value = saved[name];
    if (typeof value === 'number' && Number.isFinite(value)) {
      preferences[name] = Math.max(Number(field.min),Math.min(Number(field.max),value));
    }
    field.value = String(preferences[name]);
    function display() { output.value = Math.round(preferences[name]*100)+'%'; }
    display();
    field.oninput = () => { preferences[name] = field.valueAsNumber; display(); save(); };
  }
  for (const name of ['captions','reducedMotion','fullscreen'] as const) {
    const field = dialog.querySelector<HTMLInputElement>('#'+name)!;
    if (typeof saved[name] === 'boolean') preferences[name] = saved[name];
    field.checked = preferences[name];
    field.onchange = () => {
      preferences[name] = field.checked; save();
      if (name === 'fullscreen' && !field.checked && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }
  // Only offer fullscreen where the browser supports it for a page.
  dialog.querySelector<HTMLElement>('#fullscreen')!.closest('label')!.hidden = !document.fullscreenEnabled;
  function open() {
    if (dialog.open) return;
    pause();
    if (document.pointerLockElement) document.exitPointerLock();
    dialog.showModal();
  }
  document.getElementById('settings')!.onclick = open;
  return { preferences, open };
}
