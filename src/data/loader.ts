// Loads the importer output (data/generated) when present, else the seed dataset.

import type { ItemDef, LangMap, ModData, ModInfo, Recipe, TagMap } from '../core/types';
import { seedMods } from './seed';

const generatedJson = import.meta.glob('/data/generated/mods/*/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const generatedIcons = import.meta.glob('/data/generated/mods/*/icons/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export interface LoadedData {
  mods: ModData[];
  origin: 'generated' | 'seed';
}

function fromGenerated(): ModData[] {
  const byMod = new Map<string, Record<string, unknown>>();
  for (const [path, data] of Object.entries(generatedJson)) {
    const m = /\/mods\/([^/]+)\/([a-z]+)\.json$/.exec(path);
    if (!m) continue;
    const files = byMod.get(m[1]) ?? {};
    files[m[2]] = data;
    byMod.set(m[1], files);
  }
  const iconsByMod = new Map<string, Record<string, string>>();
  for (const [path, url] of Object.entries(generatedIcons)) {
    const m = /\/mods\/([^/]+)\/icons\/([^/]+)$/.exec(path);
    if (!m) continue;
    const icons = iconsByMod.get(m[1]) ?? {};
    icons[m[2]] = url;
    iconsByMod.set(m[1], icons);
  }
  const mods: ModData[] = [];
  for (const [id, f] of byMod) {
    if (!f.mod || !f.recipes || !f.items) continue;
    const items = f.items as ItemDef[];
    const icons = iconsByMod.get(id) ?? {};
    const iconUrls: Record<string, string> = {};
    for (const it of items) if (it.icon && icons[it.icon]) iconUrls[it.id] = icons[it.icon];
    mods.push({
      mod: f.mod as ModInfo,
      items,
      tags: (f.tags ?? {}) as TagMap,
      lang: (f.lang ?? {}) as LangMap,
      recipes: f.recipes as Recipe[],
      iconUrls,
    });
  }
  // Vanilla first so add-ons can override names.
  return mods.sort((a, b) => (a.mod.id === 'minecraft' ? -1 : b.mod.id === 'minecraft' ? 1 : a.mod.id.localeCompare(b.mod.id)));
}

export function loadMods(): LoadedData {
  const gen = fromGenerated();
  if (gen.length) return { mods: gen, origin: 'generated' };
  return { mods: seedMods, origin: 'seed' };
}
