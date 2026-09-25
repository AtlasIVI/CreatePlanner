import { useMemo } from 'react';
import { outputYield } from '../core/calculator';
import {
  analyzeLogistics,
  constantsFrom,
  gaugeInterval,
  simulateStock,
  type Issue,
  type Limit,
  type LogisticsAnalysis,
  type Simulation,
} from '../core/logistics';
import { newId, type GaugeModule, type LinkKind } from '../core/project';
import { itemName } from '../core/registry';
import { ItemName, ItemPicker, NumberField, Section, Stat, Unverified, nameOf } from './components';
import { useApp } from './context';
import { fmt, rates } from './format';
import { usePlan } from './PlannerView';

const LIMIT_FR: Record<Limit, string> = {
  gauge: 'jauge (1 requête / 5 s)',
  machines: 'machines',
  packager: 'empaqueteur',
  link: 'transport',
  inputs: 'entrées (amont)',
  stock: 'stock cible trop bas',
  none: '—',
};

const ISSUE_FR: Record<Issue, string> = {
  'no-output': 'aucun objet de sortie',
  'no-address': "adresse vide : la jauge n'envoie aucune requête",
  'no-machine-rate': 'débit des machines inconnu',
  'target-below-batch': 'stock cible inférieur à la sortie par requête',
  cycle: 'boucle entre modules',
  'missing-upstream': 'module amont supprimé',
  'upstream-item-mismatch': "l'amont produit un autre objet",
};

const LINK_FR: Record<LinkKind, string> = {
  direct: 'Direct (même réseau)',
  chain: 'Convoyeur à chaîne',
  frogport: 'Ports grenouille',
  belt: 'Tapis roulant',
};

const TIMEOUTS: { v: number | null; label: string }[] = [
  { v: null, label: 'jamais' },
  { v: 30, label: '30 s' },
  ...[1, 2, 5, 10, 15, 20, 30].map((m) => ({ v: m * 60, label: `${m} min` })),
];

function blankModule(n: number): GaugeModule {
  return {
    id: newId('g'),
    name: `Jauge ${n}`,
    mode: 'recipe',
    output: null,
    outputPerRequest: 1,
    targetStock: 64,
    address: 'usine',
    promiseTimeout: null,
    inputs: [],
    machineRate: 1,
    link: { kind: 'direct', rpm: 64, length: 16, frogports: 1 },
    demand: 0,
  };
}

