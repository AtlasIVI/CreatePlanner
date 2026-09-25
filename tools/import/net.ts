// Small HTTP helpers with an on-disk cache so the importer also works offline after one run.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const USER_AGENT = 'AtlasIVI/CreatePlanner/0.1 (+https://github.com/AtlasIVI/CreatePlanner; local factory planner)';

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

export async function fetchBytes(url: string, headers: Record<string, string> = {}): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers } });
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!res.ok) {
    const text = new TextDecoder().decode(buf.slice(0, 4000));
    const blocked = /FortiGuard|Web Page Blocked|Access Blocked/i.test(text);
    throw new HttpError(
      blocked ? `${url}: blocked by a network filter (HTTP ${res.status})` : `${url}: HTTP ${res.status}`,
      res.status,
    );
  }
  return buf;
}

export async function fetchJson<T>(url: string): Promise<T> {
  const bytes = await fetchBytes(url, { Accept: 'application/json' });
  const text = new TextDecoder().decode(bytes);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(`${url}: response is not JSON (proxy or filter page?)`);
  }
}

/** Download to cacheFile unless offline; falls back to the cached copy on failure. */
export async function cachedBytes(url: string, cacheFile: string, offline: boolean, log: (s: string) => void): Promise<Uint8Array | undefined> {
  if (!offline) {
    try {
      const bytes = await fetchBytes(url);
      mkdirSync(dirname(cacheFile), { recursive: true });
      writeFileSync(cacheFile, bytes);
      return bytes;
    } catch (e) {
      log(`  ! ${(e as Error).message}`);
    }
  }
  if (existsSync(cacheFile)) {
    log(`  using cached ${cacheFile}`);
    return new Uint8Array(readFileSync(cacheFile));
  }
  return undefined;
}

/** Run async jobs with a concurrency limit. */
export async function pool<T>(items: T[], limit: number, job: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await job(items[i++]);
  });
  await Promise.all(workers);
}
