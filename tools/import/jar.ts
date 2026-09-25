// Reads a mod jar (zip) and turns it into ModData + icon files.

import { strFromU8, unzipSync } from 'fflate';
import type { Id, ItemDef, LangMap, ModData, Recipe, TagMap } from '../../src/core/types';
import { normalizeRecipe, recipeIdFromPath } from './normalize';

export interface JarContent {
  mod: ModData;
  /** icon file name -> PNG bytes */
  icons: Map<string, Uint8Array>;
  errors: string[];
  partial: string[];
  nestedJars: string[];
}

const WANTED = [
  /^META-INF\/(neoforge\.)?mods\.toml$/,
  /^META-INF\/MANIFEST\.MF$/,
  /^data\/[^/]+\/recipes?\/.+\.json$/,
  /^data\/[^/]+\/tags\/items?\/.+\.json$/,
  /^assets\/[^/]+\/lang\/(en_us|fr_fr)\.json$/,
  /^assets\/[^/]+\/textures\/(item|block)\/[^/]+\.png$/,
];

export function unzipJar(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes, {
    filter: (f) => WANTED.some((re) => re.test(f.name)),
  });
}

export interface TomlInfo {
  modId?: string;
  displayName?: string;
  version?: string;
}

/** Minimal mods.toml reader: first [[mods]] block only. */
export function readModsToml(text: string): TomlInfo {
  const block = text.split(/^\s*\[\[mods\]\]\s*$/m)[1] ?? '';
  const field = (k: string) => new RegExp(`^\\s*${k}\\s*=\\s*["']([^"']*)["']`, 'm').exec(block)?.[1];
  return { modId: field('modId'), displayName: field('displayName'), version: field('version') };
}

function parseJson(bytes: Uint8Array): unknown {
  // Some lang files start with a BOM.
  return JSON.parse(strFromU8(bytes).replace(/^﻿/, ''));
}

export function readJar(bytes: Uint8Array, fallbackName: string): JarContent {
  const files = unzipJar(bytes);
  const errors: string[] = [];
  const partial: string[] = [];
  const tomlFile = files['META-INF/neoforge.mods.toml'] ?? files['META-INF/mods.toml'];
  const toml = tomlFile ? readModsToml(strFromU8(tomlFile)) : {};
  let version = toml.version;
  if (!version || version.includes('${')) {
    const mf = files['META-INF/MANIFEST.MF'] ? strFromU8(files['META-INF/MANIFEST.MF']) : '';
    version = /Implementation-Version:\s*(\S+)/.exec(mf)?.[1] ?? version;
  }
  const modId = toml.modId ?? fallbackName.replace(/\.jar$/i, '').replace(/[^a-z0-9_]+/gi, '_').toLowerCase();

  const recipes: Recipe[] = [];
  const tags: TagMap = {};
  const lang: LangMap = { en: {}, fr: {} };
  const textures = new Map<string, Uint8Array>();
  const namespaces = new Set<string>();

  for (const [path, data] of Object.entries(files)) {
    let m: RegExpExecArray | null;
    if ((m = /^data\/([^/]+)\/recipes?\/(.+)\.json$/.exec(path))) {
      const id = recipeIdFromPath(path)!;
      try {
        const res = normalizeRecipe(id, modId, parseJson(data));
        if (res.recipe) {
          recipes.push(res.recipe);
          if (res.partial) partial.push(id);
        } else errors.push(`${id}: ${res.error}`);
      } catch (e) {
        errors.push(`${id}: ${(e as Error).message}`);
      }
    } else if ((m = /^data\/([^/]+)\/tags\/items?\/(.+)\.json$/.exec(path))) {
      const tag = `${m[1]}:${m[2]}`;
      try {
        const j = parseJson(data) as { values?: unknown[] };
        tags[tag] = (j.values ?? [])
          .map((v) => (typeof v === 'string' ? v : (v as { id?: string })?.id))
          .filter((v): v is string => !!v);
      } catch (e) {
        errors.push(`tag ${tag}: ${(e as Error).message}`);
      }
    } else if ((m = /^assets\/([^/]+)\/lang\/(en_us|fr_fr)\.json$/.exec(path))) {
      namespaces.add(m[1]);
      const l = m[2] === 'en_us' ? 'en' : 'fr';
      try {
        const entries = parseJson(data) as Record<string, string>;
        for (const [k, v] of Object.entries(entries)) {
          const km = /^(item|block|fluid|fluid_type)\.([^.]+)\.([^.]+)$/.exec(k);
          if (km && typeof v === 'string') lang[l]![`${km[2]}:${km[3]}`] = v;
        }
      } catch (e) {
        errors.push(`lang ${path}: ${(e as Error).message}`);
      }
    } else if ((m = /^assets\/([^/]+)\/textures\/(item|block)\/([^/]+)\.png$/.exec(path))) {
      const key = `${m[1]}:${m[3]}`;
      // Item textures win over block textures.
      if (m[2] === 'item' || !textures.has(key)) textures.set(key, data);
    }
  }

  // Items: every named item/block/fluid of the jar's namespaces + recipe outputs in those namespaces.
  const fluidIds = new Set<Id>();
  const itemIds = new Set<Id>();
  for (const l of Object.values(lang)) for (const id of Object.keys(l ?? {})) itemIds.add(id);
  for (const r of recipes) {
    for (const o of r.outputs) {
      if (namespaces.has(o.id.split(':')[0])) itemIds.add(o.id);
      if (o.kind === 'fluid') fluidIds.add(o.id);
    }
    for (const i of r.inputs) if (i.kind === 'fluid' && i.id) fluidIds.add(i.id);
  }
  const icons = new Map<string, Uint8Array>();
  const items: ItemDef[] = [];
  for (const id of [...itemIds].sort()) {
    const item: ItemDef = { id, kind: fluidIds.has(id) ? 'fluid' : 'item' };
    const tex = textures.get(id);
    if (tex) {
      item.icon = `${id.replace(':', '__')}.png`;
      icons.set(item.icon, tex);
    }
    items.push(item);
  }

  return {
    mod: { mod: { id: modId, name: toml.displayName ?? modId, version, source: 'jar' }, items, tags, lang, recipes },
    icons,
    errors,
    partial,
    nestedJars: listNested(bytes),
  };
}

/** Jar-in-jar libraries (Ponder, Flywheel...) are listed but not imported. */
function listNested(bytes: Uint8Array): string[] {
  const names: string[] = [];
  unzipSync(bytes, {
    filter: (f) => {
      if (/^META-INF\/jarjar\/[^/]+\.jar$/.test(f.name)) names.push(f.name.split('/').pop()!);
      return false;
    },
  });
  return names;
}
