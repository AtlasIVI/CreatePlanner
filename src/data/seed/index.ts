// Seed dataset: same layout as the importer output (data/generated/mods/<mod>/*.json).
// Used when no mods were imported, and by the unit tests.

import type { ItemDef, LangMap, ModData, ModInfo, Recipe, TagMap } from '../../core/types';
import createItems from './create/items.json';
import createLang from './create/lang.json';
import createMod from './create/mod.json';
import createRecipes from './create/recipes.json';
import createTags from './create/tags.json';
import mcItems from './minecraft/items.json';
import mcLang from './minecraft/lang.json';
import mcMod from './minecraft/mod.json';
import mcRecipes from './minecraft/recipes.json';
import mcTags from './minecraft/tags.json';

function mod(info: unknown, items: unknown, tags: unknown, lang: unknown, recipes: unknown): ModData {
  return {
    mod: info as ModInfo,
    items: items as ItemDef[],
    tags: tags as TagMap,
    lang: lang as LangMap,
    recipes: recipes as Recipe[],
  };
}

export const seedMods: ModData[] = [
  mod(mcMod, mcItems, mcTags, mcLang, mcRecipes),
  mod(createMod, createItems, createTags, createLang, createRecipes),
];
