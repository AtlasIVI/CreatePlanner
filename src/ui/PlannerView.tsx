import { useMemo, useState, type ReactNode } from 'react';
import { plan, RAW, type PlanNode, type PlanResult, type Step } from '../core/calculator';
import { sourceOutput, suggestSources } from '../core/machines';
import { newId, rateToPerSecond, type PlannerState, type RateUnit } from '../core/project';
import { itemName } from '../core/registry';
import { ItemName, ItemPicker, NumberField, Section, Stat, Unverified, nameOf } from './components';
import { useApp } from './context';
import { fmt, fmtSU, rates } from './format';
import { useRecipeText } from './recipes';

export function usePlan(): PlanResult | null {
  const { ds, project } = useApp();
  const p = project.planner;
  return useMemo(() => {
    if (!p.target || !ds.items.has(p.target)) return null;
    return plan(ds, {
      target: p.target,
      rate: rateToPerSecond(p.rate, p.rateUnit),
      rpm: p.rpm,
      recipeChoice: p.recipeChoice,
      machineChoice: p.machineChoice,
      tagChoice: p.tagChoice,
      rpmOverride: p.rpmOverride,
      batch: p.batch,
    });
  }, [ds, p]);
}

export function useSourceCapacity() {
  const { ds, project } = useApp();
  return useMemo(() => {
    let capacity = 0;
    const rows = project.sources.map((s) => {
      const def = ds.sources.find((d) => d.id === s.sourceId);
      const out = def ? sourceOutput(def, s.params) : undefined;
      if (out) capacity += out.capacity * s.count;
      return { s, def, out };
    });
    return { capacity, rows };
  }, [ds, project.sources]);
}

export function PlannerView() {
  const { project, update } = useApp();
  const p = project.planner;
  const result = usePlan();
  const setP = (patch: Partial<PlannerState>) => update((pr) => ({ ...pr, planner: { ...pr.planner, ...patch } }));
  const { capacity } = useSourceCapacity();

  return (
    <div className="view">
      <Section title="Objectif de production">
        <div className="row wrap">
          <label className="field grow">
            <span>Objet cible</span>
            <ItemPicker value={p.target} onChange={(target) => setP({ target })} />
          </label>
          <label className="field">
            <span>Débit</span>
            <div className="row">
              <NumberField value={p.rate} min={0} onChange={(rate) => setP({ rate })} label="Débit" />
              <select value={p.rateUnit} onChange={(e) => setP({ rateUnit: e.target.value as RateUnit })} aria-label="Unité">
                <option value="s">/ s</option>
                <option value="min">/ min</option>
                <option value="h">/ h</option>
              </select>
            </div>
          </label>
          <label className="field">
            <span>Vitesse par défaut (tr/min)</span>
            <NumberField value={p.rpm} min={1} max={256} step={1} onChange={(rpm) => setP({ rpm })} label="RPM" />
          </label>
          <button
            className="ghost"
            onClick={() => setP({ recipeChoice: {}, machineChoice: {}, tagChoice: {}, rpmOverride: {}, batch: {} })}
            title="Revenir aux recettes et machines par défaut"
          >
            Réinitialiser les choix
          </button>
        </div>
      </Section>

      {!result && <p className="empty">Choisissez un objet cible pour calculer la chaîne de production.</p>}
      {result && (
        <>
          <Summary result={result} capacity={capacity} />
          <Warnings result={result} />
          <Section title="Arbre de production">
            <Tree node={result.root} steps={result.steps} depth={0} />
          </Section>
          <StepsTable result={result} />
          <FlowTables result={result} />
          <SourcesPanel load={result.totalStress} />
        </>
      )}
    </div>
  );
}

