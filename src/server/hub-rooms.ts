import { createHash } from 'node:crypto';
import { generatorVersion } from '../layout.ts';
import { generateLayout } from './generate-layout.ts';
import type { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { createLiveRoom, listenForSockets } from './socket.ts';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

// The runtime calls the same guarded RPC as a browser, using the guest's access
// token and a publishable key. Postgres supplies the verified actor and seat.
export function attachHubRooms(server: EventEmitter, backend: string, key: string, clientOrigin?: string) {
  const override = process.env.RELAY_LAYOUT_SEED;
  if (override !== undefined && (!/^\d+$/.test(override) || Number(override)>0xffffffff)) {
    throw Error('RELAY_LAYOUT_SEED must be an unsigned 32-bit integer.');
  }
  const endpoint = new URL('/rest/v1/rpc/room_action',backend);
  if (!key || (endpoint.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(endpoint.hostname))) {
    throw Error('Configure a trusted Supabase endpoint and publishable key for Relay Room.');
  }
  const rooms = new Map<string,ReturnType<typeof createLiveRoom>>();
  const close = listenForSockets(server,'/relay-room/live',16384,ws => {
    const deadline = setTimeout(() => ws.close(1008,'Admission timed out'),5000);
    let renew: ReturnType<typeof setInterval> | undefined;
    ws.on('error',() => ws.terminate());
    ws.once('close',() => { clearTimeout(deadline); clearInterval(renew); });
    ws.once('message',async data => {
      try {
        const msg = JSON.parse(data.toString());
        const {lobby,round,token} = msg.admission ?? {};
        if (msg.type !== 'join' || typeof token !== 'string' || !uuid.test(lobby) || !Number.isSafeInteger(round)) {
          ws.close(1008,'Active membership required'); return;
        }
        async function verify() {
          const response = await fetch(endpoint,{
            method:'POST', redirect:'error', signal:AbortSignal.timeout(3000),
            headers:{apikey:key, Authorization:'Bearer ' + token,'Content-Type':'application/json'},
            body:JSON.stringify({p_action:'snapshot',p_game:'relay-room',p_lobby:lobby}),
          }).catch(() => null);
          if (!response) { ws.close(1013,'Room service unavailable'); return; }
          if (response.status === 401) { ws.close(4101,'Refresh guest session'); return; }
          if (response.status >= 500 || response.status === 429) {
            ws.close(1013,'Room service unavailable'); return;
          }
          if (!response.ok) throw Error('Membership denied');
          const room = await response.json();
          if (room?.id !== lobby || room.game_id !== 'relay-room' || room.round !== round ||
              room.status !== 'playing' || room.playable !== true || !uuid.test(room.relay?.actor) ||
              ![1,2].includes(room.relay?.seat) || !room.members.some((m: {user_id:string; seat:number; connected:boolean}) =>
                m.user_id === room.relay.actor && m.seat === room.relay.seat && m.connected)) throw Error('Membership ended');
          return room.relay as {actor:string;seat:number};
        }
        const member = await verify();
        if (!member || ws.readyState !== WebSocket.OPEN) return;
        if (msg.layoutVersion !== generatorVersion) {
          ws.close(1008,'Refresh the game for the current layout version');
          return;
        }
        clearTimeout(deadline);
        const id = lobby + '/' + round;
        let live = rooms.get(id);
        function discard() { live?.stop(); rooms.delete(id); }
        if (!live) {
          const seed = override === undefined ? createHash('sha256').update(id).digest().readUInt32LE() : Number(override);
          const layout = generateLayout(seed);
          if (layout.fallback) console.warn('Relay layout fallback',layout.version,layout.seed);
          live = createLiveRoom(20000,discard,layout);
          rooms.set(id,live);
        }
        live.accept(ws,member.seat);
        ws.emit('message',JSON.stringify({type:'join',ticket:msg.ticket}));
        if (!live.occupied()) discard();
        if (ws.readyState !== WebSocket.OPEN) return;
        renew = setInterval(async () => {
          try {
            const current = await verify();
            if (current && (current.actor !== member.actor || current.seat !== member.seat)) ws.close(1008,'Membership ended');
          } catch { ws.close(1008,'Room membership unavailable'); }
        },4000);
      } catch { ws.close(1008,'Active Relay Room membership required'); }
    });
  },clientOrigin);
  server.once('close',() => { for (const room of rooms.values()) room.stop(); rooms.clear(); });
  return close;
}
