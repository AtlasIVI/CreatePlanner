import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readJar, readModsToml } from './jar';
import { recipeTypeReport } from './report';
import { convertMinecraftData, mergeVanilla } from './vanilla';

const png = new Uint8Array([137, 80, 78, 71]);

function fakeJar() {
  return zipSync({
    'META-INF/neoforge.mods.toml': strToU8('modLoader="javafml"\n[[mods]]\nmodId="demo"\nversion="1.2.3"\ndisplayName="Demo Addon"\n'),
    'data/demo/recipe/pressing/plate.json': strToU8(
      JSON.stringify({ type: 'create:pressing', ingredients: [{ tag: 'c:ingots/demo' }], results: [{ id: 'demo:plate' }] }),
    ),
    'data/demo/recipe/weird.json': strToU8(JSON.stringify({ type: 'demo:weird', ingredients: [{ item: 'demo:ingot' }], results: [{ id: 'demo:dust' }] })),
    'data/demo/recipe/broken.json': strToU8('{ not json'),
    'data/c/tags/item/ingots/demo.json': strToU8(JSON.stringify({ values: ['demo:ingot', { id: 'demo:other', required: false }] })),
    'assets/demo/lang/en_us.json': strToU8(JSON.stringify({ 'item.demo.plate': 'Demo Plate', 'block.demo.machine': 'Demo Machine', 'misc.x': 'ignored' })),
    'assets/demo/lang/fr_fr.json': strToU8(JSON.stringify({ 'item.demo.plate': 'Plaque démo' })),
    'assets/demo/textures/item/plate.png': png,
    'assets/demo/textures/block/machine.png': png,
    'META-INF/jarjar/lib.jar': new Uint8Array([1, 2, 3]),
  });
}

describe('readJar', () => {
  const content = readJar(fakeJar(), 'demo-1.2.3.jar');

  it('reads mod metadata', () => {
    expect(content.mod.mod).toEqual({ id: 'demo', name: 'Demo Addon', version: '1.2.3', source: 'jar' });
    expect(content.nestedJars).toEqual(['lib.jar']);
  });

  it('normalizes recipes, keeps unknown types and reports broken files', () => {
    expect(content.mod.recipes.map((r) => r.id).sort()).toEqual(['demo:pressing/plate', 'demo:weird']);
    expect(content.errors.length).toBe(1);
  });

  it('reads tags, names and icons', () => {
    expect(content.mod.tags['c:ingots/demo']).toEqual(['demo:ingot', 'demo:other']);
    expect(content.mod.lang.fr?.['demo:plate']).toBe('Plaque démo');
    const plate = content.mod.items.find((i) => i.id === 'demo:plate');
    expect(plate?.icon).toBe('demo__plate.png');
    expect(content.icons.has('demo__machine.png')).toBe(true);
  });

  it('flags recipe types without a machine', () => {
    const types = recipeTypeReport([content.mod], [{ namespace: 'create', machines: [{ recipeTypes: ['create:pressing'], id: 'create:mechanical_press' } as never] }], new Set());
    expect(types.find((t) => t.type === 'demo:weird')?.modelled).toBe(false);
    expect(types.find((t) => t.type === 'create:pressing')?.modelled).toBe(true);
  });
});

describe('readModsToml', () => {
  it('reads the first [[mods]] block', () => {
    expect(readModsToml('[[mods]]\nmodId = "create"\nversion="${file.jarVersion}"\n[[mods]]\nmodId="other"').modId).toBe('create');
  });
});

describe('vanilla conversion', () => {
  const md = convertMinecraftData(
    [
      { id: 1, name: 'iron_ingot', displayName: 'Iron Ingot', stackSize: 64 },
      { id: 2, name: 'iron_block', displayName: 'Block of Iron', stackSize: 64 },
      { id: 3, name: 'iron_nugget', displayName: 'Iron Nugget', stackSize: 64 },
    ],
    {
      '2': [{ inShape: [[1, 1, 1], [1, 1, 1], [1, 1, 1]], result: { id: 2, count: 1 } }],
      '3': [{ ingredients: [1], result: { id: 3, count: 9 } }],
    },
    { fr: { 'item.minecraft.iron_ingot': 'Lingot de fer' } },
  );

  it('converts shaped and shapeless recipes with French names', () => {
    expect(md.recipes.find((r) => r.id === 'minecraft:iron_block')?.inputs).toEqual([{ kind: 'item', id: 'minecraft:iron_ingot', amount: 9 }]);
    expect(md.recipes.find((r) => r.id === 'minecraft:iron_nugget')?.outputs[0].amount).toBe(9);
    expect(md.lang.fr?.['minecraft:iron_ingot']).toBe('Lingot de fer');
  });

  it('lets seed recipes replace identical minecraft-data ones', () => {
    const merged = mergeVanilla(md, {
      mod: { id: 'minecraft', name: 'Minecraft', source: 'seed' },
      items: [],
      tags: { 'c:ingots/iron': ['minecraft:iron_ingot'] },
      lang: {},
      recipes: [
        { id: 'minecraft:iron_nugget', type: 'minecraft:crafting_shapeless', mod: 'minecraft', inputs: [{ kind: 'item', tag: 'c:ingots/iron', amount: 1 }], outputs: [{ kind: 'item', id: 'minecraft:iron_nugget', amount: 9, chance: 1 }] },
      ],
    });
    expect(merged.recipes.filter((r) => r.outputs[0].id === 'minecraft:iron_nugget')).toHaveLength(1);
    expect(merged.recipes.find((r) => r.id === 'minecraft:iron_nugget')?.inputs[0].tag).toBe('c:ingots/iron');
  });
});