function Summary({ result, capacity }: { result: PlanResult; capacity: number }) {
  const machines = result.steps.reduce(
    (s, x) => s + (x.subSteps ? x.subSteps.reduce((a, b) => a + (Number.isFinite(b.machines) ? b.machines : 0), 0) : Number.isFinite(x.machines) ? x.machines : 0),
    0,
  );
  const over = capacity > 0 && result.totalStress > capacity;
  return (
    <div className="stats">
      <Stat label="Étapes" value={result.steps.length} />
      <Stat label="Machines" value={machines} />
      <Stat label="Stress total" value={fmtSU(result.totalStress)} />
      <Stat
        label="Capacité des sources"
        value={capacity ? fmtSU(capacity) : '—'}
        tone={capacity ? (over ? 'bad' : 'ok') : undefined}
      />
      <Stat label="Marge" value={capacity ? fmtSU(capacity - result.totalStress) : '—'} tone={capacity ? (over ? 'bad' : 'ok') : undefined} />
    </div>
  );
}

function Warnings({ result }: { result: PlanResult }) {
  if (!result.warnings.length) return null;
  const text = (w: string) => {
    const [k, v] = w.split(/:(.*)/s);
    if (k === 'unmodelled') return `Type de recette sans machine modélisée : ${v}`;
    if (k === 'min-rpm') return `Vitesse sous le minimum de la machine pour ${v}`;
    if (k === 'empty-tag') return `Tag sans objet : #${v}`;
    if (k === 'depth') return 'Arbre tronqué (profondeur maximale atteinte)';
    return w;
  };
  return (
    <div className="warnings" role="status">
      {result.warnings.map((w) => (
        <div key={w}>⚠ {text(w)}</div>
      ))}
    </div>
  );
}

function RecipeSelect({ node }: { node: PlanNode }) {
  const { update, project } = useApp();
  const text = useRecipeText();
  const choice = project.planner.recipeChoice[node.item];
  const value = node.recipe ? node.recipe.id : RAW;
  return (
    <select
      className="recipe-select"
      value={choice ?? value}
      onChange={(e) =>
        update((p) => ({ ...p, planner: { ...p.planner, recipeChoice: { ...p.planner.recipeChoice, [node.item]: e.target.value } } }))
      }
      aria-label="Recette"
    >
      <option value={RAW}>Matière première (non fabriquée)</option>
      {node.options.map((r) => (
        <option key={r.id} value={r.id}>
          {text(r)}
        </option>
      ))}
    </select>
  );
}

