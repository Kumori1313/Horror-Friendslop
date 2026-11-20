import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { setTimeout as wait } from 'node:timers/promises';
import { test } from 'node:test';
import { RoomConnection } from '../src/connection.ts';
import { newerSnapshot } from '../src/room.ts';
import type { ServerMessage, Snapshot, Ticket } from '../src/room.ts';
import { attachRoom } from '../src/server/socket.ts';

async function until(check: () => boolean, reason: string) {
  const start = performance.now();
  while (!check()) {
    if (performance.now()-start > 4500) throw Error('Timed out: ' + reason);
    await wait(5);
  }
}

async function runtime(port = 0) {
  const server = createServer();
  const shutdown = attachRoom(server,1200);
  server.listen(port,'127.0.0.1');
  await once(server,'listening');
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  return { port:addr.port, url:'ws://127.0.0.1:' + addr.port + '/live', close() {
    shutdown();
    return new Promise<void>(resolve => server.close(() => resolve()));
  } };
}

function player(url: string, delay: number, saved: Ticket | null = null) {
  const view = { id:0, ticket:saved, state:undefined as Snapshot | undefined, ended:false, reason:'', arrived:0 };
  const link = new RoomConnection(url,saved,{
    joined(id,ticket) { Object.assign(view,{id,ticket}); },
    snapshot(state) {
      if (view.state?.lamp.owner !== state.lamp.owner) view.arrived = performance.now();
      view.state = state;
    },
    offline(reason,ended) { Object.assign(view,{ended,reason,state:undefined}); },
  },delay);
  link.connect();
  return { view,link };
}

test('two delayed clients recover the holder and measure handoffs', async t => {
  const host = await runtime();
  const a = player(host.url,60), b = player(host.url,140);
  t.after(async () => { a.link.stop(); b.link.stop(); await host.close(); });
  await until(() => !!a.view.state && b.view.state?.players.length === 2,'admission');
  const round = a.view.state!.round;
  const began = performance.now();
  const confirmations: number[] = [], disagreement: number[] = [];
  for (const holder of [a,b,a,b]) {
    for (const action of ['take','drop'] as const) {
      const expected = action === 'take' ? holder.view.id : null;
      const sent = performance.now();
      holder.link.action(action);
      await until(() => a.view.state?.lamp.owner === expected && b.view.state?.lamp.owner === expected,'shared owner');
      confirmations.push(holder.view.arrived - sent);
      disagreement.push(Math.abs(a.view.arrived-b.view.arrived));
    }
  }
  a.link.action('take');
  await until(() => b.view.state?.lamp.owner === a.view.id,'holder');
  // A backgrounded/suspended client stops sending input while its socket stays open.
  a.link.input({forward:1,right:0,yaw:0,pitch:0});
  await wait(800);
  const stopped = b.view.state!.players.find(p => p.id === a.view.id)!.z;
  await wait(220);
  assert.equal(b.view.state!.players.find(p => p.id === a.view.id)!.z,stopped);
  assert.ok(stopped < 3 && stopped > 1.5);
  a.link.interrupt(500);
  await until(() => b.view.state?.players.some(p => !p.connected) === true,'observer sees interruption');
  await until(() => a.view.state?.lamp.owner === a.view.id && a.link.metrics.recovery > 0,'fresh snapshot');
  assert.equal(a.view.state!.round,round);
  assert.equal(a.view.state!.players.find(p => p.id === a.view.id)!.z,stopped);
  assert.equal(b.view.state!.lamp.owner,a.view.id);
  assert.equal(newerSnapshot({...a.view.state!,round:'old-round'},round,-1),false);
  assert.equal(newerSnapshot(a.view.state!,round,a.view.state!.update),false);
  // Include an active client sending movement samples at roughly the game rate.
  const before = { ...b.link.metrics };
  const trafficStart = performance.now();
  for (let n = 0; n < 60; n++) {
    b.link.input({forward:0,right:0,pitch:0,yaw:n/60});
    await wait(33);
  }
  await wait(160);
  const seconds = (performance.now()-trafficStart)/1000;
  t.diagnostic(JSON.stringify({
    samples:confirmations.length, simulatedOneWayMs:[60,140],
    actionConfirmationMs:confirmations.map(Math.round), disagreementMs:disagreement.map(Math.round),
    measuredRttMs:[a,b].map(c => Math.round(c.link.metrics.rtt)),
    recoveryIncluding500msOutageMs:Math.round(a.link.metrics.recovery),
    activePayloadBytesPerSecond:{down:Math.round((b.link.metrics.received-before.received)/seconds),
      up:Math.round((b.link.metrics.sent-before.sent)/seconds)}, durationMs:Math.round(performance.now()-began),
  }));
});

