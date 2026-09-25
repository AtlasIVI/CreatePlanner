// npm run import:mods [-- <mods folder>] [--download] [--offline] [--vanilla-icons]
//
// Reads every mod jar, normalizes recipes/tags/names/icons and writes data/generated/.
// With no jar it falls back to the seed dataset, so the app always has data.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ItemDef, LangMap, MachineFile, ModData, ModInfo, Recipe, TagMap } from '../../src/core/types';
import { readJar } from './jar';
import { downloadMods, type ModsConfig } from './modrinth';
import { cachedBytes, pool } from './net';
import { recipeTypeReport, type ImportReport } from './report';
import { ASSETS_BASE, convertMinecraftData, MCDATA_BASE, mergeVanilla, type McDataItem, type McDataRecipe } from './vanilla';

const ROOT = process.cwd();
const OUT = join(ROOT, 'data', 'generated');
const CACHE = join(ROOT, 'data', '.cache');
const SEED = join(ROOT, 'src', 'data', 'seed');
const log = (s: string) => console.log(s);

interface Args {
  modsDir: string;
  download: boolean;
  offline: boolean;
  vanillaIcons: boolean;
}

function parseArgs(argv: string[]): Args {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const positional = argv.filter((a) => !a.startsWith('--'));
  for (const f of flags) {
    if (!['--download', '--offline', '--vanilla-icons'].includes(f)) throw new Error(`Unknown option ${f}`);
  }
  return {
    modsDir: resolve(positional[0] ?? join(ROOT, 'mods')),
    download: flags.has('--download'),
    offline: flags.has('--offline'),
    vanillaIcons: flags.has('--vanilla-icons'),
  };
}

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')) as T;

function readSeed(id: string): ModData {
  const dir = join(SEED, id);
  return {
    mod: readJson<ModInfo>(join(dir, 'mod.json')),
    items: readJson<ItemDef[]>(join(dir, 'items.json')),
    tags: readJson<TagMap>(join(dir, 'tags.json')),
    lang: readJson<LangMap>(join(dir, 'lang.json')),
    recipes: readJson<Recipe[]>(join(dir, 'recipes.json')),
  };
}

function readMachineFiles(): MachineFile[] {
  const dir = join(ROOT, 'data', 'machines');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson<MachineFile>(join(dir, f)));
}

async function vanilla(args: Args, warnings: string[]): Promise<ModData> {
  const seed = readSeed('minecraft');
  log('Vanilla data (minecraft-data + official lang files)...');
  const get = async (url: string, name: string) => {
    const b = await cachedBytes(url, join(CACHE, name), args.offline, log);
    return b ? JSON.parse(new TextDecoder().decode(b)) : undefined;
  };
  const items = (await get(MCDATA_BASE + 'items.json', 'mcdata-items.json')) as McDataItem[] | undefined;
  const recipes = (await get(MCDATA_BASE + 'recipes.json', 'mcdata-recipes.json')) as Record<string, McDataRecipe[]> | undefined;
  const en = (await get(ASSETS_BASE + 'lang/en_us.json', 'mc-en_us.json')) as Record<string, string> | undefined;
  const fr = (await get(ASSETS_BASE + 'lang/fr_fr.json', 'mc-fr_fr.json')) as Record<string, string> | undefined;
  if (!items || !recipes) {
    warnings.push('minecraft-data unavailable: vanilla limited to the seed dataset');
    log('  ! minecraft-data unavailable, using the vanilla seed only');
    return seed;
  }
  const merged = mergeVanilla(convertMinecraftData(items, recipes, { en, fr }), seed);
  log(`  ${merged.items.length} items, ${merged.recipes.length} recipes`);
  return merged;
}

async function vanillaIcons(mod: ModData, referenced: Set<string>, args: Args): Promise<Map<string, Uint8Array>> {
  const icons = new Map<string, Uint8Array>();
  const ids = mod.items.filter((i) => referenced.has(i.id) && i.kind === 'item').map((i) => i.id);
  log(`Vanilla icons for ${ids.length} referenced items...`);
  await pool(ids, 8, async (id) => {
    const p = id.split(':')[1];
    for (const kind of ['item', 'block']) {
      const b = await cachedBytes(`${ASSETS_BASE}textures/${kind}/${p}.png`, join(CACHE, 'icons', `${kind}_${p}.png`), args.offline, () => {});
      if (b) {
        icons.set(`minecraft__${p}.png`, b);
        return;
      }
    }
  });
  for (const i of mod.items) if (icons.has(`minecraft__${i.id.split(':')[1]}.png`)) i.icon = `minecraft__${i.id.split(':')[1]}.png`;
  log(`  ${icons.size} icons`);
  return icons;
}

