// Vanilla data: PrismarineJS minecraft-data (items + crafting recipes) and the official
// en_us / fr_fr lang files, merged with the hand-written seed (smelting recipes, tags).

import type { IngredientRef, ItemDef, LangMap, ModData, Recipe } from '../../src/core/types';
import { mergeIngredients } from './normalize';

export const MC_VERSION = '1.21.1';
export const MCDATA_BASE = `https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data/pc/${MC_VERSION}/`;
export const ASSETS_BASE = `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/${MC_VERSION}/assets/minecraft/`;

export interface McDataItem {
  id: number;
  name: string;
  displayName: string;
  stackSize: number;
}

type Cell = number | null | { id: number; metadata?: number };

export interface McDataRecipe {
  inShape?: Cell[][];
  ingredients?: Cell[];
  result: { id: number; count: number } | number;
}

const cellId = (c: Cell): number | null => (c === null ? null : typeof c === 'number' ? c : c.id);

export function convertMinecraftData(
  items: McDataItem[],
  recipes: Record<string, McDataRecipe[]>,
  langFiles: { en?: Record<string, string>; fr?: Record<string, string> },
): ModData {
  const byNum = new Map(items.map((i) => [i.id, i]));
  const idOf = (n: number | null) => (n === null ? undefined : byNum.get(n) && `minecraft:${byNum.get(n)!.name}`);
  const lang: LangMap = { en: {}, fr: {} };
  const defs: ItemDef[] = items
    .filter((i) => i.name !== 'air')
    .map((i) => ({ id: `minecraft:${i.name}`, kind: 'item', stackSize: i.stackSize }));
  for (const i of items) {
    const id = `minecraft:${i.name}`;
    lang.en![id] = langFiles.en?.[`item.minecraft.${i.name}`] ?? langFiles.en?.[`block.minecraft.${i.name}`] ?? i.displayName;
    const fr = langFiles.fr?.[`item.minecraft.${i.name}`] ?? langFiles.fr?.[`block.minecraft.${i.name}`];
    if (fr) lang.fr![id] = fr;
  }
  for (const f of ['water', 'lava']) {
    defs.push({ id: `minecraft:${f}`, kind: 'fluid' });
    lang.en![`minecraft:${f}`] = langFiles.en?.[`block.minecraft.${f}`] ?? f;
    const fr = langFiles.fr?.[`block.minecraft.${f}`];
    if (fr) lang.fr![`minecraft:${f}`] = fr;
  }

  const out: Recipe[] = [];
  for (const [resultNum, list] of Object.entries(recipes)) {
    list.forEach((r, idx) => {
      const resId = typeof r.result === 'number' ? r.result : r.result.id;
      const count = typeof r.result === 'number' ? 1 : r.result.count;
      const result = idOf(resId) ?? idOf(Number(resultNum));
      if (!result) return;
      const inputs: IngredientRef[] = [];
      let cells = 0;
      let type: string;
      if (r.inShape) {
        type = 'minecraft:crafting_shaped';
        for (const row of r.inShape)
          for (const c of row) {
            const id = idOf(cellId(c));
            if (!id) continue;
            cells++;
            inputs.push({ kind: 'item', id, amount: 1 });
          }
      } else {
        type = 'minecraft:crafting_shapeless';
        for (const c of r.ingredients ?? []) {
          const id = idOf(cellId(c));
          if (!id) continue;
          cells++;
          inputs.push({ kind: 'item', id, amount: 1 });
        }
      }
      if (!inputs.length) return;
      out.push({
        id: `${result}${list.length > 1 ? `_${idx + 1}` : ''}`,
        type,
        mod: 'minecraft',
        inputs: mergeIngredients(inputs),
        outputs: [{ kind: 'item', id: result, amount: count, chance: 1 }],
        cells,
      });
    });
  }
  return {
    mod: { id: 'minecraft', name: 'Minecraft', version: MC_VERSION, source: 'minecraft-data' },
    items: defs,
    tags: {},
    lang,
    recipes: out,
  };
}

const signature = (r: Recipe) =>
  `${r.type}|${r.outputs.map((o) => `${o.id}x${o.amount}`).join(',')}|${r.inputs.reduce((s, i) => s + i.amount, 0)}`;

/** Seed recipes (tag-based, smelting) win over the item-specific minecraft-data duplicates. */
export function mergeVanilla(fromData: ModData, seed: ModData): ModData {
  const items = new Map(fromData.items.map((i) => [i.id, i]));
  for (const i of seed.items) if (!items.has(i.id)) items.set(i.id, i);
  const seen = new Set(seed.recipes.map(signature));
  const recipes = [...seed.recipes];
  const ids = new Set(recipes.map((r) => r.id));
  for (const r of fromData.recipes) {
    if (seen.has(signature(r))) continue;
    let id = r.id;
    while (ids.has(id)) id += '_md';
    ids.add(id);
    recipes.push({ ...r, id });
  }
  return {
    mod: fromData.mod,
    items: [...items.values()],
    tags: { ...seed.tags, ...fromData.tags },
    lang: {
      en: { ...seed.lang.en, ...fromData.lang.en },
      fr: { ...seed.lang.fr, ...fromData.lang.fr },
    },
    recipes,
  };
}
