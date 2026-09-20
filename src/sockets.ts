import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { canonicalizeOrigin } from './sites.ts';
import type { Hub, JwtVerifier, RoomRegistry, SiteRegistry } from './types.ts';

type ClientMessage = {
  type?: string;
  rooms?: unknown;
  token?: unknown;
};

export function attachSockets(
  server: Server,
  hub: Hub,
  rooms: RoomRegistry,
  jwt: JwtVerifier,
  sites: SiteRegistry
): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
    const socketId = randomUUID();
    hub.attach(socketId, (data) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(data);
      }
    });

    const originHeader = headerValue(request.headers.origin);
    const fromOrigin = originHeader ? sites.resolve(originHeader) : undefined;
    const site = fromOrigin ?? sites.defaultSite();
    if (site) {
      hub.bindSite(socketId, site);
    }

    send(socket, {
      type: 'hello',
      public: true,
      site: site?.origin ?? '',
    });

    socket.on('message', (raw: RawData) => {
      void handleMessage(socket, socketId, raw, hub, rooms, jwt, sites);
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
  jwt: JwtVerifier,
  sites: SiteRegistry
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
      const bound = hub.siteOf(socketId);
      const claims = await jwt.verify(token, bound?.origin);
      const fromIss = claims.iss ? sites.resolve(claims.iss) : undefined;
      if (fromIss) {
        if (bound && fromIss.origin !== bound.origin) {
          send(socket, { type: 'error', message: 'origin_mismatch' });
          return;
        }
        hub.bindSite(socketId, fromIss);
      }
      send(socket, { type: 'authed', sub: claims.sub, name: claims.name ?? '' });
    } catch {
      send(socket, { type: 'error', message: 'invalid_token' });
    }
    return;
  }

  if (message.type === 'subscribe' || message.type === 'unsubscribe') {
    const site = hub.siteOf(socketId);
    if (!site) {
      send(socket, { type: 'error', message: 'unknown_origin' });
      return;
    }

    const requested = Array.isArray(message.rooms)
      ? message.rooms.filter((room): room is string => typeof room === 'string')
      : [];
    const allowed = requested.filter((room) => rooms.isAllowed(room, site));
    const applied = message.type === 'subscribe'
      ? hub.subscribe(socketId, allowed, site)
      : hub.unsubscribe(socketId, allowed, site);

    send(socket, {
      type: message.type === 'subscribe' ? 'subscribed' : 'unsubscribed',
      rooms: applied,
    });
    return;
  }

  send(socket, { type: 'error', message: 'unknown_type' });
}

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return canonicalizeOrigin(value[0] ?? '');
  }

  return canonicalizeOrigin(value ?? '');
}

function send(socket: WebSocket, payload: Record<string, unknown>): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}
