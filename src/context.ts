import { AsyncLocalStorage } from 'node:async_hooks';
import type { SiteRecord } from './types.ts';

const siteStore = new AsyncLocalStorage<SiteRecord>();

export function runWithSite<T>(site: SiteRecord, fn: () => T): T {
  return siteStore.run(site, fn);
}

export function currentSite(): SiteRecord | undefined {
  return siteStore.getStore();
}
