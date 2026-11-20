// Each surface tracks its own pointer so one thumb can steer while the other looks.
export function bindDrag(surface: HTMLElement, move: (dx: number, dy: number) => void, relative: boolean, active: () => boolean, end?: () => void) {
  let pointer: number | null = null;
  let originX = 0, originY = 0;
  function reset() {
    pointer = null;
    end?.();
  }
  surface.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch' || pointer !== null || !active()) return;
    pointer = e.pointerId;
    const rect = surface.getBoundingClientRect();
    originX = relative ? e.clientX : rect.left + rect.width / 2;
    originY = relative ? e.clientY : rect.top + rect.height / 2;
    surface.setPointerCapture(pointer);
    move(e.clientX - originX,e.clientY - originY);
  });
  surface.addEventListener('pointermove', e => {
    if (e.pointerId !== pointer) return;
    move(e.clientX - originX,e.clientY - originY);
    if (relative) { originX = e.clientX; originY = e.clientY; }
  });
  for (const event of ['pointerup','pointercancel','lostpointercapture'] as const) {
    surface.addEventListener(event,e => { if (e.pointerId === pointer) reset(); });
  }
  return reset;
}
