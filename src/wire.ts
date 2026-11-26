// Snapshot compression for the Game Hub link, where every message counts.
// The host rounds what it sends (`quantize`) and sends only what changed
// (`diff`) since a snapshot the guest has confirmed holding; the guest
// rebuilds the full snapshot (`patch`). Anything unconfirmed goes in full.
import { gone } from './mission.ts';
import { placeOf } from './places.ts';
import type { Snapshot } from './room.ts';

// What one operator's client needs of a snapshot: creatures only where they
// look (their own place, or their partner's once they are dead and watching
// them). The Lurker stays, as its grab sets off alerts anywhere. Creatures
// outside more than `far` m from where they look go to the nearest half
// metre and tenth of a radian: drawn gliding in the dark at that range, they
// look the same, and most frames they don't change.
const far = 30;
export function seenBy(state: Snapshot, id: number): Snapshot {
  const m = state.mission;
  if (!m) return state;
  const self = state.players.find(p => p.id === id);
  const watched = m.dead?.includes(id) ? state.players.find(p => p.id !== id && !gone(m,p.id)) : undefined;
  const here = placeOf(watched ?? self ?? {});
  const mission = {...m}, eye = watched ?? self;
  if (here !== 'inside') delete mission.gnawers;
  if (here !== 'outside') delete mission.stalkers;
  const coarse = <T extends {x: number; y: number; z: number; yaw: number}>(c: T): T => !eye || Math.hypot(c.x-eye.x,c.z-eye.z) <= far ? c :
    {...c,x:Math.round(c.x*2)/2,y:Math.round(c.y*2)/2,z:Math.round(c.z*2)/2,yaw:Math.round(c.yaw*10)/10};
  if (mission.stalkers) mission.stalkers = mission.stalkers.map(coarse);
  if (mission.lurkers) mission.lurkers = mission.lurkers.map(l => here === 'outside' ? coarse(l) : {...l,x:Math.round(l.x),y:Math.round(l.y),z:Math.round(l.z),yaw:0});
  return {...state,mission};
}

// Numbers to 3 decimals (a millimetre, a milliradian), except a thrown item's
// `flight`, which every client replays step by step and must match exactly.
export function quantize<T>(value: T): T {
  const round = (v: unknown, key?: string): unknown => {
    if (typeof v === 'number') return Number.isInteger(v) ? v : Math.round(v*1000)/1000;
    if (Array.isArray(v)) return v.map(e => round(e));
    if (v && typeof v === 'object') {
      if (key === 'flight') return structuredClone(v);
      const out: Record<string,unknown> = {};
      for (const [k,e] of Object.entries(v)) if (e !== undefined) out[k] = round(e,k);
      return out;
    }
    return v;
  };
  return round(value) as T;
}

// A patch: a plain value replaces; an object applies key by key, `$-` lists
// keys removed; `$=` replaces with any value; `$#` patches a list of things
// with ids ([id, patch] pairs), and `$o` gives its new order of ids when the
// members or their order change.
const set = '$=', removed = '$-', items = '$#', order = '$o';
const same = Symbol('same');
type Plain = Record<string,unknown>;
const plain = (v: unknown): v is Plain => !!v && typeof v === 'object' && !Array.isArray(v);
const identified = (v: unknown): v is {id: string | number}[] => Array.isArray(v) && v.length > 0 &&
  v.every(e => plain(e) && (typeof e.id === 'number' || typeof e.id === 'string'));

function changes(a: unknown, b: unknown): unknown {
  if (a === b) return same;
  if (plain(a) && plain(b)) {
    const out: Plain = {};
    let any = false;
    for (const k of Object.keys(b)) { const d = changes(a[k],b[k]); if (d !== same) { out[k] = d; any = true; } }
    const gone = Object.keys(a).filter(k => !(k in b));
    if (gone.length) { out[removed] = gone; any = true; }
    return any ? out : same;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (JSON.stringify(a) === JSON.stringify(b)) return same;
    if (identified(b) && (identified(a) || a.length === 0)) {
      const before = new Map((a as {id: string | number}[]).map(e => [e.id,e])), list: [string | number,unknown][] = [];
      for (const e of b) { const d = before.has(e.id) ? changes(before.get(e.id),e) : {[set]:e}; if (d !== same) list.push([e.id,d]); }
      const ids = b.map(e => e.id), reordered = ids.length !== a.length || ids.some((id,i) => (a as {id: unknown}[])[i].id !== id);
      return reordered ? {[items]:list,[order]:ids} : {[items]:list};
    }
  }
  if (b === null || typeof b !== 'object') return b;
  return {[set]:b};
}
// What changed from `a` to `b`, or undefined if nothing did.
export function diff(a: unknown, b: unknown): unknown {
  const d = changes(a,b);
  return d === same ? undefined : d;
}
// `a` with the patch applied, as a new value; `a` is left as it was.
export function patch<T>(a: T, d: unknown): T {
  return apply(structuredClone(a),d) as T;
}
function apply(a: unknown, d: unknown): unknown {
  if (!plain(d)) return d;
  if (set in d) return structuredClone(d[set]);
  if (items in d) {
    const list = Array.isArray(a) ? a as {id: string | number}[] : [], byId = new Map(list.map(e => [e.id,e as unknown]));
    for (const [id,p] of d[items] as [string | number,unknown][]) byId.set(id,apply(byId.get(id),p));
    return ((d[order] as (string | number)[] | undefined) ?? list.map(e => e.id)).map(id => byId.get(id));
  }
  const out: Plain = plain(a) ? a : {};
  for (const [k,p] of Object.entries(d)) {
    if (k === removed) for (const gone of p as string[]) delete out[gone];
    else out[k] = apply(out[k],p);
  }
  return out;
}

// The snapshots the host has sent, kept briefly by update number, for
// patches against whichever one the guest last confirmed.
export class Sent {
  readonly epoch = Math.floor(Math.random()*2**31);
  private kept = new Map<number,Snapshot>();
  // Rounded for sending: a patch against `have` when this host still holds
  // it, otherwise the whole snapshot.
  frame(state: Snapshot, have?: {epoch: number; update: number}) {
    const now = quantize(state);
    this.kept.set(now.update,now);
    for (const update of this.kept.keys()) if (update < now.update-80) this.kept.delete(update);
    const base = have?.epoch === this.epoch ? this.kept.get(have.update) : undefined;
    return base && base.update !== now.update ? {base:base.update,patch:diff(base,now) ?? {}} : {state:now};
  }
}
// The snapshots the guest holds, by update number, to patch.
export class Held {
  epoch = -1;
  private kept = new Map<number,Snapshot>();
  // A whole snapshot from the host (a new epoch starts afresh).
  whole(epoch: number, state: Snapshot) {
    if (epoch !== this.epoch) { this.kept.clear(); this.epoch = epoch; }
    return this.keep(state);
  }
  // A patch, if its base is held; otherwise nothing.
  patched(epoch: number, base: number, change: unknown) {
    const from = epoch === this.epoch ? this.kept.get(base) : undefined;
    return from ? this.keep(patch(from,change)) : undefined;
  }
  private keep(state: Snapshot) {
    this.kept.set(state.update,structuredClone(state));
    for (const update of this.kept.keys()) if (update < state.update-80) this.kept.delete(update);
    return state;
  }
}
