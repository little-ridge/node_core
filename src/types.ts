import type { FastifyInstance } from 'fastify';

export type SpruceNodeRole = 'core' | 'app';

export type SiteRecord = {
  origin: string;
  jwtSecret: string;
  webhookSecret: string;
  wpBaseUrl: string;
  modules?: string[];
};

export type SiteRegistry = {
  all(): SiteRecord[];
  origins(): string[];
  get(origin: string): SiteRecord | undefined;
  resolve(candidate: string): SiteRecord | undefined;
  defaultSite(): SiteRecord | undefined;
};

export type SpruceNodeConfig = {
  host: string;
  port: number;
  sites?: SiteRecord[];
  jwtSecret?: string;
  webhookSecret?: string;
  wpBaseUrl?: string;
  corsOrigin?: string;
};

export type HubMessage = {
  type: 'event';
  event: string;
  rooms: string[];
  payload: Record<string, unknown>;
};

export type RoomRegistry = {
  allow(pattern: RegExp, module?: string): void;
  isAllowed(room: string, site?: SiteRecord): boolean;
};

export type Hub = {
  broadcast(rooms: string[], message: HubMessage, site?: SiteRecord): number;
  subscribe(socketId: string, rooms: string[], site?: SiteRecord): string[];
  unsubscribe(socketId: string, rooms: string[], site?: SiteRecord): string[];
  attach(socketId: string, send: (data: string) => void): void;
  bindSite(socketId: string, site: SiteRecord | undefined): void;
  siteOf(socketId: string): SiteRecord | undefined;
  drop(socketId: string): void;
  size(): number;
};

export type WebhookHandler = (
  payload: Record<string, unknown>,
  app: SpruceNodeApp
) => void | Promise<void>;

export type WebhookRegistry = {
  on(path: string, handler: WebhookHandler): void;
};

export type JwtClaims = {
  sub: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  name?: string;
};

export type JwtVerifier = {
  verify(token: string, originHint?: string): Promise<JwtClaims>;
};

export type WordPressClient = {
  getJson(path: string): Promise<unknown>;
};

export type SpruceNodeApp = {
  config: SpruceNodeConfig;
  http: FastifyInstance;
  hub: Hub;
  rooms: RoomRegistry;
  webhooks: WebhookRegistry;
  jwt: JwtVerifier;
  wordpress: WordPressClient;
  sites: SiteRegistry;
  site?: SiteRecord;
  modules: string[];
  use(mod: SpruceNodeModule): Promise<void>;
  listen(): Promise<{ host: string; port: number }>;
};

export type SpruceNodeModule = {
  name?: string;
  register(app: SpruceNodeApp): void | Promise<void>;
};