function writeMod(mod: ModData, icons: Map<string, Uint8Array>) {
  const dir = join(OUT, 'mods', mod.mod.id);
  mkdirSync(dir, { recursive: true });
  const w = (name: string, v: unknown) => writeFileSync(join(dir, name), JSON.stringify(v) + '\n');
  w('mod.json', mod.mod);
  w('items.json', mod.items);
  w('tags.json', mod.tags);
  w('lang.json', mod.lang);
  w('recipes.json', mod.recipes);
  if (icons.size) {
    mkdirSync(join(dir, 'icons'), { recursive: true });
    for (const [name, bytes] of icons) writeFileSync(join(dir, 'icons', name), bytes);
  }
}

function cleanOutput() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  for (const entry of readdirSync(OUT)) {
    if (entry === '.gitkeep') continue;
    rmSync(join(OUT, entry), { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const warnings: string[] = [];
  const errors: string[] = [];

  if (args.download) {
    const cfg = readJson<ModsConfig>(join(ROOT, 'mods.config.json'));
    mkdirSync(args.modsDir, { recursive: true });
    log(`Downloading ${cfg.mods.length} mods from Modrinth (${cfg.loader} ${cfg.gameVersion}) into ${args.modsDir}...`);
    for (const f of await downloadMods(cfg, args.modsDir, log)) warnings.push(`download ${f}`);
  }

  const jars =
    existsSync(args.modsDir) && statSync(args.modsDir).isDirectory()
      ? readdirSync(args.modsDir).filter((f) => f.toLowerCase().endsWith('.jar')).sort()
      : [];
  if (!existsSync(args.modsDir)) warnings.push(`mods folder not found: ${args.modsDir}`);
  log(`${jars.length} jar(s) in ${args.modsDir}`);

  const mods: ModData[] = [];
  const iconSets = new Map<string, Map<string, Uint8Array>>();
  const partialIds = new Set<string>();
  for (const jar of jars) {
    try {
      const content = readJar(new Uint8Array(readFileSync(join(args.modsDir, jar))), jar);
      const id = content.mod.mod.id;
      if (id === 'minecraft') continue;
      if (mods.some((m) => m.mod.id === id)) {
        warnings.push(`${jar}: duplicate mod id ${id}, replacing the previous jar`);
        mods.splice(mods.findIndex((m) => m.mod.id === id), 1);
      }
      mods.push(content.mod);
      iconSets.set(id, content.icons);
      content.partial.forEach((p) => partialIds.add(p));
      errors.push(...content.errors.map((e) => `${jar}: ${e}`));
      log(
        `  ${jar}: ${id} ${content.mod.mod.version ?? ''} — ${content.mod.recipes.length} recipes, ${content.mod.items.length} items, ` +
          `${content.icons.size} icons${content.nestedJars.length ? `, ${content.nestedJars.length} nested jars skipped` : ''}`,
      );
    } catch (e) {
      errors.push(`${jar}: ${(e as Error).message}`);
      log(`  ! ${jar}: ${(e as Error).message}`);
    }
  }
  if (!mods.length) {
    log('No mod jar: using the seed dataset for Create.');
    warnings.push('no jars: Create data comes from the seed dataset');
    mods.push(readSeed('create'));
  }

  const mc = await vanilla(args, warnings);
  const all = [mc, ...mods];
  let mcIcons = new Map<string, Uint8Array>();
  if (args.vanillaIcons) {
    const referenced = new Set<string>();
    for (const m of all) for (const r of m.recipes) {
      r.outputs.forEach((o) => referenced.add(o.id));
      r.inputs.forEach((i) => i.id && referenced.add(i.id));
    }
    mcIcons = await vanillaIcons(mc, referenced, args);
  }

  cleanOutput();
  writeMod(mc, mcIcons);
  for (const m of mods) writeMod(m, iconSets.get(m.mod.id) ?? new Map());

  const types = recipeTypeReport(all, readMachineFiles(), partialIds);
  const report: ImportReport = {
    generatedAt: new Date().toISOString(),
    mods: all.map((m) => ({
      id: m.mod.id,
      name: m.mod.name,
      version: m.mod.version,
      source: m.mod.source,
      recipes: m.recipes.length,
      items: m.items.length,
      icons: m.items.filter((i) => i.icon).length,
    })),
    types,
    unmodelled: types.filter((t) => !t.modelled).map((t) => t.type),
    errors,
    warnings,
  };
  writeFileSync(join(OUT, 'index.json'), JSON.stringify({ generatedAt: report.generatedAt, mods: report.mods.map((m) => m.id) }, null, 2) + '\n');
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');

  log('');
  log(`Wrote ${all.length} mod(s) to ${OUT}`);
  const unmodelled = types.filter((t) => !t.modelled);
  log(`Recipe types: ${types.length} (${unmodelled.length} not modelled by data/machines/*.json)`);
  for (const t of unmodelled) log(`  - ${t.type}: ${t.count} recipe(s) [${t.mods.join(', ')}]`);
  if (errors.length) log(`${errors.length} unreadable file(s), see data/generated/report.json`);
  for (const w of warnings) log(`warning: ${w}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
