// Item catalogue for the UI: importer output (data/generated) when present, else the seed dataset.

import type { Id, ItemDef, LangMap, ModData, ModInfo, Recipe, TagMap } from '../core/types';
import { seedMods } from './seed';

const generatedJson = import.meta.glob('/data/generated/mods/*/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const generatedIcons = import.meta.glob('/data/generated/mods/*/icons/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

function fromGenerated(): ModData[] {
  const byMod = new Map<string, Record<string, unknown>>();
  for (const [path, data] of Object.entries(generatedJson)) {
    const m = /\/mods\/([^/]+)\/([a-z]+)\.json$/.exec(path);
    if (!m) continue;
    byMod.set(m[1], { ...(byMod.get(m[1]) ?? {}), [m[2]]: data });
  }
  const mods: ModData[] = [];
  for (const [id, f] of byMod) {
    if (!f.mod || !f.items) continue;
    const items = f.items as ItemDef[];
    const iconUrls: Record<Id, string> = {};
    for (const it of items) {
      const url = it.icon && generatedIcons[`/data/generated/mods/${id}/icons/${it.icon}`];
      if (url) iconUrls[it.id] = url;
    }
    mods.push({ mod: f.mod as ModInfo, items, tags: (f.tags ?? {}) as TagMap, lang: (f.lang ?? {}) as LangMap, recipes: (f.recipes ?? []) as Recipe[], iconUrls });
  }
  return mods;
}

export interface CatalogItem {
  id: Id;
  fr: string;
  en: string;
  stackSize: number;
  icon?: string;
}

const prettify = (id: Id) =>
  (id.split(':')[1] ?? id)
    .split('/')
    .pop()!
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

function buildCatalog(mods: ModData[]): Map<Id, CatalogItem> {
  const out = new Map<Id, CatalogItem>();
  for (const m of mods) {
    for (const it of m.items) {
      if (it.kind !== 'item') continue;
      const prev = out.get(it.id);
      out.set(it.id, {
        id: it.id,
        fr: m.lang.fr?.[it.id] ?? prev?.fr ?? m.lang.en?.[it.id] ?? prettify(it.id),
        en: m.lang.en?.[it.id] ?? prev?.en ?? prettify(it.id),
        stackSize: it.stackSize ?? prev?.stackSize ?? 64,
        icon: m.iconUrls?.[it.id] ?? prev?.icon,
      });
    }
  }
  return out;
}

const generated = fromGenerated();
export const dataOrigin: 'generated' | 'seed' = generated.length ? 'generated' : 'seed';
export const catalog = buildCatalog(generated.length ? generated : seedMods);
export const catalogList = [...catalog.values()].sort((a, b) => a.fr.localeCompare(b.fr, 'fr'));

export function itemName(id: Id | null | undefined, lang: 'fr' | 'en' = 'fr'): string {
  if (!id) return '—';
  const c = catalog.get(id);
  return c ? c[lang] : prettify(id);
}

export function stackSize(id: Id): number {
  return catalog.get(id)?.stackSize ?? 64;
}
