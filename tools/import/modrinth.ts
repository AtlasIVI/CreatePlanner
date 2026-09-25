// Optional --download mode: fetches Create and configured add-ons from the Modrinth API v2.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchBytes, fetchJson } from './net';

export interface ModsConfig {
  gameVersion: string;
  loader: string;
  mods: string[];
}

interface ModrinthFile {
  url: string;
  filename: string;
  primary: boolean;
  hashes: { sha1?: string };
}

interface ModrinthVersion {
  name: string;
  version_number: string;
  version_type: 'release' | 'beta' | 'alpha';
  files: ModrinthFile[];
}

export function versionsUrl(slug: string, cfg: ModsConfig): string {
  const gv = encodeURIComponent(JSON.stringify([cfg.gameVersion]));
  const ld = encodeURIComponent(JSON.stringify([cfg.loader]));
  return `https://api.modrinth.com/v2/project/${encodeURIComponent(slug)}/version?game_versions=${gv}&loaders=${ld}`;
}

/** Newest release, else newest version of any type (the API lists newest first). */
export function pickVersion(list: ModrinthVersion[]): ModrinthVersion | undefined {
  return list.find((v) => v.version_type === 'release') ?? list[0];
}

const sha1 = (b: Uint8Array) => createHash('sha1').update(b).digest('hex');

export async function downloadMods(cfg: ModsConfig, modsDir: string, log: (s: string) => void): Promise<string[]> {
  const failures: string[] = [];
  for (const slug of cfg.mods) {
    try {
      const list = await fetchJson<ModrinthVersion[]>(versionsUrl(slug, cfg));
      const v = pickVersion(list);
      if (!v) {
        failures.push(`${slug}: no ${cfg.loader} version for ${cfg.gameVersion}`);
        log(`  ! ${slug}: no ${cfg.loader} ${cfg.gameVersion} version`);
        continue;
      }
      const file = v.files.find((f) => f.primary) ?? v.files[0];
      const target = join(modsDir, file.filename);
      if (existsSync(target) && file.hashes.sha1 && sha1(new Uint8Array(readFileSync(target))) === file.hashes.sha1) {
        log(`  = ${file.filename} (cached)`);
        continue;
      }
      const bytes = await fetchBytes(file.url);
      if (file.hashes.sha1 && sha1(bytes) !== file.hashes.sha1) throw new Error('sha1 mismatch');
      writeFileSync(target, bytes);
      log(`  + ${file.filename} (${v.version_number})`);
    } catch (e) {
      failures.push(`${slug}: ${(e as Error).message}`);
      log(`  ! ${slug}: ${(e as Error).message}`);
    }
  }
  return failures;
}
