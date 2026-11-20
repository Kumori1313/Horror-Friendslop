import { createClient } from '@supabase/supabase-js';
import { createGuestService, displayName } from './guest.js';
import type { Admission } from './room.ts';

const game = 'relay-room';
interface Room {
  id: string; game_id: string; round: number; contract_version: number; status: string;
  host_id: string; playable: boolean; join_code: string | null; reason: string | null;
  members: {user_id:string;display_name:string;connected:boolean}[];
}
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export async function mountLobby(launch: (authorize: () => Promise<Admission>, scope: string) => void) {
  const main = document.querySelector('main')!;
  main.hidden = true;
  const lobby = el('hub-lobby');
  lobby.hidden = false;
  const info = el('hub-info'), error = el('hub-error');
  const hubPath = '/game-hub/';
  el('hub-back').onclick = () => location.assign(hubPath);
  const url = import.meta.env.VITE_SUPABASE_URL, key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    error.textContent = 'Configure the shared Supabase project to use Game Hub rooms.';
    el('hub-refresh').hidden = true;
    return;
  }
  const client = createClient(url,key,{auth:{storageKey:'game-hub-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  const guests = createGuestService(client);
  const tab = sessionStorage.getItem('relay-room-tab') || crypto.randomUUID();
  sessionStorage.setItem('relay-room-tab',tab);
  const query = new URLSearchParams(location.search);
  let requested = query.get('lobby') ?? query.get('room');
  let actor = '', name = '', roomId: string | null = null;
  let busy = false, launched = false, heartbeatAt = 0;
  async function rpc<T>(action: string, args: Record<string,unknown> = {}): Promise<T> {
    const result = await client.rpc('room_action',{p_action:action,p_game:game,...args}).abortSignal(AbortSignal.timeout(7000));
    if (result.status === 401) {
      await client.auth.signOut({scope:'local'});
      throw new Error('Your guest session ended. Sign in again.');
    }
    if (result.error) throw Object.assign(new Error(result.error.message),{code:result.error.code});
    if (result.data?.error) throw new Error(result.data.error);
    return result.data as T;
  }
  function updatePath(room: Room | null) {
    const dest = new URL(location.href);
    dest.searchParams.delete('room');
    dest.searchParams.delete('lobby');
    if (room) dest.searchParams.set(room.status === 'playing' ? 'lobby' : 'room',room.id);
    history.replaceState(null,'',dest);
  }
  function selection() {
    el('hub-select').hidden = false;
    el('hub-wait').hidden = true;
    info.textContent = 'Signed in as ' + name;
  }
  async function discover() {
    const {data,error:failure} = await client.from('lobby_summaries').select('id,title,player_count,capacity')
      .eq('game_id',game).eq('status','waiting').gt('host_expires_at',new Date().toISOString()).limit(30)
      .abortSignal(AbortSignal.timeout(7000));
    if (failure) throw new Error(failure.message);
    const list = el('hub-public');
    list.replaceChildren();
    for (const row of data ?? []) {
      const button = document.createElement('button');
      button.textContent = 'Join ' + row.title + ' (' + row.player_count + '/' + row.capacity + ')';
      button.disabled = row.player_count >= row.capacity;
      button.onclick = () => command(async () => { const r = await rpc<Room>('join',{p_lobby:row.id,p_connection:tab}); show(r); });
      list.append(button);
    }
    if (!list.childElementCount) list.textContent = 'No public rooms waiting.';
  }
  function ended() {
    roomId = null;
    updatePath(null);
    if (launched) { location.replace('/relay-room/?ended=1'); return; }
    selection();
    error.textContent = 'This room has ended.';
  }
  function show(room: Room | null) {
    if (!room || room.status === 'closed') { ended(); return; }
    if (room.game_id !== game || room.contract_version !== 2) throw new Error('Incompatible room. Refresh the game.');
    roomId = room.id;
    updatePath(room);
    el('hub-select').hidden = true;
    el('hub-wait').hidden = false;
    el('hub-invite').textContent = room.join_code ? 'Room code: ' + room.join_code : 'Public room';
    el('hub-members').replaceChildren(...room.members.map(m => {
      const item = document.createElement('li');
      item.textContent = m.display_name + (m.user_id === room.host_id ? ' (host)' : '');
      return item;
    }));
    const start = el<HTMLButtonElement>('hub-start');
    start.hidden = actor !== room.host_id;
    start.disabled = !room.playable || room.members.filter(m => m.connected).length !== 2;
    info.textContent = !room.playable ? 'Gameplay is disabled for this deployment.' : 'Signed in as ' + name;
    if (room.status === 'playing' && !launched) {
      if (!room.playable) return;
      main.hidden = false; lobby.hidden = true; el('live-leave').hidden = false;
      try {
        launch(async () => {
          const {data:{session}} = await client.auth.getSession();
          if (!session || session.user.id !== actor) throw Error('Guest session ended');
          return {token:session.access_token,lobby:room.id,round:room.round};
        },[room.id,room.round,actor].join('-'));
        launched = true;
      } catch (failure) { main.hidden = true; lobby.hidden = false; throw failure; }
    }
  }
  async function refresh() {
    if (!actor) { await restore(); return; }
    if (!roomId) { await discover(); return; }
    const heartbeat = Date.now() - heartbeatAt > 14000;
    try {
      const r = await rpc<Room | null>(heartbeat ? 'heartbeat' : 'snapshot',{p_lobby:roomId,p_connection:tab});
      if (heartbeat) heartbeatAt = Date.now();
      show(r);
    } catch (failure) {
      if ((failure as {code?:string}).code === '42501') { ended(); return; }
      throw failure;
    }
  }
  async function restore() {
    const user = await guests.restore();
    if (!user || !displayName(user)) {
      el('hub-guest').hidden = false; info.textContent = 'Enter your guest name to join a room.'; return;
    }
    actor = user.id; name = displayName(user)!;
    el('hub-guest').hidden = true;
    selection();
    const current = await rpc<string|null>('current');
    if (requested && requested !== current) error.textContent = 'You are not a member of the requested room.';
    requested = null;
    roomId = current;
    if (!roomId) updatePath(null);
    await refresh();
  }
  // Serialize the poll and button RPCs. A click during polling runs after that poll.
  let queue: Promise<void> = Promise.resolve();
  function run(task: () => Promise<void>, poll = false) {
    if (poll && busy) return;
    busy = true;
    const next = queue.then(task).catch(failure => {
      error.textContent = failure instanceof Error ? failure.message : 'Room service unavailable.';
      if (launched) el('action').textContent = error.textContent;
    });
    queue = next;
    void next.then(() => { if (queue === next) busy = false; });
  }
  function command(task: () => Promise<void>) {
    if (lobby.hasAttribute('inert')) return;
    lobby.inert = true;
    run(async () => {
      try { error.textContent = ''; await task(); }
      finally { lobby.inert = false; }
    });
  }
  el<HTMLFormElement>('hub-guest').onsubmit = e => {
    e.preventDefault(); command(async () => { await guests.save(el<HTMLInputElement>('hub-name').value); await restore(); });
  };
  el('hub-create').onclick = () => command(async () => {
    roomId = await rpc<string>('create',{p_visibility:el<HTMLSelectElement>('hub-visibility').value,p_capacity:2,p_connection:tab});
    await refresh();
  });
  el<HTMLFormElement>('hub-code-form').onsubmit = e => {
    e.preventDefault(); command(async () => {
      const field = el<HTMLInputElement>('hub-code');
      const room = await rpc<Room>('join_code',{p_code:field.value,p_connection:tab});
      field.value = '';
      show(room);
    });
  };
  el('hub-start').onclick = () => command(async () => { await rpc('start',{p_lobby:roomId}); await refresh(); });
  function leave(destination = hubPath) {
    command(async () => {
      if (roomId) {
        try { await rpc('leave',{p_lobby:roomId}); }
        catch (failure) { if ((failure as {code?:string}).code !== '42501') throw failure; }
      }
      location.assign(destination);
    });
  }
  el('hub-back').onclick = () => leave();
  el('live-leave').onclick = () => leave();
  el('replay').onclick = () => leave('/relay-room/');
  el('hub-refresh').onclick = () => command(roomId ? refresh : restore);
  if (query.has('ended')) error.textContent = 'The round has ended.';
  client.auth.onAuthStateChange((event,session) => {
    if (actor && (event === 'SIGNED_OUT' || (session && session.user.id !== actor))) location.reload();
  });
  run(restore);
  const timer = setInterval(() => { if (actor) run(refresh,true); },2500);
  window.addEventListener('pagehide',() => clearInterval(timer),{once:true});
}
