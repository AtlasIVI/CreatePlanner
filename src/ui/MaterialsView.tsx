import { useMemo, useState } from 'react';
import { RAW, recipeOptions } from '../core/calculator';
import {
  gridBlocks,
  logisticsBlocks,
  materialList,
  materialsCsv,
  materialsText,
  planBlocks,
  sourceBlocks,
  type MaterialLine,
  type Origin,
  type OriginCount,
} from '../core/materials';
import type { Project } from '../core/project';
import { itemName } from '../core/registry';
import type { Id } from '../core/types';
import { ItemName, ItemPicker, NumberField, Section, Stat } from './components';
import { useApp } from './context';
import { fmt } from './format';
import { usePlan } from './PlannerView';
import { useRecipeText } from './recipes';
import { downloadText } from './storage';

const ORIGIN_FR: Record<Origin, string> = { plan: 'plan', sources: 'sources', logistics: 'logistique', grid: 'grille' };

export function MaterialsView() {
  const { ds, project, update, lang } = useApp();
  const plan = usePlan();
  const [copied, setCopied] = useState<string | null>(null);
  const use = project.materialSources;

  const needs = useMemo(() => {
    const out: OriginCount[] = [];
    const add = (list: { id: Id; count: number }[], origin: Origin) => out.push(...list.map((b) => ({ ...b, origin })));
    if (use.plan && plan) add(planBlocks(plan), 'plan');
    if (use.sources) add(sourceBlocks(ds, project.sources), 'sources');
    if (use.logistics) add(logisticsBlocks(project.logistics.modules), 'logistics');
    if (use.grid) add(gridBlocks(ds, project.grid), 'grid');
    return out;
  }, [ds, plan, project.sources, project.logistics.modules, project.grid, use]);

  const result = useMemo(
    () => materialList(ds, needs, { stock: project.stock, recipeChoice: project.materialChoice, tagChoice: project.planner.tagChoice }),
    [ds, needs, project.stock, project.materialChoice, project.planner.tagChoice],
  );
  const name = (id: Id) => itemName(ds, id, lang);

  const setStock = (id: Id, v: number) =>
    update((p) => {
      const stock = { ...p.stock };
      if (v > 0) stock[id] = v;
      else delete stock[id];
      return { ...p, stock };
    });
  const toggle = (k: keyof Project['materialSources']) => update((p) => ({ ...p, materialSources: { ...p.materialSources, [k]: !p.materialSources[k] } }));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(materialsText(result, name));
      setCopied('Copié dans le presse-papiers');
    } catch {
      setCopied('Copie refusée par le navigateur');
    }
    setTimeout(() => setCopied(null), 2500);
  };

  const missingRaw = result.raw.filter((l) => l.missing > 0).length;
  return (
    <div className="view">
      <Section
        title="Liste de matériaux"
        actions={
          <>
            <button onClick={() => downloadText(`${project.name.replace(/[^\w-]+/g, '_') || 'projet'}-materiaux.csv`, materialsCsv(result, name), 'text/csv;charset=utf-8')}>
              Exporter CSV
            </button>
            <button onClick={copy}>Copier</button>
            {copied && <span className="muted small">{copied}</span>}
          </>
        }
      >
        <div className="row wrap">
          <span className="muted small">Inclure :</span>
          {(Object.keys(ORIGIN_FR) as Origin[]).map((k) => (
            <label key={k} className="inline">
              <input type="checkbox" checked={use[k]} onChange={() => toggle(k)} /> {ORIGIN_FR[k]}
            </label>
          ))}
        </div>
        <div className="stats">
          <Stat label="Blocs différents à poser" value={result.blocks.length} />
          <Stat label="Blocs à poser (total)" value={fmt(result.blocks.reduce((s, b) => s + b.missing, 0))} />
          <Stat label="Ressources brutes manquantes" value={missingRaw} tone={missingRaw ? 'warn' : 'ok'} />
        </div>
        {result.cycles.length > 0 && <div className="warnings">⚠ Recettes circulaires coupées pour : {result.cycles.map(name).join(', ')}</div>}
      </Section>

      <div className="grid-2">
        <Section title="Blocs à poser">
          <Lines lines={result.blocks} setStock={setStock} stock={project.stock} showOrigins />
        </Section>
        <Section title="Ressources brutes">
          <Lines lines={result.raw} setStock={setStock} stock={project.stock} />
        </Section>
      </div>
      <Section title="Fabrications intermédiaires">
        <Lines lines={result.intermediates} setStock={setStock} stock={project.stock} showRecipe />
        {result.leftovers.length > 0 && (
          <p className="muted small">
            Surplus des crafts entiers : {result.leftovers.map((l) => `${fmt(l.count)} × ${name(l.id)}`).join(', ')}
          </p>
        )}
      </Section>
      <StockEditor />
    </div>
  );
}

