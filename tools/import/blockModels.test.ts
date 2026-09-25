import { describe, expect, it } from 'vitest';
import { iconFromModel, resolveModel, resolveTexture, tintFor } from './blockModels';

// Minimal copies of the vanilla model hierarchy (models/block/cube.json etc.).
const cubeFaces = Object.fromEntries(['down', 'up', 'north', 'south', 'west', 'east'].map((d) => [d, { texture: `#${d}` }]));
const models: Record<string, Record<string, unknown>> = {
  'block/block': {},
  'block/cube': { parent: 'block/block', elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: cubeFaces }] },
  'block/cube_all': { parent: 'block/cube', textures: { particle: '#all', down: '#all', up: '#all', north: '#all', south: '#all', west: '#all', east: '#all' } },
  'block/orientable': { parent: 'block/cube', textures: { up: '#top', down: '#top', north: '#front', south: '#side', east: '#side', west: '#side' } },
  'block/stone': { parent: 'minecraft:block/cube_all', textures: { all: 'minecraft:block/stone' } },
  'block/furnace': { parent: 'block/orientable', textures: { top: 'block/furnace_top', front: 'block/furnace_front', side: 'block/furnace_side' } },
  'block/grass_block': {
    parent: 'block/block',
    textures: { top: 'block/grass_block_top', side: 'block/grass_block_side', overlay: 'block/grass_block_side_overlay', bottom: 'block/dirt' },
    elements: [
      { from: [0, 0, 0], to: [16, 16, 16], faces: { up: { texture: '#top', tintindex: 0 }, north: { texture: '#side' }, west: { texture: '#side' } } },
      { from: [0, 0, 0], to: [16, 16, 16], faces: { north: { texture: '#overlay', tintindex: 0 }, west: { texture: '#overlay', tintindex: 0 } } },
    ],
  },
  'block/stone_stairs': { parent: 'block/stairs', textures: { particle: 'block/stone', side: 'block/stone' } },
  'block/stairs': { elements: [{ from: [0, 0, 0], to: [16, 8, 16], faces: {} }] },
  'item/stone': { parent: 'minecraft:block/stone' },
  'item/furnace': { parent: 'block/furnace' },
  'item/grass_block': { parent: 'block/grass_block' },
  'item/stone_stairs': { parent: 'block/stone_stairs' },
  'item/poppy': { parent: 'minecraft:item/generated', textures: { layer0: 'minecraft:block/poppy' } },
  'item/generated': { parent: 'builtin/generated' },
  'item/chest': { parent: 'builtin/entity' },
};
const get = (p: string) => models[p];
const icon = (name: string) => iconFromModel(resolveModel(`item/${name}`, get));

describe('block item icons', () => {
  it('follows #references through the parents', () => {
    const m = resolveModel('item/stone', get)!;
    expect(resolveTexture('#north', m.textures)).toBe('block/stone');
  });

  it('full cubes show top, north (left) and west (right) like the inventory', () => {
    expect(icon('furnace')).toEqual({
      kind: 'cube',
      top: [{ texture: 'block/furnace_top', tinted: false }],
      left: [{ texture: 'block/furnace_front', tinted: false }],
      right: [{ texture: 'block/furnace_side', tinted: false }],
    });
  });

  it('keeps tinted overlay layers (grass block sides)', () => {
    const i = icon('grass_block');
    expect(i.kind).toBe('cube');
    if (i.kind !== 'cube') return;
    expect(i.top).toEqual([{ texture: 'block/grass_block_top', tinted: true }]);
    expect(i.left).toEqual([
      { texture: 'block/grass_block_side', tinted: false },
      { texture: 'block/grass_block_side_overlay', tinted: true },
    ]);
  });

  it('falls back to a flat texture for other shapes and flat items', () => {
    expect(icon('stone_stairs')).toEqual({ kind: 'flat', texture: 'block/stone', tinted: false });
    expect(icon('poppy')).toEqual({ kind: 'flat', texture: 'block/poppy', tinted: false });
  });

  it('reports block entities (chests, beds) as not drawable', () => {
    expect(icon('chest').kind).toBe('none');
  });

  it('uses the default item tints', () => {
    expect(tintFor('grass_block')).toBe('#91bd59');
    expect(tintFor('oak_leaves')).toBe('#48b518');
    expect(tintFor('birch_leaves')).toBe('#80a755');
  });
});