test('a committed pickup with a lost reply cannot be replayed after a resume', async t => {
  const host = await runtime();
  const observer = player(host.url,0);
  const sockets: WebSocket[] = [];
  t.after(async () => { observer.link.stop(); for (const ws of sockets) ws.close(); await host.close(); });
  const connect = async (ticket: Ticket | null) => {
    const ws = new WebSocket(host.url);
    sockets.push(ws);
    const messages: ServerMessage[] = [];
    ws.onmessage = e => messages.push(JSON.parse(e.data));
    ws.onopen = () => ws.send(JSON.stringify({type:'join',ticket}));
    await until(() => messages.some(m => m.type === 'joined'),'seat');
    const joined = messages.find(m => m.type === 'joined')!;
    return {ws,joined};
  };
  const first = await connect(null);
  const {round} = first.joined.ticket;
  const take = JSON.stringify({type:'action',round,seq:1,action:'take'});
  first.ws.onmessage = null; // Discard every reply to this request.
  first.ws.send(take);
  await until(() => observer.view.state?.lamp.owner === first.joined.id,'pickup committed');
  first.ws.close();
  const second = await connect(first.joined.ticket);
  assert.equal(second.joined.lastAction,1);
  assert.equal(first.joined.id,second.joined.id);
  second.ws.send(JSON.stringify({type:'action',round,seq:2,action:'drop'}));
  await until(() => observer.view.state?.lamp.owner === null,'drop');
  const update = observer.view.state!.update;
  second.ws.send(take);
  second.ws.send(JSON.stringify({type:'action',round:'old-round',seq:3,action:'take'}));
  await until(() => (observer.view.state?.update ?? 0) > update+4,'observe retries');
  assert.equal(observer.view.state!.lamp.owner,null);
});

test('refresh restores the holder, expiry drops the light, and a restarted runtime ends the old round', async t => {
  let host = await runtime();
  const clients = [player(host.url,0),player(host.url,0)];
  t.after(async () => { for (const c of clients) c.link.stop(); await host.close(); });
  const [holder,observer] = clients;
  await until(() => observer.view.state?.players.length === 2,'players');
  holder.link.action('take');
  await until(() => holder.view.state?.lamp.owner === holder.view.id,'held');
  holder.link.stop();
  const refreshed = player(host.url,0,holder.view.ticket);
  clients.push(refreshed);
  await until(() => refreshed.view.state?.lamp.owner === holder.view.id,'refresh restored');
  assert.equal(refreshed.view.id,holder.view.id);
  refreshed.link.stop();
  await until(() => observer.view.state?.players.length === 1 && observer.view.state.lamp.owner === null,'expiry');
  const expired = player(host.url,0,holder.view.ticket);
  clients.push(expired);
  await until(() => expired.view.ended,'expired seat ending');
  // Kill the runtime while the observer is connected and restart on the same URL.
  const port = host.port;
  await host.close();
  await until(() => !observer.view.state,'runtime stopped');
  host = await runtime(port);
  await until(() => observer.view.ended,'old round ending after automatic reconnect');
  assert.match(observer.view.reason,/ended/);
  assert.equal(observer.view.state,undefined);
});
