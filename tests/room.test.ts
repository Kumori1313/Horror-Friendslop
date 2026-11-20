import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { attachRoom } from '../src/server/socket.ts';
import { Simulation } from '../src/server/simulation.ts';
import type { ClientMessage, ServerMessage, Snapshot } from '../src/room.ts';

test('the partition blocks movement except at the doorway', () => {
  const room = new Simulation();
  const id = room.join()!;
  const p = room.state.players[0];
  p.x = 2;
  room.inputs.set(id,{ forward: 1, right: 0, pitch: 0, yaw: 0 });
  for (let i = 0; i < 100; i++) room.tick(1/30);
  assert.ok(p.z > -1 && p.z < 0);
  p.x = 0;
  for (let i = 0; i < 100; i++) room.tick(1/30);
  assert.ok(p.z < -6 && p.z > -7);
});

test('a nearby flashlight across a wall cannot be picked up', () => {
  const room = new Simulation();
  const id = room.join()!;
  Object.assign(room.state.players[0], { x: 2, z: -0.4 });
  Object.assign(room.state.lamp, { x: 2, z: -1.6 });
  room.act(id,'take');
  assert.equal(room.state.lamp.owner,null);
});

test('two live clients agree on pickup, movement, toggle, handoff and disconnect', { timeout: 10000 }, async t => {
  const server = createServer();
  attachRoom(server); server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = 'ws://127.0.0.1:' + address.port + '/live';
  const clients: WebSocket[] = [];
  t.after(async () => {
    for (const ws of clients) ws.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  function client() {
    const ws = new WebSocket(url); clients.push(ws);
    let state: Snapshot | undefined;
    let id = 0;
    ws.on('message',raw => {
      const m = JSON.parse(raw.toString()) as ServerMessage;
      if (m.type === 'joined') id = m.id;
      if (m.type === 'state') state = m.state;
    });
    return {
      ws, get id() { return id; },
      send(m: ClientMessage) { ws.send(JSON.stringify(m)); },
      async wait(check: (s: Snapshot) => boolean) {
        const end = Date.now()+2000;
        while (Date.now() < end) {
          if (state && check(state)) return state;
          await new Promise(resolve => setTimeout(resolve,10));
        }
        throw Error('Timed out waiting for a matching snapshot');
      },
    };
  }
  const a = client(), b = client();
  await Promise.all([a,b].map(c => c.wait(s => s.players.length === 2)));
  const extra = new WebSocket(url);
  assert.equal((await once(extra,'close'))[0],1008);
  for (const c of [a,b]) c.send({type:'action',action:'take'});
  const [s1,s2] = await Promise.all([a,b].map(c => c.wait(s => s.lamp.owner !== null)));
  assert.equal(s1.round,s2.round);
  assert.equal(s1.lamp.owner,s2.lamp.owner);
  const [holder,other] = s1.lamp.owner === a.id ? [a,b] : [b,a];
  other.send({type:'action',action:'drop'});
  holder.send({type:'action',action:'toggle'});
  await Promise.all([a,b].map(c => c.wait(s => s.lamp.owner === holder.id && !s.lamp.on)));
  holder.send({type:'input',input:{forward:1,right:0,yaw:0,pitch:-0.3}});
  await other.wait(s => s.lamp.z < 2.3 && s.lamp.pitch === -0.3);
  holder.send({type:'input',input:{forward:0,right:0,yaw:0,pitch:-0.3}});
  holder.send({type:'action',action:'drop'});
  await other.wait(s => s.lamp.owner === null);
  other.send({type:'action',action:'take'});
  await holder.wait(s => s.lamp.owner === other.id);
  other.ws.close();
  await holder.wait(s => s.players.length === 1 && s.lamp.owner === null);
});
