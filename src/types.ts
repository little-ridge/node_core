import type { FastifyInstance } from 'fastify';

export type SpruceNodeRole = 'core' | 'app';

export type SpruceNodeConfig = {
  host: string;
  port: number;
  jwtSecret: string;
  webhookSecret: string;
  wpBaseUrl: string;
  corsOrigin: string;
};

export type HubMessage = {
  type: 'event';
  event: string;
  rooms: string[];
  payload: Record<string, unknown>;
};

export type RoomRegistry = {
  allow(pattern: RegExp): void;
  isAllowed(room: string): boolean;
};

export type Hub = {
  broadcast(rooms: string[], message: HubMessage): number;
  subscribe(socketId: string, rooms: string[]): string[];
  unsubscribe(socketId: string, rooms: string[]): string[];
  attach(socketId: string, send: (data: string) => void): void;
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
  verify(token: string): Promise<JwtClaims>;
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
  modules: string[];
  use(mod: SpruceNodeModule): Promise<void>;
  listen(): Promise<{ host: string; port: number }>;
};

export type SpruceNodeModule = {
  name?: string;
  register(app: SpruceNodeApp): void | Promise<void>;
};
