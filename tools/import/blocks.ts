// npm run import:blocks [-- --offline]
//
// Builds the vanilla block library (Minecraft 1.21.1) with inventory-style icons:
// block list from PrismarineJS minecraft-data, item/block models from misode/mcmeta
// (JSON-only archive), textures from misode/mcmeta, names from the official lang files.
// Everything is written to data/generated/blocks/ (not versioned: textures belong to Mojang).

import { unzipSync, strFromU8 } from 'fflate';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { iconFromModel, resolveModel, tintFor, type BlockIcon, type FaceLayer } from './blockModels';
import { cachedBytes, pool } from './net';
import { ASSETS_BASE, MCDATA_BASE, MC_VERSION } from './vanilla';

const ROOT = process.cwd();
const CACHE = join(ROOT, 'data', '.cache');
const OUT = join(ROOT, 'data', 'generated', 'blocks');
const MCMETA_JSON_ZIP = `https://codeload.github.com/misode/mcmeta/zip/refs/tags/${MC_VERSION}-assets-json`;
const MCMETA_RAW = `https://raw.githubusercontent.com/misode/mcmeta/${MC_VERSION}-assets/assets/minecraft/`;
const offline = process.argv.includes('--offline');
const log = (s: string) => console.log(s);

interface McBlock {
  name: string;
  displayName: string;
}

export interface OutFace {
  texture: string;
  tint?: string;
}

export type OutIcon =
  | { kind: 'cube'; top: OutFace[]; left: OutFace[]; right: OutFace[] }
  | { kind: 'flat'; texture: string; tint?: string }
  | { kind: 'none'; reason: string };

export interface LibraryBlock {
  id: string;
  en: string;
  fr?: string;
  icon: OutIcon;
}

const fileOf = (texture: string) => `${texture.replace(/\//g, '__')}.png`;

async function json<T>(url: string, cacheName: string): Promise<T> {
  const b = await cachedBytes(url, join(CACHE, cacheName), offline, log);
  if (!b) throw new Error(`Impossible de récupérer ${url}`);
  return JSON.parse(strFromU8(b)) as T;
}

async function main() {
  log(`Bibliothèque de blocs Minecraft ${MC_VERSION}`);
  const blocks = await json<McBlock[]>(MCDATA_BASE + 'blocks.json', 'mcdata-blocks.json');
  const en = await json<Record<string, string>>(ASSETS_BASE + 'lang/en_us.json', 'mc-en_us.json');
  const fr = await json<Record<string, string>>(ASSETS_BASE + 'lang/fr_fr.json', 'mc-fr_fr.json');

  log('Modèles (archive JSON de misode/mcmeta, ~15 Mo, mise en cache)...');
  const zip = await cachedBytes(MCMETA_JSON_ZIP, join(CACHE, `mcmeta-${MC_VERSION}-assets-json.zip`), offline, log);
  if (!zip) throw new Error('Archive des modèles indisponible');
  const files = unzipSync(zip, { filter: (f) => /\/assets\/minecraft\/models\/(block|item)\/.+\.json$/.test(f.name) });
  const models = new Map<string, Record<string, unknown>>();
  for (const [name, data] of Object.entries(files)) {
    const m = /\/assets\/minecraft\/models\/(.+)\.json$/.exec(name);
    if (m) models.set(m[1], JSON.parse(strFromU8(data)));
  }
  log(`  ${models.size} modèles`);

  const library: LibraryBlock[] = [];
  const textures = new Set<string>();
  const face = (block: string) => (l: FaceLayer): OutFace => {
    textures.add(l.texture);
    return l.tinted ? { texture: fileOf(l.texture), tint: tintFor(block) } : { texture: fileOf(l.texture) };
  };
  for (const b of blocks) {
    if (b.name === 'air' || !models.has(`item/${b.name}`)) continue; // no inventory item (fire, wall variants...)
    const icon: BlockIcon = iconFromModel(resolveModel(`item/${b.name}`, (p) => models.get(p)));
    let out: OutIcon;
    if (icon.kind === 'cube') out = { kind: 'cube', top: icon.top.map(face(b.name)), left: icon.left.map(face(b.name)), right: icon.right.map(face(b.name)) };
    else if (icon.kind === 'flat') {
      textures.add(icon.texture);
      out = { kind: 'flat', texture: fileOf(icon.texture) };
    } else out = icon;
    const key = `block.minecraft.${b.name}`;
    library.push({ id: `minecraft:${b.name}`, en: en[key] ?? b.displayName, fr: fr[key], icon: out });
  }

  log(`Textures : ${textures.size} à récupérer...`);
  let missing = 0;
  const got = new Map<string, Uint8Array>();
  await pool([...textures], 12, async (t) => {
    const b = await cachedBytes(`${MCMETA_RAW}textures/${t}.png`, join(CACHE, 'textures', `${t}.png`), offline, () => {});
    if (b) got.set(t, b);
    else missing++;
  });

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, 'textures'), { recursive: true });
  for (const [t, b] of got) {
    const f = join(OUT, 'textures', fileOf(t));
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, b);
  }
  writeFileSync(join(OUT, 'blocks.json'), JSON.stringify({ version: MC_VERSION, blocks: library }) + '\n');

  const count = (k: OutIcon['kind']) => library.filter((l) => l.icon.kind === k).length;
  log('');
  log(`${library.length} blocs : ${count('cube')} cubes 3D, ${count('flat')} icônes plates, ${count('none')} sans icône`);
  if (missing) log(`${missing} texture(s) introuvable(s)`);
  log(`Écrit dans ${OUT}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