function Lines({
  lines,
  stock,
  setStock,
  showOrigins,
  showRecipe,
}: {
  lines: MaterialLine[];
  stock: Record<Id, number>;
  setStock: (id: Id, v: number) => void;
  showOrigins?: boolean;
  showRecipe?: boolean;
}) {
  if (!lines.length) return <p className="muted">Rien pour l'instant.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Objet</th>
            <th>Nécessaire</th>
            <th>En stock</th>
            <th>À obtenir</th>
            {showOrigins && <th>Origine</th>}
            {showRecipe && <th>Recette</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className={l.missing <= 0 ? 'done' : ''}>
              <td>
                <ItemName id={l.id} />
              </td>
              <td className="num">{fmt(l.needed)}</td>
              <td>
                <NumberField value={stock[l.id] ?? 0} min={0} step={1} onChange={(v) => setStock(l.id, v)} label="En stock" width={70} />
              </td>
              <td className="num">
                <strong>{fmt(Math.ceil(l.missing - 1e-9))}</strong>
                {l.kind === 'fluid' ? ' mB' : ''}
              </td>
              {showOrigins && <td className="small muted">{l.origins?.map((o) => ORIGIN_FR[o]).join(', ')}</td>}
              {showRecipe && (
                <td>
                  <MaterialRecipeSelect id={l.id} current={l.recipe} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MaterialRecipeSelect({ id, current }: { id: Id; current?: Id }) {
  const { ds, project, update } = useApp();
  const text = useRecipeText('hand');
  const options = recipeOptions(ds, id);
  return (
    <select
      className="recipe-select"
      value={project.materialChoice[id] ?? current ?? RAW}
      onChange={(e) => update((p) => ({ ...p, materialChoice: { ...p.materialChoice, [id]: e.target.value } }))}
      aria-label="Recette"
    >
      <option value={RAW}>Ressource brute (ne pas fabriquer)</option>
      {options.map((r) => (
        <option key={r.id} value={r.id}>
          {text(r)}
        </option>
      ))}
    </select>
  );
}

function StockEditor() {
  const { project, update } = useApp();
  const [item, setItem] = useState<Id | null>(null);
  const [n, setN] = useState(64);
  const entries = Object.entries(project.stock).sort((a, b) => a[0].localeCompare(b[0]));
  return (
    <Section
      title="Stock existant"
      actions={
        entries.length > 0 && (
          <button className="ghost" onClick={() => confirm('Vider tout le stock saisi ?') && update((p) => ({ ...p, stock: {} }))}>
            Vider
          </button>
        )
      }
    >
      <div className="row wrap">
        <div style={{ minWidth: 280 }}>
          <ItemPicker value={item} onChange={setItem} />
        </div>
        <NumberField value={n} min={1} step={1} onChange={setN} label="Quantité" />
        <button disabled={!item} onClick={() => item && update((p) => ({ ...p, stock: { ...p.stock, [item]: (p.stock[item] ?? 0) + n } }))}>
          Ajouter au stock
        </button>
      </div>
      {entries.length > 0 && (
        <ul className="stock-list">
          {entries.map(([id, v]) => (
            <li key={id}>
              <ItemName id={id} /> × {fmt(v)}
              <button
                className="ghost"
                onClick={() =>
                  update((p) => {
                    const stock = { ...p.stock };
                    delete stock[id];
                    return { ...p, stock };
                  })
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
