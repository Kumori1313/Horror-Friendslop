import type { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { Simulation } from './simulation.ts';
import type { Input, ServerMessage } from '../room.ts';

function validInput(value: Input | undefined) {
  return value && [value.forward, value.right, value.yaw, value.pitch].every(Number.isFinite)
    && Math.abs(value.forward) <= 1 && Math.abs(value.right) <= 1 && Math.abs(value.pitch) <= 1.4;
}

export function attachRoom(server: EventEmitter) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  let room = new Simulation();
  function send(socket: WebSocket, message: ServerMessage) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }
  function upgrade(req: import('node:http').IncomingMessage, socket: Duplex, head: Buffer) {
    if (req.url !== '/live') return;
    if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(req, socket, head, ws => sockets.emit('connection', ws));
  }
  server.on('upgrade', upgrade);
  sockets.on('connection', ws => {
    const id = room.join();
    if (!id) { ws.close(1008, 'Both seats are occupied'); return; }
    send(ws, { type: 'joined', id });
    send(ws, { type: 'state', state: room.state });
    ws.on('message', data => {
      let m;
      try { m = JSON.parse(data.toString()); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.type === 'input' && validInput(m.input)) room.inputs.set(id, m.input);
      if (m.type === 'action' && ['take', 'drop', 'toggle'].includes(m.action)) room.act(id, m.action);
      if (m.type === 'ping' && Number.isFinite(m.time)) send(ws, { type: 'pong', time: m.time });
    });
    ws.on('error', () => ws.terminate());
    ws.on('close', () => {
      room.leave(id);
      if (!room.state.players.length) room = new Simulation();
    });
  });
  const timer = setInterval(() => {
    if (!room.state.players.length) return;
    room.tick(1 / 30);
    for (const ws of sockets.clients) send(ws, { type: 'state', state: room.state });
  }, 1000 / 30);
  timer.unref();
  server.once('close', () => {
    clearInterval(timer);
    server.off('upgrade', upgrade);
    for (const ws of sockets.clients) ws.terminate();
    sockets.close();
  });
}