function Tree({ node, steps, depth }: { node: PlanNode; steps: Step[]; depth: number }) {
  const [open, setOpen] = useState(depth < 3);
  const { lang } = useApp();
  const step = node.recipe ? steps.find((s) => s.recipe.id === node.recipe!.id) : undefined;
  const [s, m, h] = rates(node.rate, node.kind === 'fluid');
  const share = step && step.executions > 0 ? node.executions / step.executions : 0;
  return (
    <div className="tree-node">
      <div className="tree-row">
        {node.children.length > 0 ? (
          <button className="twisty" onClick={() => setOpen(!open)} aria-label={open ? 'Replier' : 'Déplier'}>
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="twisty" />
        )}
        <ItemName id={node.item} />
        {node.viaTag && <code className="muted">#{node.viaTag}</code>}
        <span className="rate" title={`${m} · ${h}`}>
          {s} · {m} · {h}
        </span>
        {node.options.length > 0 ? <RecipeSelect node={node} /> : <span className="tag raw">matière première</span>}
        {node.rawReason === 'cycle' && <span className="tag warn">cycle</span>}
        {step?.machine && (
          <span className="tag">
            {fmt(step.machinesExact * share)} × {nameOf(step.machine.names, lang)}
          </span>
        )}
      </div>
      {open && node.children.length > 0 && (
        <div className="tree-children">
          {node.children.map((c, i) => (
            <Tree key={`${c.item}-${i}`} node={c} steps={steps} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function StepsTable({ result }: { result: PlanResult }) {
  const { lang, update, project } = useApp();
  const text = useRecipeText();
  const setMachine = (key: string, id: string) =>
    update((p) => ({ ...p, planner: { ...p.planner, machineChoice: { ...p.planner.machineChoice, [key]: id } } }));
  const setRpm = (key: string, v: number) =>
    update((p) => ({ ...p, planner: { ...p.planner, rpmOverride: { ...p.planner.rpmOverride, [key]: v } } }));
  const setBatch = (key: string, v: number) => update((p) => ({ ...p, planner: { ...p.planner, batch: { ...p.planner.batch, [key]: v } } }));

  const loadCells = (key: string, l: Step | NonNullable<Step['subSteps']>[number]) => (
    <>
      <td>
        {l.machineOptions.length > 1 ? (
          <select value={l.machine?.id} onChange={(e) => setMachine(key, e.target.value)} aria-label="Machine">
            {l.machineOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {nameOf(m.names, lang)}
              </option>
            ))}
          </select>
        ) : l.machine ? (
          nameOf(l.machine.names, lang)
        ) : (
          <span className="tag warn">non modélisé</span>
        )}
        {l.unverified && <Unverified source={l.machine?.speed.source} note={l.machine?.speed.note} />}
      </td>
      <td>
        {l.machine?.kinetic ? (
          <NumberField value={project.planner.rpmOverride[key] ?? l.rpm} min={1} max={256} step={1} onChange={(v) => setRpm(key, v)} label="RPM" width={64} />
        ) : (
          '—'
        )}
        {l.belowMinRpm && <span className="tag bad">min {l.machine?.minRpm?.value}</span>}
      </td>
      <td>
        {l.machine?.speed.executionsPerOperation === 'batch' ? (
          <NumberField value={l.batch} min={1} max={64} step={1} onChange={(v) => setBatch(key, v)} label="Lot" width={56} />
        ) : (
          '—'
        )}
      </td>
      <td className="num">{Number.isFinite(l.ticksPerOperation) ? `${fmt(l.ticksPerOperation)} t` : '—'}</td>
      <td className="num">{fmt(l.perMachine)}/s</td>
      <td className="num">
        <strong>{Number.isFinite(l.machines) ? l.machines : '∞'}</strong> <span className="muted">({fmt(l.machinesExact)})</span>
      </td>
      <td className="num">{fmtSU(l.stress)}</td>
    </>
  );

  return (
    <Section title="Étapes et machines">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Recette</th>
              <th>Sorties</th>
              <th>Machine</th>
              <th>tr/min</th>
              <th>Lot</th>
              <th>Cycle</th>
              <th>Débit / machine</th>
              <th>Machines</th>
              <th>Stress</th>
            </tr>
          </thead>
          <tbody>
            {result.steps.map((s) => (
              <StepRows key={s.recipe.id} s={s} text={text(s.recipe)} loadCells={loadCells} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Cycle en ticks (20 t = 1 s). Les temps de transfert (tapis, entonnoirs) ne sont pas inclus. Survolez « non vérifié » pour la
        source.
      </p>
    </Section>
  );
}

function StepRows({
  s,
  text,
  loadCells,
}: {
  s: Step;
  text: string;
  loadCells: (key: string, l: Step | NonNullable<Step['subSteps']>[number]) => ReactNode;
}) {
  const { ds, lang } = useApp();
  return (
    <>
      <tr>
        <td className="recipe-cell" title={s.recipe.id}>
          {text}
          {s.heat && <span className="tag heat">{s.heat === 'heated' ? 'chauffé' : 'surchauffé'}</span>}
        </td>
        <td>
          {s.outputs.map((o) => (
            <div key={o.id} className="small">
              {itemName(ds, o.id, lang)} : {rates(o.rate, o.kind === 'fluid').join(' · ')}
            </div>
          ))}
        </td>
        {s.subSteps ? (
          <td colSpan={7} className="muted">
            Ligne séquencée : {s.recipe.loops} boucle(s), {s.subSteps.length} étape(s) — {fmtSU(s.stress)}
          </td>
        ) : (
          loadCells(s.recipe.id, s)
        )}
      </tr>
      {s.subSteps?.map((sub) => (
        <tr key={sub.index} className="sub-row">
          <td colSpan={2}>
            ↳ étape {sub.index + 1} : {sub.type}
          </td>
          {loadCells(`${s.recipe.id}#${sub.index}`, sub)}
        </tr>
      ))}
    </>
  );
}

function FlowTables({ result }: { result: PlanResult }) {
  const rows = (list: PlanResult['raw']) =>
    list
      .slice()
      .sort((a, b) => b.rate - a.rate)
      .map((f) => {
        const [s, m, h] = rates(f.rate, f.kind === 'fluid');
        return (
          <tr key={f.id}>
            <td>
              <ItemName id={f.id} />
            </td>
            <td className="num">{s}</td>
            <td className="num">{m}</td>
            <td className="num">{h}</td>
          </tr>
        );
      });
  const head = (
    <thead>
      <tr>
        <th>Objet</th>
        <th>/ s</th>
        <th>/ min</th>
        <th>/ h</th>
      </tr>
    </thead>
  );
  return (
    <div className="grid-2">
      <Section title="Matières premières">
        <table>
          {head}
          <tbody>{rows(result.raw)}</tbody>
        </table>
      </Section>
      <Section title="Sous-produits (avec probabilités)">
        {result.byproducts.length ? (
          <table>
            {head}
            <tbody>{rows(result.byproducts)}</tbody>
          </table>
        ) : (
          <p className="muted">Aucun</p>
        )}
      </Section>
    </div>
  );
}

function SourcesPanel({ load }: { load: number }) {
  const { ds, lang, update } = useApp();
  const { capacity, rows } = useSourceCapacity();
  const [pick, setPick] = useState(ds.sources[0]?.id ?? '');
  const suggestions = useMemo(() => suggestSources(ds.sources, Math.max(0, load - capacity)), [ds.sources, load, capacity]);
  const setSource = (id: string, patch: Partial<{ count: number; params: Record<string, number> }>) =>
    update((p) => ({ ...p, sources: p.sources.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  return (
    <Section title="Sources cinétiques">
      <table>
        <thead>
          <tr>
            <th>Source</th>
            <th>Nombre</th>
            <th>Paramètres</th>
            <th>tr/min</th>
            <th>Capacité</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ s, def, out }) => (
            <tr key={s.id}>
              <td>
                {def ? nameOf(def.names, lang) : s.sourceId}
                {def && !def.verified && <Unverified source={def.source} note={def.note} />}
              </td>
              <td>
                <NumberField value={s.count} min={0} step={1} onChange={(count) => setSource(s.id, { count })} label="Nombre" width={60} />
              </td>
              <td>
                {def?.params?.map((prm) => (
                  <label key={prm.name} className="inline">
                    {nameOf(prm.label, lang)}{' '}
                    <NumberField
                      value={s.params[prm.name] ?? prm.default}
                      min={prm.min}
                      max={prm.max}
                      step={prm.step}
                      onChange={(v) => setSource(s.id, { params: { ...s.params, [prm.name]: v } })}
                      width={60}
                    />
                  </label>
                ))}
              </td>
              <td className="num">{out ? fmt(out.rpm) : '—'}</td>
              <td className="num">{out ? fmtSU(out.capacity * s.count) : '—'}</td>
              <td>
                <button className="ghost" onClick={() => update((p) => ({ ...p, sources: p.sources.filter((x) => x.id !== s.id) }))}>
                  Retirer
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Type de source">
          {ds.sources.map((s) => (
            <option key={s.id} value={s.id}>
              {nameOf(s.names, lang)}
            </option>
          ))}
        </select>
        <button onClick={() => update((p) => ({ ...p, sources: [...p.sources, { id: newId('s'), sourceId: pick, count: 1, params: {} }] }))}>
          Ajouter une source
        </button>
        <span className={capacity >= load ? 'ok' : 'bad'}>
          Charge {fmtSU(load)} / capacité {fmtSU(capacity)}
        </span>
      </div>
      {suggestions.length > 0 && (
        <div className="suggestions">
          <strong>Pour couvrir les {fmtSU(load - capacity)} manquants :</strong>
          <ul>
            {suggestions.map((sg) => (
              <li key={sg.source.id}>
                {sg.count} × {nameOf(sg.source.names, lang)} ({fmt(sg.output.rpm)} tr/min, {fmtSU(sg.output.capacity)} chacun)
                {!sg.source.verified && <Unverified source={sg.source.source} />}
              </li>
            ))}
          </ul>
          <p className="muted small">La capacité totale en SU ne change pas avec les engrenages ; seule la vitesse change.</p>
        </div>
      )}
    </Section>
  );
}
