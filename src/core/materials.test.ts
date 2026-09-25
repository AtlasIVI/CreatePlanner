import { describe, expect, it } from 'vitest';
import { machineFiles } from '../data/machineFiles';
import { seedMods } from '../data/seed';
import { plan } from './calculator';
import { gridBlocks, logisticsBlocks, materialList, materialsCsv, planBlocks, type OriginCount } from './materials';
import { emptyProject } from './project';
import { buildDataSet, itemName } from './registry';

const ds = buildDataSet(seedMods, machineFiles);
const tag = (list: { id: string; count: number }[], origin: OriginCount['origin']) => list.map((b) => ({ ...b, origin }));
const qty = (list: { id: string; missing: number }[], id: string) => list.find((l) => l.id === id)?.missing ?? 0;

describe('blocks from a plan', () => {
  it('iron sheet at 60/min -> 2 presses and 2 depots', () => {
    const p = plan(ds, { target: 'create:iron_sheet', rate: 1, rpm: 64 });
    expect(planBlocks(p)).toEqual([
      { id: 'create:mechanical_press', count: 2 },
      { id: 'create:depot', count: 2 },
    ]);
  });

  it('heated mixers bring blaze burners', () => {
    const p = plan(ds, { target: 'create:brass_ingot', rate: 1, rpm: 64 });
    expect(planBlocks(p)).toContainEqual({ id: 'create:blaze_burner', count: 2 });
  });
});

describe('material list', () => {
  const needs = tag(
    [
      { id: 'create:mechanical_press', count: 2 },
      { id: 'create:depot', count: 2 },
    ],
    'plan',
  );

  it('unrolls crafting down to raw resources with whole crafts', () => {
    const m = materialList(ds, needs);
    // 4 casings (log + alloy each), 1 shaft craft (2 alloy -> 8 shafts), 2 depots (1 alloy each) = 8 alloy
    expect(qty(m.intermediates, 'create:andesite_alloy')).toBe(8);
    expect(qty(m.intermediates, 'create:andesite_casing')).toBe(4);
    expect(m.leftovers).toContainEqual({ id: 'create:shaft', count: 6 });
    // 8 alloy by hand = 16 andesite + 16 nuggets (2 ingots -> 18 nuggets), 2 iron blocks = 18 ingots
    expect(qty(m.raw, 'minecraft:andesite')).toBe(16);
    expect(qty(m.raw, 'minecraft:iron_ingot')).toBe(20);
    expect(qty(m.raw, 'minecraft:stripped_oak_log')).toBe(4);
  });

  it('subtracts the stock at every level', () => {
    const m = materialList(ds, needs, { stock: { 'create:andesite_alloy': 8, 'create:mechanical_press': 1 } });
    const press = m.blocks.find((b) => b.id === 'create:mechanical_press')!;
    expect(press).toMatchObject({ needed: 2, fromStock: 1, missing: 1 });
    // One press less: 3 casings, 1 shaft craft, 2 depots = 7 alloy, all from stock
    expect(qty(m.intermediates, 'create:andesite_alloy')).toBe(0);
    expect(m.intermediates.find((l) => l.id === 'create:andesite_alloy')?.fromStock).toBe(7);
    expect(qty(m.raw, 'minecraft:andesite')).toBe(0);
    expect(qty(m.raw, 'minecraft:iron_ingot')).toBe(9);
  });

  it('exports a French-friendly CSV', () => {
    const csv = materialsCsv(materialList(ds, needs), (id) => itemName(ds, id, 'fr'));
    expect(csv.startsWith('﻿Catégorie;Identifiant;Nom;Nécessaire;En stock;À obtenir')).toBe(true);
    expect(csv).toContain('Bloc à poser;create:mechanical_press;Presse mécanique;2;0;2');
  });
});

describe('other block sources', () => {
  it('counts logistics blocks per gauge module', () => {
    const p = emptyProject();
    const blocks = logisticsBlocks([
      {
        id: 'g',
        name: 'g',
        mode: 'recipe',
        output: 'create:iron_sheet',
        outputPerRequest: 4,
        targetStock: 32,
        address: 'a',
        promiseTimeout: null,
        inputs: [],
        machineRate: 1,
        link: { kind: 'chain', rpm: 64, length: 40, frogports: 1 },
        demand: 0,
      },
    ]);
    expect(blocks).toEqual([
      { id: 'create:factory_gauge', count: 1 },
      { id: 'create:stock_link', count: 1 },
      { id: 'create:packager', count: 1 },
      { id: 'create:package_frogport', count: 1 },
      { id: 'create:chain_conveyor', count: 3 },
    ]);
    expect(p.logistics.modules).toEqual([]);
  });

  it('converts placed belt blocks into belt items', () => {
    const grid = emptyProject().grid;
    for (let x = 0; x < 5; x++) grid.cells[`${x},0,0`] = { block: 'create:belt', facing: '+x' };
    grid.cells['9,0,0'] = { block: 'create:shaft', facing: '+z' };
    expect(gridBlocks(ds, grid)).toEqual([
      { id: 'create:belt_connector', count: 3 },
      { id: 'create:shaft', count: 1 },
    ]);
  });
});
