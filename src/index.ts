import cors from '@fastify/cors';
import Fastify, { type FastifyRequest } from 'fastify';
import { runWithSite } from './context.ts';
import { createHub, createRooms } from './hub.ts';
import { bearerToken, createJwtVerifier } from './jwt.ts';
import {
  canonicalizeOrigin,
  createSiteRegistry,
  SPRUCE_ORIGIN_HEADER,
} from './sites.ts';
import { attachSockets } from './sockets.ts';
import type {
  SiteRecord,
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
  SiteRecord,
  SiteRegistry,
  SpruceNodeApp,
  SpruceNodeConfig,
  SpruceNodeModule,
  SpruceNodeRole,
  WebhookHandler,
  WebhookRegistry,
  WordPressClient,
} from './types.ts';

export {
  canonicalizeOrigin,
  createSiteRegistry,
  loadSitesFromFile,
  parseSitesJson,
  scopedRoom,
  SPRUCE_ORIGIN_HEADER,
} from './sites.ts';

type RawRequest = FastifyRequest & { rawBody?: string };

export async function createApp(config: SpruceNodeConfig): Promise<SpruceNodeApp> {
  const sites = createSiteRegistry(resolveSites(config));
  const http = Fastify({ logger: true });
  const hub = createHub();
  const rooms = createRooms();
  const jwt = createJwtVerifier(sites);
  const fallbackWp = sites.defaultSite() ?? sites.all()[0];
  const wordpress = createWordPressClient(fallbackWp?.wpBaseUrl ?? '');
  const webhookHandlers = new Map<string, WebhookHandler>();
  const loaded: string[] = [];

  await http.register(cors, {
    origin: parseCors(config.corsOrigin, sites.origins()),
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
    sites: sites.origins(),
  }));

  http.get('/auth/me', async (request, reply) => {
    const token = bearerToken(request.headers.authorization);
    if (token === '') {
      return reply.code(401).send({ error: 'missing_token' });
    }

    try {
      return await jwt.verify(token, headerValue(request.headers.origin));
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
    sites,
    modules: loaded,
    webhooks: {
      on(path: string, handler: WebhookHandler): void {
        const route = '/webhooks/' + path.replace(/^\/+/, '');
        webhookHandlers.set(route, handler);
        http.post(route, async (request, reply) => {
          const originHeader = headerValue(request.headers[SPRUCE_ORIGIN_HEADER])
            || headerValue(request.headers.origin);
          const site = (originHeader ? sites.resolve(originHeader) : undefined)
            ?? sites.defaultSite();
          if (!site) {
            return reply.code(400).send({ error: 'unknown_origin' });
          }
          if (site.webhookSecret === '') {
            return reply.code(503).send({ error: 'webhook_unconfigured' });
          }

          const raw = (request as RawRequest).rawBody ?? '';
          const header = headerValue(request.headers['x-webhook-signature']);
          if (!signatureValid(raw, header, site.webhookSecret)) {
            return reply.code(401).send({ error: 'invalid_signature' });
          }

          const payload = isRecord(request.body) ? request.body : {};
          await runWithSite(site, () => handler(payload, bindAppToSite(app, site)));
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
      attachSockets(http.server, hub, rooms, jwt, sites);
      const address = await http.listen({ host: config.host, port: config.port });
      const port = boundPort(address, config.port);
      app.http.log.info(
        { address, modules: loaded, sites: sites.origins() },
        'spruce node listening'
      );
      return { host: config.host, port };
    },
  };

  return app;
}

export function resolveSites(config: SpruceNodeConfig): SiteRecord[] {
  if (config.sites && config.sites.length > 0) {
    return config.sites;
  }

  const origin = canonicalizeOrigin(config.wpBaseUrl ?? '');
  if (origin === '') {
    throw new Error('no_sites_configured');
  }

  return [{
    origin,
    jwtSecret: config.jwtSecret?.trim() ?? '',
    webhookSecret: config.webhookSecret?.trim() ?? '',
    wpBaseUrl: origin,
  }];
}

function bindAppToSite(app: SpruceNodeApp, site: SiteRecord): SpruceNodeApp {
  return {
    ...app,
    site,
    wordpress: createWordPressClient(site.wpBaseUrl || site.origin),
    hub: {
      attach: (socketId, send) => app.hub.attach(socketId, send),
      drop: (socketId) => app.hub.drop(socketId),
      bindSite: (socketId, next) => app.hub.bindSite(socketId, next),
      siteOf: (socketId) => app.hub.siteOf(socketId),
      size: () => app.hub.size(),
      subscribe: (socketId, rooms, bound) => app.hub.subscribe(socketId, rooms, bound ?? site),
      unsubscribe: (socketId, rooms, bound) => app.hub.unsubscribe(socketId, rooms, bound ?? site),
      broadcast: (rooms, message, bound) => app.hub.broadcast(rooms, message, bound ?? site),
    },
  };
}

function boundPort(address: string, fallback: number): number {
  try {
    const port = Number.parseInt(new URL(address).port, 10);
    return Number.isFinite(port) && port > 0 ? port : fallback;
  } catch {
    return fallback;
  }
}

function parseCors(origin: string | undefined, siteOrigins: string[]): boolean | string | string[] {
  const value = origin?.trim() ?? '';
  if (value === '*') {
    return true;
  }

  const extra = value === ''
    ? []
    : value.split(',').map((item) => item.trim()).filter(Boolean);
  const merged = [...new Set([...siteOrigins, ...extra])];
  if (merged.length === 0) {
    return true;
  }

  return merged.length === 1 ? merged[0] : merged;
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
