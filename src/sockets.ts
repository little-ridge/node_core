import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { Hub, JwtVerifier, RoomRegistry } from './types.ts';

type ClientMessage = {
  type?: string;
  rooms?: unknown;
  token?: unknown;
};

export function attachSockets(
  server: Server,
  hub: Hub,
  rooms: RoomRegistry,
  jwt: JwtVerifier
): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket: WebSocket, _request: IncomingMessage) => {
    const socketId = randomUUID();
    hub.attach(socketId, (data) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(data);
      }
    });

    send(socket, { type: 'hello', public: true });

    socket.on('message', (raw: RawData) => {
      void handleMessage(socket, socketId, raw, hub, rooms, jwt);
    });

    socket.on('close', () => {
      hub.drop(socketId);
    });
  });

  return wss;
}

async function handleMessage(
  socket: WebSocket,
  socketId: string,
  raw: RawData,
  hub: Hub,
  rooms: RoomRegistry,
  jwt: JwtVerifier
): Promise<void> {
  let message: ClientMessage;
  try {
    message = JSON.parse(raw.toString()) as ClientMessage;
  } catch {
    send(socket, { type: 'error', message: 'invalid_json' });
    return;
  }

  if (message.type === 'auth') {
    const token = typeof message.token === 'string' ? message.token : '';
    try {
      const claims = await jwt.verify(token);
      send(socket, { type: 'authed', sub: claims.sub, name: claims.name ?? '' });
    } catch {
      send(socket, { type: 'error', message: 'invalid_token' });
    }
    return;
  }

  if (message.type === 'subscribe' || message.type === 'unsubscribe') {
    const requested = Array.isArray(message.rooms)
      ? message.rooms.filter((room): room is string => typeof room === 'string')
      : [];
    const allowed = requested.filter((room) => rooms.isAllowed(room));
    const applied = message.type === 'subscribe'
      ? hub.subscribe(socketId, allowed)
      : hub.unsubscribe(socketId, allowed);

    send(socket, {
      type: message.type === 'subscribe' ? 'subscribed' : 'unsubscribed',
      rooms: applied,
    });
    return;
  }

  send(socket, { type: 'error', message: 'unknown_type' });
}

function send(socket: WebSocket, payload: Record<string, unknown>): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}
