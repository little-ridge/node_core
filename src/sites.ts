import { readFile } from 'node:fs/promises';
import type { SiteRecord, SiteRegistry } from './types.ts';

export const SPRUCE_ORIGIN_HEADER = 'x-spruce-origin';

export function canonicalizeOrigin(value: string): string {
  const raw = value.trim();
  if (raw === '') {
    return '';
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return '';
    }

    const host = url.hostname.toLowerCase();
    if (host === '') {
      return '';
    }

    const defaultPort = url.protocol === 'https:' ? '443' : '80';
    const portPart = url.port && url.port !== defaultPort ? `:${url.port}` : '';
    return `${url.protocol}//${host}${portPart}`;
  } catch {
    return '';
  }
}

export function normalizeSite(site: SiteRecord): SiteRecord {
  const origin = canonicalizeOrigin(site.origin);
  if (origin === '') {
    throw new Error('invalid_site_origin');
  }

  const wpBaseUrl = site.wpBaseUrl?.trim()
    ? canonicalizeOrigin(site.wpBaseUrl) || site.wpBaseUrl.replace(/\/+$/, '')
    : origin;
  const modules = (site.modules ?? [])
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    origin,
    jwtSecret: site.jwtSecret.trim(),
    webhookSecret: site.webhookSecret.trim(),
    wpBaseUrl,
    modules,
  };
}

export function scopedRoom(origin: string, room: string): string {
  return `site:${canonicalizeOrigin(origin)}:${room}`;
}

export function parseSitesJson(raw: string): SiteRecord[] {
  const parsed = JSON.parse(raw) as { sites?: unknown } | unknown;
  const list = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.sites)
      ? parsed.sites
      : [];

  return list.map((item) => {
    if (!isRecord(item)) {
      throw new Error('invalid_site_record');
    }

    return normalizeSite({
      origin: String(item.origin ?? ''),
      jwtSecret: String(item.jwtSecret ?? item.jwt_secret ?? ''),
      webhookSecret: String(item.webhookSecret ?? item.webhook_secret ?? ''),
      wpBaseUrl: String(item.wpBaseUrl ?? item.wp_base_url ?? ''),
      modules: Array.isArray(item.modules)
        ? item.modules.map((mod) => String(mod))
        : undefined,
    });
  });
}

export async function loadSitesFromFile(path: string): Promise<SiteRecord[]> {
  return parseSitesJson(await readFile(path, 'utf8'));
}

export function createSiteRegistry(sites: SiteRecord[]): SiteRegistry {
  const byOrigin = new Map<string, SiteRecord>();
  for (const site of sites) {
    const normalized = normalizeSite(site);
    byOrigin.set(normalized.origin, normalized);
  }

  return {
    all(): SiteRecord[] {
      return [...byOrigin.values()];
    },
    origins(): string[] {
      return [...byOrigin.keys()];
    },
    get(origin: string): SiteRecord | undefined {
      const key = canonicalizeOrigin(origin);
      return key === '' ? undefined : byOrigin.get(key);
    },
    resolve(candidate: string): SiteRecord | undefined {
      return this.get(candidate);
    },
    defaultSite(): SiteRecord | undefined {
      return byOrigin.size === 1 ? [...byOrigin.values()][0] : undefined;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