export function LogisticsView() {
  const { ds, project, update, lang } = useApp();
  const plan = usePlan();
  const modules = project.logistics.modules;
  const c = useMemo(() => constantsFrom(ds.logistics), [ds.logistics]);
  const stackSize = useMemo(() => (id: string) => ds.items.get(id)?.stackSize ?? 64, [ds]);
  const analysis = useMemo(() => analyzeLogistics(modules, c, stackSize), [modules, c, stackSize]);
  const sim = useMemo(() => simulateStock(modules, c, project.logistics.horizon, stackSize), [modules, c, project.logistics.horizon, stackSize]);

  const setModules = (fn: (m: GaugeModule[]) => GaugeModule[]) =>
    update((p) => ({ ...p, logistics: { ...p.logistics, modules: fn(p.logistics.modules) } }));
  const patch = (id: string, v: Partial<GaugeModule>) => setModules((ms) => ms.map((m) => (m.id === id ? { ...m, ...v } : m)));

  /** One gauge per plan step, batches sized so the 5 s request interval is not the bottleneck. */
  const fromPlan = () => {
    if (!plan) return;
    const interval = gaugeInterval(c);
    const producer = new Map<string, string>();
    const created: GaugeModule[] = plan.steps.map((s, i) => {
      const out = s.recipe.outputs[0];
      const perExec = outputYield(s.recipe, out.id);
      const rate = s.executions * perExec;
      const batch = Math.max(1, Math.ceil(rate * interval * 1.25));
      const m = blankModule(i + 1);
      m.name = itemName(ds, out.id, lang);
      m.output = out.id;
      m.outputPerRequest = batch;
      m.targetStock = Math.max(batch * 2, 16);
      const capacity = Number.isFinite(s.machines) ? s.machines * s.perMachine * perExec : rate;
      m.machineRate = Math.round(capacity * 1000) / 1000;
      m.demand = i === 0 ? Math.round(rate * 1000) / 1000 : 0;
      producer.set(out.id, m.id);
      return m;
    });
    plan.steps.forEach((s, i) => {
      const out = s.recipe.outputs[0];
      const execPerRequest = created[i].outputPerRequest / outputYield(s.recipe, out.id);
      created[i].inputs = s.inputs.map((inp) => ({
        from: producer.get(inp.id) ?? null,
        item: inp.id,
        amount: Math.max(1, Math.ceil((inp.rate / s.executions) * execPerRequest)),
      }));
    });
    setModules(() => created);
  };

  return (
    <div className="view">
      <Section
        title="Modules de jauges d'usine"
        actions={
          <>
            <button onClick={() => setModules((ms) => [...ms, blankModule(ms.length + 1)])}>Ajouter une jauge</button>
            <button className="ghost" disabled={!plan} onClick={fromPlan} title="Une jauge par étape du plan de production">
              Générer depuis le plan
            </button>
          </>
        }
      >
        <p className="muted small">
          Une jauge (mode recette) envoie au plus une requête toutes les {fmt(gaugeInterval(c))} s ; « sortie par requête » est la quantité promise
          par requête. Jusqu'à {ds.logistics.gaugesPerFace?.value ?? 4} jauges par face de bloc. En mode réapprovisionnement, la jauge est posée
          sur un empaqueteur et commande jusqu'à {c.packageSlots} piles.
        </p>
        {modules.length === 0 && <p className="empty">Aucun module. Ajoutez une jauge ou générez-les depuis le plan.</p>}
        {modules.map((m) => (
          <ModuleEditor key={m.id} m={m} modules={modules} analysis={analysis} patch={patch} remove={() => setModules((ms) => ms.filter((x) => x.id !== m.id))} />
        ))}
      </Section>
      {modules.length > 0 && (
        <>
          <AnalysisTable analysis={analysis} modules={modules} />
          <SimulationPanel sim={sim} modules={modules} />
        </>
      )}
      <Section title="Constantes logistiques">
        <table>
          <tbody>
            {Object.entries(ds.logistics).map(([k, v]) => (
              <tr key={k}>
                <td>{nameOf(v.names, lang)}</td>
                <td className="num">
                  {v.value} {v.unit}
                </td>
                <td>{!v.verified && <Unverified source={v.source} note={v.note} />}</td>
                <td className="small muted">{v.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

function ModuleEditor({
  m,
  modules,
  analysis,
  patch,
  remove,
}: {
  m: GaugeModule;
  modules: GaugeModule[];
  analysis: LogisticsAnalysis;
  patch: (id: string, v: Partial<GaugeModule>) => void;
  remove: () => void;
}) {
  const a = analysis.byId.get(m.id);
  const isBottleneck = analysis.bottleneck === m.id;
  const setInput = (i: number, v: Partial<GaugeModule['inputs'][number]>) =>
    patch(m.id, { inputs: m.inputs.map((x, j) => (j === i ? { ...x, ...v } : x)) });
  return (
    <div className={`module ${isBottleneck ? 'module-bad' : ''}`}>
      <div className="row wrap">
        <label className="field">
          <span>Nom</span>
          <input value={m.name} onChange={(e) => patch(m.id, { name: e.target.value })} />
        </label>
        <label className="field">
          <span>Mode</span>
          <select value={m.mode} onChange={(e) => patch(m.id, { mode: e.target.value as GaugeModule['mode'] })}>
            <option value="recipe">Recette (lien / téléscripteur)</option>
            <option value="restock">Réapprovisionnement (empaqueteur)</option>
          </select>
        </label>
        <label className="field grow">
          <span>Objet produit</span>
          <ItemPicker value={m.output} onChange={(output) => patch(m.id, { output })} />
        </label>
        <label className="field">
          <span>Sortie / requête</span>
          <NumberField value={m.outputPerRequest} min={1} step={1} onChange={(v) => patch(m.id, { outputPerRequest: v })} />
        </label>
        <label className="field">
          <span>Stock cible</span>
          <NumberField value={m.targetStock} min={0} step={1} onChange={(v) => patch(m.id, { targetStock: v })} />
        </label>
        <label className="field">
          <span>Adresse</span>
          <input value={m.address} style={{ width: 110 }} onChange={(e) => patch(m.id, { address: e.target.value })} />
        </label>
        <label className="field">
          <span>Délai de promesse</span>
          <select
            value={m.promiseTimeout === null ? '' : String(m.promiseTimeout)}
            onChange={(e) => patch(m.id, { promiseTimeout: e.target.value === '' ? null : Number(e.target.value) })}
          >
            {TIMEOUTS.map((t) => (
              <option key={t.label} value={t.v === null ? '' : String(t.v)}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <button className="ghost" onClick={remove}>
          Supprimer
        </button>
      </div>
      <div className="row wrap">
        {m.mode === 'recipe' && (
          <label className="field">
            <span>Débit des machines (objets/s)</span>
            <NumberField value={m.machineRate} min={0} onChange={(v) => patch(m.id, { machineRate: v })} />
          </label>
        )}
        <label className="field">
          <span>Demande externe (objets/s)</span>
          <NumberField value={m.demand} min={0} onChange={(v) => patch(m.id, { demand: v })} />
        </label>
        <label className="field">
          <span>Arrivée des colis</span>
          <select value={m.link.kind} onChange={(e) => patch(m.id, { link: { ...m.link, kind: e.target.value as LinkKind } })}>
            {(Object.keys(LINK_FR) as LinkKind[]).map((k) => (
              <option key={k} value={k}>
                {LINK_FR[k]}
              </option>
            ))}
          </select>
        </label>
        {(m.link.kind === 'chain' || m.link.kind === 'belt') && (
          <>
            <label className="field">
              <span>tr/min</span>
              <NumberField value={m.link.rpm} min={1} max={256} step={1} onChange={(v) => patch(m.id, { link: { ...m.link, rpm: v } })} width={64} />
            </label>
            <label className="field">
              <span>Longueur (blocs)</span>
              <NumberField value={m.link.length} min={1} step={1} onChange={(v) => patch(m.id, { link: { ...m.link, length: v } })} width={64} />
            </label>
          </>
        )}
        {m.link.kind === 'frogport' && (
          <label className="field">
            <span>Ports grenouille</span>
            <NumberField value={m.link.frogports} min={1} step={1} onChange={(v) => patch(m.id, { link: { ...m.link, frogports: v } })} width={64} />
          </label>
        )}
      </div>
      <div className="inputs">
        <strong className="small">Entrées par requête</strong>
        {m.inputs.map((inp, i) => (
          <div className="row wrap" key={i}>
            <select value={inp.from ?? ''} onChange={(e) => setInput(i, { from: e.target.value || null })} aria-label="Provenance">
              <option value="">Externe (stock / matière première)</option>
              {modules
                .filter((o) => o.id !== m.id)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    ← {o.name}
                  </option>
                ))}
            </select>
            <div style={{ minWidth: 240 }}>
              <ItemPicker value={inp.item} onChange={(item) => setInput(i, { item })} />
            </div>
            <NumberField value={inp.amount} min={1} step={1} onChange={(v) => setInput(i, { amount: v })} label="Quantité" />
            <button className="ghost" onClick={() => patch(m.id, { inputs: m.inputs.filter((_, j) => j !== i) })}>
              ×
            </button>
          </div>
        ))}
        <button className="ghost" onClick={() => patch(m.id, { inputs: [...m.inputs, { from: null, item: m.output ?? 'minecraft:stone', amount: 1 }] })}>
          + entrée
        </button>
      </div>
      {a && (
        <div className="small module-status">
          {isBottleneck && <span className="tag bad">goulot</span>} Requis {rates(a.required)[1]} · possible {rates(a.achievable)[1]} · limité par{' '}
          <strong>{LIMIT_FR[a.limitedBy]}</strong> · {a.packagesPerRequest} colis/requête · délai ≈ {fmt(a.leadTime)} s
          {a.issues.map((i) => (
            <span key={i} className="tag warn">
              {ISSUE_FR[i]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function AnalysisTable({ analysis, modules }: { analysis: LogisticsAnalysis; modules: GaugeModule[] }) {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const bn = analysis.bottleneck ? byId.get(analysis.bottleneck) : undefined;
  const cap = (v: number) => (Number.isFinite(v) ? fmt(v * 60) : '∞');
  return (
    <Section title="Débits et goulots (objets / min)">
      <div className="stats">
        <Stat label="Goulot principal" value={bn ? bn.name : 'aucun'} tone={bn ? 'bad' : 'ok'} />
        {bn && <Stat label="Cause" value={LIMIT_FR[analysis.byId.get(bn.id)!.limitedBy]} tone="warn" />}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Module</th>
              <th>Sortie</th>
              <th>Requis</th>
              <th>Possible</th>
              <th>Jauge</th>
              <th>Machines</th>
              <th>Empaqueteur</th>
              <th>Transport</th>
              <th>Entrées</th>
              <th>Stock cible</th>
            </tr>
          </thead>
          <tbody>
            {analysis.modules.map((a) => {
              const m = byId.get(a.id)!;
              return (
                <tr key={a.id} className={a.bottleneck ? 'hl' : ''}>
                  <td>{m.name}</td>
                  <td>{m.output ? <ItemName id={m.output} /> : '—'}</td>
                  <td className="num">{fmt(a.required * 60)}</td>
                  <td className="num">
                    <strong className={a.bottleneck ? 'bad' : 'ok'}>{fmt(a.achievable * 60)}</strong>
                  </td>
                  {(['gauge', 'machines', 'packager', 'link', 'inputs', 'stock'] as const).map((k) => (
                    <td key={k} className={`num ${a.limitedBy === k ? 'bad' : ''}`}>
                      {cap(a.caps[k])}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Le transport tient compte de la vitesse des chaînes (|tr/min| / 360 bloc/tick, 20 colis max par convoyeur) ; espacement des colis et cycle
        des ports grenouille <Unverified /> configurables dans data/machines/create.json.
      </p>
    </Section>
  );
}

const VERDICT_FR = { starves: 'pénurie', accumulates: 'accumule (stock plein)', balanced: 'équilibré', idle: 'inactif' };

function SimulationPanel({ sim, modules }: { sim: Simulation; modules: GaugeModule[] }) {
  const { project, update } = useApp();
  const W = 760;
  const H = 220;
  const max = Math.max(1, ...sim.series.flatMap((s) => s.stock));
  const color = (i: number) => `hsl(${(i * 67 + 35) % 360} 65% 60%)`;
  const byId = new Map(modules.map((m) => [m.id, m]));
  return (
    <Section
      title="Stock dans le temps (simulation)"
      actions={
        <label className="inline">
          Durée (s)
          <NumberField
            value={project.logistics.horizon}
            min={60}
            max={7200}
            step={60}
            onChange={(v) => update((p) => ({ ...p, logistics: { ...p.logistics, horizon: v } }))}
          />
        </label>
      }
    >
      <svg viewBox={`0 0 ${W} ${H + 20}`} className="chart" role="img" aria-label="Stock par module dans le temps">
        <line x1={40} y1={H} x2={W} y2={H} stroke="var(--line)" />
        <line x1={40} y1={0} x2={40} y2={H} stroke="var(--line)" />
        <text x={36} y={10} textAnchor="end" fontSize="10" fill="var(--muted)">
          {fmt(max)}
        </text>
        <text x={36} y={H} textAnchor="end" fontSize="10" fill="var(--muted)">
          0
        </text>
        <text x={W} y={H + 14} textAnchor="end" fontSize="10" fill="var(--muted)">
          {sim.seconds} s
        </text>
        {sim.series.map((s, i) => (
          <polyline
            key={s.id}
            fill="none"
            stroke={color(i)}
            strokeWidth={1.5}
            points={s.stock.map((v, t) => `${40 + (t / Math.max(1, s.stock.length - 1)) * (W - 40)},${H - (v / max) * H}`).join(' ')}
          />
        ))}
      </svg>
      <ul className="legend">
        {sim.series.map((s, i) => (
          <li key={s.id}>
            <span className="swatch" style={{ background: color(i) }} /> {byId.get(s.id)?.name} —{' '}
            <span className={s.verdict === 'starves' ? 'bad' : s.verdict === 'balanced' ? 'ok' : 'muted'}>{VERDICT_FR[s.verdict]}</span>
            {byId.get(s.id)!.demand > 0 && (
              <span className="muted">
                {' '}
                · livré {fmt((s.delivered / sim.seconds) * 60)}/min sur {fmt(byId.get(s.id)!.demand * 60)}/min demandés
              </span>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
