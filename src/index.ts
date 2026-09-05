import cors from '@fastify/cors';
import Fastify, { type FastifyRequest } from 'fastify';
import { createHub, createRooms } from './hub.ts';
import { bearerToken, createJwtVerifier } from './jwt.ts';
import { attachSockets } from './sockets.ts';
import type {
  SpruceNodeApp,
  SpruceNodeConfig,
  SpruceNodeModule,
  WebhookHandler,
} from './types.ts';
import { signatureValid } from './webhook.ts';
import { createWordPressClient } from './wordpress.ts';

export type {
  Hub,
  HubMessage,
  JwtClaims,
  JwtVerifier,
  RoomRegistry,
  SpruceNodeApp,
  SpruceNodeConfig,
  SpruceNodeModule,
  SpruceNodeRole,
  WebhookHandler,
  WebhookRegistry,
  WordPressClient,
} from './types.ts';

type RawRequest = FastifyRequest & { rawBody?: string };

export async function createApp(config: SpruceNodeConfig): Promise<SpruceNodeApp> {
  const http = Fastify({ logger: true });
  const hub = createHub();
  const rooms = createRooms();
  const jwt = createJwtVerifier(config.jwtSecret);
  const wordpress = createWordPressClient(config.wpBaseUrl);
  const webhookHandlers = new Map<string, WebhookHandler>();
  const loaded: string[] = [];

  await http.register(cors, {
    origin: parseCors(config.corsOrigin),
  });

  http.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (request, body, done) => {
      const raw = typeof body === 'string' ? body : body.toString();
      (request as RawRequest).rawBody = raw;
      if (raw === '') {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(raw) as Record<string, unknown>);
      } catch (error) {
        done(error as Error);
      }
    }
  );

  http.get('/health', async () => ({
    ok: true,
    modules: loaded,
    connections: hub.size(),
  }));

  http.get('/auth/me', async (request, reply) => {
    const token = bearerToken(request.headers.authorization);
    if (token === '') {
      return reply.code(401).send({ error: 'missing_token' });
    }

    try {
      return await jwt.verify(token);
    } catch {
      return reply.code(401).send({ error: 'invalid_token' });
    }
  });

  const app: SpruceNodeApp = {
    config,
    http,
    hub,
    rooms,
    jwt,
    wordpress,
    modules: loaded,
    webhooks: {
      on(path: string, handler: WebhookHandler): void {
        const route = '/webhooks/' + path.replace(/^\/+/, '');
        webhookHandlers.set(route, handler);
        http.post(route, async (request, reply) => {
          if (config.webhookSecret === '') {
            return reply.code(503).send({ error: 'webhook_unconfigured' });
          }

          const raw = (request as RawRequest).rawBody ?? '';
          const header = headerValue(request.headers['x-webhook-signature']);
          if (!signatureValid(raw, header, config.webhookSecret)) {
            return reply.code(401).send({ error: 'invalid_signature' });
          }

          const payload = isRecord(request.body) ? request.body : {};
          await handler(payload, app);
          return { ok: true };
        });
      },
    },
    async use(mod: SpruceNodeModule): Promise<void> {
      await mod.register(app);
      if (mod.name) {
        loaded.push(mod.name);
      }
    },
    async listen(): Promise<{ host: string; port: number }> {
      await http.ready();
      attachSockets(http.server, hub, rooms, jwt);
      const address = await http.listen({ host: config.host, port: config.port });
      app.http.log.info({ address, modules: loaded }, 'spruce node listening');
      return { host: config.host, port: config.port };
    },
  };

  return app;
}

function parseCors(origin: string): boolean | string | string[] {
  const value = origin.trim();
  if (value === '' || value === '*') {
    return true;
  }

  const parts = value.split(',').map((item) => item.trim()).filter(Boolean);
  return parts.length === 1 ? parts[0] : parts;
}

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }

  return value ?? '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asModule(
  name: string,
  register: (app: SpruceNodeApp) => void | Promise<void>
): SpruceNodeModule {
  return { name, register };
}
