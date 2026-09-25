import { describe, expect, it } from 'vitest';
import { normalizeRecipe, parseIngredient, recipeIdFromPath } from './normalize';

describe('recipeIdFromPath', () => {
  it('accepts recipe and recipes folders', () => {
    expect(recipeIdFromPath('data/create/recipe/pressing/iron_ingot.json')).toBe('create:pressing/iron_ingot');
    expect(recipeIdFromPath('data/foo/recipes/bar.json')).toBe('foo:bar');
    expect(recipeIdFromPath('data/foo/tags/item/bar.json')).toBeUndefined();
  });
});

describe('parseIngredient', () => {
  it('reads items, tags, lists and NeoForge fluids', () => {
    expect(parseIngredient({ item: 'minecraft:flint' })).toEqual({ kind: 'item', id: 'minecraft:flint', amount: 1 });
    expect(parseIngredient({ tag: 'c:ingots/iron' })).toEqual({ kind: 'item', tag: 'c:ingots/iron', amount: 1 });
    expect(parseIngredient([{ item: 'a:x' }, { item: 'a:y' }])).toEqual({ kind: 'item', id: 'a:x', alternatives: ['a:y'], amount: 1 });
    expect(parseIngredient({ type: 'neoforge:single', fluid: 'minecraft:lava', amount: 100 })).toEqual({
      kind: 'fluid',
      id: 'minecraft:lava',
      amount: 100,
    });
    expect(parseIngredient({ type: 'neoforge:tag', tag: 'c:milk', amount: 250 })).toEqual({ kind: 'fluid', tag: 'c:milk', amount: 250 });
  });
});

describe('normalizeRecipe', () => {
  it('Create processing recipe with chance output and duration', () => {
    const { recipe } = normalizeRecipe('create:crushing/raw_iron', 'create', {
      type: 'create:crushing',
      ingredients: [{ tag: 'c:raw_materials/iron' }],
      processing_time: 400,
      results: [{ id: 'create:crushed_raw_iron' }, { chance: 0.75, id: 'create:experience_nugget' }],
    });
    expect(recipe).toMatchObject({
      type: 'create:crushing',
      duration: 400,
      outputs: [
        { id: 'create:crushed_raw_iron', amount: 1, chance: 1 },
        { id: 'create:experience_nugget', amount: 1, chance: 0.75 },
      ],
    });
  });

  it('merges repeated ingredients and reads fluid results and heat', () => {
    const { recipe } = normalizeRecipe('create:mixing/tea', 'create', {
      type: 'create:mixing',
      heat_requirement: 'heated',
      ingredients: [{ item: 'minecraft:flint' }, { item: 'minecraft:flint' }, { type: 'neoforge:single', amount: 250, fluid: 'minecraft:water' }],
      results: [{ amount: 500, id: 'create:tea' }],
    });
    expect(recipe?.heat).toBe('heated');
    expect(recipe?.inputs).toEqual([
      { kind: 'item', id: 'minecraft:flint', amount: 2 },
      { kind: 'fluid', id: 'minecraft:water', amount: 250 },
    ]);
    expect(recipe?.outputs).toEqual([{ kind: 'fluid', id: 'create:tea', amount: 500, chance: 1 }]);
  });

  it('counts shaped pattern cells', () => {
    const { recipe } = normalizeRecipe('create:x', 'create', {
      type: 'minecraft:crafting_shaped',
      key: { A: { item: 'minecraft:andesite' }, B: { tag: 'c:nuggets/iron' } },
      pattern: ['BA', 'AB'],
      result: { count: 1, id: 'create:andesite_alloy' },
    });
    expect(recipe?.cells).toBe(4);
    expect(recipe?.inputs).toEqual([
      { kind: 'item', tag: 'c:nuggets/iron', amount: 2 },
      { kind: 'item', id: 'minecraft:andesite', amount: 2 },
    ]);
  });

  it('turns sequenced assembly weights into probabilities and multiplies step inputs by loops', () => {
    const { recipe } = normalizeRecipe('create:sequenced_assembly/x', 'create', {
      type: 'create:sequenced_assembly',
      ingredient: { tag: 'c:plates/gold' },
      loops: 5,
      results: [{ chance: 120, id: 'create:precision_mechanism' }, { chance: 30, id: 'create:golden_sheet' }],
      sequence: [
        { type: 'create:deploying', ingredients: [{ item: 'create:incomplete_precision_mechanism' }, { item: 'create:cogwheel' }], results: [] },
      ],
      transitional_item: { id: 'create:incomplete_precision_mechanism' },
    });
    expect(recipe?.outputs.map((o) => o.chance)).toEqual([0.8, 0.2]);
    expect(recipe?.inputs).toContainEqual({ kind: 'item', id: 'create:cogwheel', amount: 5 });
    expect(recipe?.sequence).toEqual([{ type: 'create:deploying', inputs: [{ kind: 'item', id: 'create:cogwheel', amount: 1 }] }]);
  });

  it('records mod_loaded conditions', () => {
    const { recipe } = normalizeRecipe('create:c', 'create', {
      'neoforge:conditions': [{ type: 'neoforge:mod_loaded', modid: 'thermal' }],
      type: 'create:pressing',
      ingredients: [{ tag: 'c:ingots/lead' }],
      results: [{ id: 'thermal:lead_plate' }],
    });
    expect(recipe?.requiresMods).toEqual(['thermal']);
  });

  it('keeps unknown recipe types', () => {
    const r = normalizeRecipe('foo:bar', 'foo', { type: 'foo:weird_machine', input: 'x', out: 'y' });
    expect(r.recipe?.type).toBe('foo:weird_machine');
    expect(r.partial).toBe(true);
  });

  it('cooking recipes default their time by type', () => {
    const { recipe } = normalizeRecipe('minecraft:x', 'minecraft', {
      type: 'minecraft:blasting',
      ingredient: { item: 'minecraft:raw_iron' },
      result: { id: 'minecraft:iron_ingot' },
    });
    expect(recipe?.duration).toBe(100);
  });
});
