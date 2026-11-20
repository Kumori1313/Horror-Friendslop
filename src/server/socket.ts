import { randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { Simulation } from './simulation.ts';
import type { Input, ServerMessage } from '../room.ts';

function validInput(value: Input | undefined) {
  return value && [value.forward, value.right, value.yaw, value.pitch].every(Number.isFinite)
    && Math.abs(value.forward) <= 1 && Math.abs(value.right) <= 1 && Math.abs(value.pitch) <= 1.4;
}

interface Seat {
  id: number;
  token: string;
  ws?: WebSocket;
  expires: number;
  lastAction: number;
  lastInput: number;
  lastPong: number;
}

export function attachRoom(server: EventEmitter, graceMs = 20000) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const seats = new Map<string, Seat>();
  let room = new Simulation();
  function send(socket: WebSocket, message: ServerMessage) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }
  function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    if (req.url !== '/live') return;
    if (req.headers.origin && !['http://','https://'].some(s => req.headers.origin === s + req.headers.host)) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(req, socket, head, ws => sockets.emit('connection', ws));
  }
  function stopWalking(id: number) {
    const input = room.inputs.get(id)!;
    input.forward = input.right = 0;
  }
  server.on('upgrade', upgrade);
  sockets.on('connection', ws => {
    let seat: Seat | undefined;
    const joinTimeout = setTimeout(() => ws.close(1008, 'Join timed out'), 5000);
    ws.on('message', data => {
      let m;
      try { m = JSON.parse(data.toString()); } catch { return; }
      if (!m || typeof m !== 'object' || ws.readyState !== WebSocket.OPEN) return;
      if (!seat) {
        if (m.type !== 'join') return;
        if (m.ticket !== null) {
          const saved = seats.get(m.ticket?.token);
          if (!saved || m.ticket.round !== room.state.round || saved.expires <= Date.now()) {
            ws.close(4001, 'Previous round or seat ended');
            return;
          }
          saved.ws?.close(4002, 'Seat resumed elsewhere');
          seat = saved;
        } else {
          const id = room.join();
          if (!id) { ws.close(1008, 'Both seats are occupied'); return; }
          seat = { id, token: randomUUID(), lastAction: 0, ws, expires: Infinity, lastInput: 0, lastPong: 0 };
          seats.set(seat.token,seat);
        }
        clearTimeout(joinTimeout);
        seat.ws = ws;
        seat.expires = Infinity;
        seat.lastPong = Date.now();
        stopWalking(seat.id);
        room.state.players.find(p => p.id === seat!.id)!.connected = true;
        send(ws, { type: 'joined', id: seat.id, ticket: { round: room.state.round, token: seat.token }, lastAction: seat.lastAction });
        send(ws, { type: 'state', state: room.state });
        return;
      }
      if (seat.ws !== ws) return;
      if (m.type === 'ping' && Number.isFinite(m.time)) send(ws, { type: 'pong', time: m.time });
      if (m.round !== room.state.round) return;
      if (m.type === 'input' && validInput(m.input)) {
        seat.lastInput = Date.now();
        room.inputs.set(seat.id,m.input);
      }
      if (m.type === 'action' && Number.isSafeInteger(m.seq) && m.seq > seat.lastAction &&
          ['take','drop','toggle'].includes(m.action)) {
        seat.lastAction = m.seq;
        room.act(seat.id,m.action);
      }
    });
    ws.on('pong', () => { if (seat?.ws === ws) seat.lastPong = Date.now(); });
    ws.on('error', () => ws.terminate());
    ws.on('close', () => {
      clearTimeout(joinTimeout);
      if (!seat || seat.ws !== ws) return;
      seat.ws = undefined;
      seat.expires = Date.now() + graceMs;
      stopWalking(seat.id);
      room.state.players.find(p => p.id === seat!.id)!.connected = false;
    });
  });
  const timer = setInterval(() => {
    if (!seats.size) return;
    const now = Date.now();
    for (const seat of seats.values()) {
      if (now >= seat.expires) {
        room.leave(seat.id);
        seats.delete(seat.token);
      } else if (now - seat.lastInput > 350) stopWalking(seat.id);
    }
    if (!seats.size) { room = new Simulation(); return; }
    room.tick(1 / 30);
    for (const {ws,lastPong} of seats.values()) {
      if (ws?.readyState !== WebSocket.OPEN) continue;
      if (now - lastPong > 10000) { ws.terminate(); continue; }
      if (room.state.update % 60 === 0) ws.ping();
      if (ws.bufferedAmount < 8192) send(ws, { type: 'state', state: room.state });
    }
  }, 1000 / 30);
  timer.unref();
  function shutdown() {
    server.off('close',shutdown);
    clearInterval(timer);
    server.off('upgrade', upgrade);
    for (const ws of sockets.clients) ws.terminate();
    sockets.close();
  }
  server.once('close',shutdown);
  return shutdown;
}
