import { describe, expect, it } from 'vitest';
import { machineFiles } from '../data/machineFiles';
import { seedMods } from '../data/seed';
import { plan, RAW, defaultCandidates, pickRecipe } from './calculator';
import { buildDataSet } from './registry';

const ds = buildDataSet(seedMods, machineFiles);
const perMin = (n: number) => n / 60;

describe('recipe choice', () => {
  it('treats configured raw resources as raw', () => {
    expect(pickRecipe(ds, 'minecraft:iron_ingot', undefined, 'automation').rawReason).toBe('default');
  });
  it('prefers automated processing over hand crafting', () => {
    expect(pickRecipe(ds, 'create:andesite_alloy', undefined, 'automation').recipe?.id).toBe('create:mixing/andesite_alloy');
    expect(pickRecipe(ds, 'create:andesite_alloy', undefined, 'hand').recipe?.id).toBe('create:crafting/materials/andesite_alloy');
  });
  it('ignores storage round-trips (block <-> ingot) unless the input is raw', () => {
    const ids = defaultCandidates(ds, 'minecraft:iron_nugget', 'hand').map((r) => r.id);
    expect(ids[0]).toBe('minecraft:iron_nugget');
    expect(defaultCandidates(ds, 'create:brass_ingot', 'automation').map((r) => r.id)).toEqual(['create:mixing/brass_ingot']);
  });
  it('never picks a recipe where the item is only a chance byproduct', () => {
    const ids = defaultCandidates(ds, 'minecraft:iron_ingot', 'automation').map((r) => r.id);
    expect(ids).not.toContain('create:sequenced_assembly/precision_mechanism');
  });
});

describe('plan: single steps', () => {
  it('iron sheet at 60/min, 64 RPM -> 2 presses, 1024 SU', () => {
    const p = plan(ds, { target: 'create:iron_sheet', rate: 1, rpm: 64 });
    expect(p.steps).toHaveLength(1);
    const s = p.steps[0];
    expect(s.machine?.id).toBe('create:mechanical_press');
    expect(s.machinesExact).toBeCloseTo(1.6, 10);
    expect(s.machines).toBe(2);
    expect(p.totalStress).toBe(1024);
    expect(p.raw).toEqual([{ id: 'minecraft:iron_ingot', kind: 'item', rate: 1 }]);
  });

  it('brass ingot at 60/min, 64 RPM -> 2 heated mixers, 512 SU', () => {
    const p = plan(ds, { target: 'create:brass_ingot', rate: 1, rpm: 64 });
    const s = p.steps[0];
    expect(s.recipe.id).toBe('create:mixing/brass_ingot');
    expect(s.heat).toBe('heated');
    expect(s.executions).toBeCloseTo(0.5, 10); // 2 ingots per batch
    expect(s.machinesExact).toBeCloseTo(0.5 / (20 / 47), 10);
    expect(s.machines).toBe(2);
    expect(p.totalStress).toBe(512);
    const raw = Object.fromEntries(p.raw.map((f) => [f.id, f.rate]));
    expect(raw['minecraft:copper_ingot']).toBeCloseTo(0.5, 10);
    expect(raw['create:zinc_ingot']).toBeCloseTo(0.5, 10);
  });
});

describe('plan: andesite alloy chain at 60/min, 64 RPM', () => {
  const p = plan(ds, { target: 'create:andesite_alloy', rate: 1, rpm: 64 });
  const byRecipe = Object.fromEntries(p.steps.map((s) => [s.recipe.id, s]));

  it('mixes andesite with nuggets washed from crushed raw iron', () => {
    expect(p.steps.map((s) => s.recipe.id)).toEqual([
      'create:mixing/andesite_alloy',
      'create:splashing/crushed_raw_iron',
      'create:crushing/raw_iron',
    ]);
  });

  it('counts machines per step', () => {
    const mix = byRecipe['create:mixing/andesite_alloy'];
    expect(mix.machinesExact).toBeCloseTo(47 / 20, 10);
    expect(mix.machines).toBe(3);
    const wash = byRecipe['create:splashing/crushed_raw_iron'];
    expect(wash.executions).toBeCloseTo(1 / 9, 10);
    expect(wash.machine?.id).toBe('create:fan_washing');
    expect(wash.machines).toBe(1);
    const crush = byRecipe['create:crushing/raw_iron'];
    expect(crush.ticksPerOperation).toBe(21);
    expect(crush.machines).toBe(1);
  });

  it('totals stress: 3x4x64 + 1x2x64 + 1x16x64 = 1920 SU', () => {
    expect(p.totalStress).toBe(1920);
  });

  it('reports raw inputs and chance byproducts', () => {
    const raw = Object.fromEntries(p.raw.map((f) => [f.id, f.rate]));
    expect(raw['minecraft:andesite']).toBeCloseTo(1, 10);
    expect(raw['minecraft:raw_iron']).toBeCloseTo(1 / 9, 10);
    const by = Object.fromEntries(p.byproducts.map((f) => [f.id, f.rate]));
    expect(by['minecraft:redstone']).toBeCloseTo(0.75 / 9, 10);
    expect(by['create:experience_nugget']).toBeCloseTo(0.75 / 9, 10);
  });

  it('follows user recipe choices', () => {
    const q = plan(ds, {
      target: 'create:andesite_alloy',
      rate: 1,
      rpm: 64,
      recipeChoice: { 'minecraft:iron_nugget': 'minecraft:iron_nugget', 'minecraft:iron_ingot': RAW },
    });
    expect(q.steps.map((s) => s.recipe.id)).toEqual(['create:mixing/andesite_alloy', 'minecraft:iron_nugget']);
    // shapeless crafting defaults to the (automated) mixer
    expect(q.steps[1].machine?.id).toBe('create:mechanical_mixer');
    expect(q.raw.find((f) => f.id === 'minecraft:iron_ingot')?.rate).toBeCloseTo(1 / 9, 10);
  });
});

describe('plan: sequenced assembly', () => {
  it('precision mechanism at 1/min: 80% yield, 3 deployer steps x 5 loops', () => {
    const p = plan(ds, { target: 'create:precision_mechanism', rate: perMin(1), rpm: 64 });
    const s = p.steps[0];
    expect(s.executions).toBeCloseTo(perMin(1) / 0.8, 10);
    expect(s.subSteps).toHaveLength(3);
    for (const sub of s.subSteps!) {
      expect(sub.machine?.id).toBe('create:deployer');
      expect(sub.executions).toBeCloseTo((5 * perMin(1)) / 0.8, 10);
      expect(sub.ticksPerOperation).toBe(23);
      expect(sub.machines).toBe(1);
    }
    expect(s.stress).toBe(3 * 4 * 64);
    // Cogwheels feeding the line are deployed (automated) rather than hand-crafted.
    expect(p.steps.some((x) => x.recipe.id === 'create:deploying/cogwheel')).toBe(true);
  });
});

describe('mod toggle', () => {
  it('drops recipes of disabled mods', () => {
    const vanilla = buildDataSet(seedMods, machineFiles, ['minecraft']);
    expect(vanilla.recipesByOutput.get('create:iron_sheet')).toBeUndefined();
    expect(vanilla.machines.every((m) => m.id.startsWith('minecraft:'))).toBe(true);
  });
  it('keeps conditional compat recipes out unless their mod is enabled', () => {
    expect(ds.recipeById.has('create:pressing/compat/immersiveengineering/plate_steel')).toBe(false);
  });
});
