import { useEffect, useMemo, useState } from 'react';
import { analyzeGrid, axisOf, cellKey, FACINGS, kineticSpec, palette, parseKey, rotateFacing, type GridAnalysis } from '../core/grid';
import type { Facing, GridState, PlacedBlock } from '../core/project';
import { itemName } from '../core/registry';
import type { Id } from '../core/types';
import { ItemIcon, NumberField, Section, Stat, Unverified, nameOf } from './components';
import { useApp } from './context';
import { fmt, fmtSU, rates } from './format';
import { usePlan } from './PlannerView';

type Tool = 'place' | 'rotate' | 'delete' | 'inspect';

const TOOL_FR: Record<Tool, string> = { place: 'Placer', rotate: 'Tourner', delete: 'Supprimer', inspect: 'Inspecter' };
const FACING_FR: Record<Facing, string> = { '+x': 'Est →', '-x': 'Ouest ←', '+z': 'Sud ↓', '-z': 'Nord ↑', '+y': 'Haut ⊙', '-y': 'Bas ⊗' };
const ARROW: Record<Facing, string> = { '+x': '→', '-x': '←', '+z': '↓', '-z': '↑', '+y': '⊙', '-y': '⊗' };
const CATEGORY_FR = { kinetic: 'Transmission', machine: 'Machines', source: 'Sources', logistics: 'Logistique', other: 'Autres' };

const netColor = (id: number) => `hsl(${(id * 83 + 30) % 360} 45% 32%)`;

export function GridView() {
  const { ds, project, update, lang } = useApp();
  const grid = project.grid;
  const items = useMemo(() => palette(ds), [ds]);
  const [block, setBlock] = useState<Id>(items[0]?.id ?? 'create:shaft');
  const [facing, setFacing] = useState<Facing>('+x');
  const [tool, setTool] = useState<Tool>('place');
  const [selected, setSelected] = useState<string | null>(null);
  const analysis = useMemo(() => analyzeGrid(ds, grid), [ds, grid]);

  const setGrid = (fn: (g: GridState) => GridState) => update((p) => ({ ...p, grid: fn(p.grid) }));
  const setCell = (k: string, v: PlacedBlock | null) =>
    setGrid((g) => {
      const cells = { ...g.cells };
      if (v) cells[k] = v;
      else delete cells[k];
      return { ...g, cells };
    });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      if (e.key === 'r' || e.key === 'R') setFacing((f) => rotateFacing(f));
      if (e.key === 'Delete' && selected) setCell(selected, null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const click = (x: number, z: number) => {
    const k = cellKey(x, grid.layer, z);
    const cur = grid.cells[k];
    setSelected(k);
    if (tool === 'place') {
      const spec = kineticSpec(ds, block);
      const f = spec?.fixedAxis ? rotateFacing(facing, spec) : facing;
      setCell(k, { block, facing: f });
    } else if (tool === 'rotate' && cur) {
      setCell(k, { ...cur, facing: rotateFacing(cur.facing, kineticSpec(ds, cur.block)) });
    } else if (tool === 'delete') {
      setCell(k, null);
    }
  };

  const groups = (['kinetic', 'machine', 'source', 'logistics', 'other'] as const).map((c) => ({
    c,
    list: items.filter((i) => i.category === c),
  }));
  const blocksHere = Object.keys(grid.cells).filter((k) => parseKey(k)[1] === grid.layer).length;

  return (
    <div className="view">
      <Section title="Grille de placement (vue de dessus)">
        <div className="grid-layout">
          <aside className="palette">
            <div className="tools" role="radiogroup" aria-label="Outil">
              {(Object.keys(TOOL_FR) as Tool[]).map((t) => (
                <button key={t} className={tool === t ? 'active' : 'ghost'} onClick={() => setTool(t)} role="radio" aria-checked={tool === t}>
                  {TOOL_FR[t]}
                </button>
              ))}
            </div>
            <label className="field">
              <span>Orientation (touche R)</span>
              <select value={facing} onChange={(e) => setFacing(e.target.value as Facing)}>
                {FACINGS.map((f) => (
                  <option key={f} value={f}>
                    {FACING_FR[f]}
                  </option>
                ))}
              </select>
            </label>
            {groups.map(
              (g) =>
                g.list.length > 0 && (
                  <div key={g.c}>
                    <div className="palette-title">{CATEGORY_FR[g.c]}</div>
                    {g.list.map((i) => (
                      <button
                        key={i.id}
                        className={`palette-item ${block === i.id ? 'active' : 'ghost'}`}
                        onClick={() => {
                          setBlock(i.id);
                          setTool('place');
                        }}
                        title={i.id}
                      >
                        <ItemIcon id={i.id} size={16} /> {itemName(ds, i.id, lang)}
                      </button>
                    ))}
                  </div>
                ),
            )}
          </aside>
          <div className="board-wrap">
            <div className="row wrap">
              <label className="field">
                <span>Couche Y : {grid.layer}</span>
                <input
                  type="range"
                  min={-16}
                  max={32}
                  value={grid.layer}
                  onChange={(e) => setGrid((g) => ({ ...g, layer: Number(e.target.value) }))}
                  aria-label="Couche Y"
                />
              </label>
              <label className="field">
                <span>Largeur</span>
                <NumberField value={grid.width} min={4} max={64} step={1} onChange={(v) => setGrid((g) => ({ ...g, width: v }))} width={60} />
              </label>
              <label className="field">
                <span>Profondeur</span>
                <NumberField value={grid.depth} min={4} max={64} step={1} onChange={(v) => setGrid((g) => ({ ...g, depth: v }))} width={60} />
              </label>
              <button
                className="ghost"
                disabled={!blocksHere}
                onClick={() =>
                  confirm(`Effacer les ${blocksHere} blocs de la couche ${grid.layer} ?`) &&
                  setGrid((g) => ({ ...g, cells: Object.fromEntries(Object.entries(g.cells).filter(([k]) => parseKey(k)[1] !== g.layer)) }))
                }
              >
                Effacer la couche
              </button>
            </div>
            <Board grid={grid} analysis={analysis} selected={selected} onClick={click} />
            <p className="muted small">
              Nord en haut. ⊙ / ⊗ : axe vertical (vers le haut / le bas). Les arbres verticaux relient les couches. Couleur de fond = réseau
              cinétique ; le chiffre indique les tr/min.
            </p>
          </div>
          <Inspector k={selected} analysis={analysis} setCell={setCell} />
        </div>
      </Section>
      <NetworksPanel analysis={analysis} />
      <ProductionPanel analysis={analysis} />
    </div>
  );
}

function Board({ grid, analysis, selected, onClick }: { grid: GridState; analysis: GridAnalysis; selected: string | null; onClick: (x: number, z: number) => void }) {
  const { ds, lang } = useApp();
  const cells = [];
  for (let z = 0; z < grid.depth; z++) {
    for (let x = 0; x < grid.width; x++) {
      const k = cellKey(x, grid.layer, z);
      const c = grid.cells[k];
      const below = !c ? grid.cells[cellKey(x, grid.layer - 1, z)] : undefined;
      const net = analysis.networkOf.get(k);
      const speed = analysis.speed.get(k);
      const conflict = net !== undefined && analysis.networks[net].conflicts.some((cf) => cf.at === k);
      const over = net !== undefined && analysis.networks[net].overstressed;
      cells.push(
        <button
          key={k}
          className={`cell ${selected === k ? 'sel' : ''} ${conflict ? 'conflict' : ''} ${over ? 'over' : ''}`}
          style={net !== undefined ? { background: netColor(net) } : undefined}
          onClick={() => onClick(x, z)}
          title={c ? `${itemName(ds, c.block, lang)} (${x}, ${grid.layer}, ${z}) ${FACING_FR[c.facing]}${speed ? ` — ${fmt(speed)} tr/min` : ''}` : `(${x}, ${grid.layer}, ${z})`}
          aria-label={c ? itemName(ds, c.block, lang) : `case ${x},${z}`}
        >
          {c && (
            <>
              <ItemIcon id={c.block} size={18} />
              <span className="arrow">{kineticSpec(ds, c.block)?.shape === 'shaft' ? { x: '━', y: '●', z: '┃' }[axisOf(c.facing)] : ARROW[c.facing]}</span>
              {speed ? <span className="rpm">{fmt(Math.abs(speed))}</span> : null}
            </>
          )}
          {below && (
            <span className="ghost-below">
              <ItemIcon id={below.block} size={12} />
            </span>
          )}
        </button>,
      );
    }
  }
  return (
    <div className="board" style={{ gridTemplateColumns: `repeat(${grid.width}, 34px)` }}>
      {cells}
    </div>
  );
}

function Inspector({ k, analysis, setCell }: { k: string | null; analysis: GridAnalysis; setCell: (k: string, v: PlacedBlock | null) => void }) {
  const { ds, project, lang } = useApp();
  const c = k ? project.grid.cells[k] : undefined;
  if (!k || !c) return <aside className="inspector muted small">Sélectionnez une case (outil « Inspecter » ou après un placement).</aside>;
  const spec = kineticSpec(ds, c.block);
  const net = analysis.networkOf.get(k);
  const speed = analysis.speed.get(k) ?? 0;
  const m = analysis.machines.find((x) => x.key === k);
  // Several machine definitions can share a block (press on a depot or on a basin, fan catalysts).
  const types = new Set(ds.machines.filter((x) => x.gridBlock === c.block).flatMap((x) => x.recipeTypes));
  const recipes = spec?.machine ? ds.recipes.filter((r) => types.has(r.type)) : [];
  return (
    <aside className="inspector">
      <div className="row">
        <ItemIcon id={c.block} size={24} />
        <strong>{itemName(ds, c.block, lang)}</strong>
      </div>
      <div className="small muted">
        ({k.replace(/,/g, ', ')}) · {FACING_FR[c.facing]}
      </div>
      <div>
        Vitesse : <strong>{fmt(speed)} tr/min</strong> {net !== undefined && <span className="muted">réseau #{net + 1}</span>}
      </div>
      {spec && spec.impact > 0 && (
        <div>
          Stress : {fmtSU(spec.impact * Math.abs(speed))} <span className="muted">({spec.impact} SU/tr/min)</span>
        </div>
      )}
      <label className="field">
        <span>Orientation</span>
        <select value={c.facing} onChange={(e) => setCell(k, { ...c, facing: e.target.value as Facing })} disabled={!!spec?.fixedAxis}>
          {FACINGS.map((f) => (
            <option key={f} value={f}>
              {FACING_FR[f]}
            </option>
          ))}
        </select>
      </label>
      {spec?.source && (
        <>
          {spec.source.params?.map((p) => (
            <label key={p.name} className="field">
              <span>{nameOf(p.label, lang)}</span>
              <NumberField
                value={c.params?.[p.name] ?? p.default}
                min={p.min}
                max={p.max}
                step={p.step}
                onChange={(v) => setCell(k, { ...c, params: { ...c.params, [p.name]: v } })}
              />
            </label>
          ))}
          <label className="inline">
            <input type="checkbox" checked={!!c.reversed} onChange={() => setCell(k, { ...c, reversed: !c.reversed })} /> Sens inversé
          </label>
          {!spec.source.verified && <Unverified source={spec.source.source} />}
        </>
      )}
      {spec?.machine && (
        <>
          <label className="field">
            <span>Recette traitée</span>
            <select value={c.recipe ?? ''} onChange={(e) => setCell(k, { ...c, recipe: e.target.value || undefined })}>
              <option value="">(aucune)</option>
              {recipes.slice(0, 300).map((r) => (
                <option key={r.id} value={r.id}>
                  {itemName(ds, r.outputs[0]?.id ?? r.id, lang)} — {r.id}
                </option>
              ))}
            </select>
          </label>
          {m && (
            <div className="small">
              {m.perSecond > 0 ? `${rates(m.perSecond).join(' · ')} (exécutions)` : 'À l’arrêt (pas de rotation, surcharge ou conflit)'}
            </div>
          )}
        </>
      )}
      <button className="ghost" onClick={() => setCell(k, null)}>
        Supprimer le bloc
      </button>
    </aside>
  );
}

const CONFLICT_FR = {
  direction: 'sens de rotation opposés',
  speed: 'vitesses incompatibles',
  sources: 'sources en désaccord',
  overspeed: 'vitesse > limite',
};

function NetworksPanel({ analysis }: { analysis: GridAnalysis }) {
  const { ds, project, lang } = useApp();
  const active = analysis.networks.filter((n) => n.keys.length > 0);
  const over = active.filter((n) => n.overstressed).length;
  const conflicts = active.reduce((s, n) => s + n.conflicts.length, 0);
  return (
    <Section title="Réseaux cinétiques">
      <div className="stats">
        <Stat label="Réseaux" value={active.length} />
        <Stat label="Surchargés" value={over} tone={over ? 'bad' : 'ok'} />
        <Stat label="Conflits" value={conflicts} tone={conflicts ? 'bad' : 'ok'} />
      </div>
      {active.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Blocs</th>
                <th>Sources</th>
                <th>tr/min</th>
                <th>Charge</th>
                <th>Capacité</th>
                <th>État</th>
              </tr>
            </thead>
            <tbody>
              {active.map((n) => (
                <tr key={n.id} className={n.overstressed || n.conflicts.length ? 'hl' : ''}>
                  <td>
                    <span className="swatch" style={{ background: netColor(n.id) }} /> {n.id + 1}
                  </td>
                  <td className="num">{n.keys.length}</td>
                  <td>{n.sources.map((k) => itemName(ds, project.grid.cells[k].block, lang)).join(', ') || <span className="muted">aucune</span>}</td>
                  <td>{n.rpms.map((r) => fmt(r)).join(' / ')}</td>
                  <td className="num">{fmtSU(n.load)}</td>
                  <td className="num">{fmtSU(n.capacity)}</td>
                  <td>
                    {n.overstressed && <span className="tag bad">surcharge</span>}
                    {n.conflicts.map((c, i) => (
                      <span key={i} className="tag bad" title={`attendu ${fmt(c.expected)}, trouvé ${fmt(c.got)}`}>
                        {CONFLICT_FR[c.kind]} ({c.at})
                      </span>
                    ))}
                    {!n.overstressed && !n.conflicts.length && (n.sources.length ? <span className="tag">ok</span> : <span className="tag">non entraîné</span>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function ProductionPanel({ analysis }: { analysis: GridAnalysis }) {
  const { ds, lang } = useApp();
  const plan = usePlan();
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; machineId: Id; recipe?: Id; count: number; rpms: Set<number>; perSecond: number; stress: number; units: number }>();
    for (const m of analysis.machines) {
      const k = `${m.machine.id}|${m.recipe?.id ?? ''}`;
      const units = m.machine.unitsPerMachine ? Math.max(1, Number(m.machine.unitsPerMachine) || 1) : 1;
      const g = map.get(k) ?? { name: nameOf(m.machine.names, lang), machineId: m.machine.id, recipe: m.recipe?.id, count: 0, rpms: new Set(), perSecond: 0, stress: 0, units };
      g.count += 1;
      g.rpms.add(m.rpm);
      g.perSecond += m.perSecond;
      g.stress += m.stress;
      map.set(k, g);
    }
    return [...map.values()];
  }, [analysis, lang]);
  if (!groups.length) return null;
  return (
    <Section title="Machines placées et production">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Machine</th>
              <th>Recette</th>
              <th>Nombre</th>
              <th>tr/min</th>
              <th>Stress</th>
              <th>Production</th>
              <th>Plan de production</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const r = g.recipe ? ds.recipeById.get(g.recipe) : undefined;
              const out = r?.outputs[0];
              const step = plan?.steps.find((s) => s.machine?.id === g.machineId && (!g.recipe || s.recipe.id === g.recipe));
              return (
                <tr key={`${g.machineId}|${g.recipe}`}>
                  <td>{g.name}</td>
                  <td>{out ? itemName(ds, out.id, lang) : <span className="muted">non définie</span>}</td>
                  <td className="num">{fmt(g.count / g.units)}</td>
                  <td>{[...g.rpms].map((x) => fmt(x)).join(' / ')}</td>
                  <td className="num">{fmtSU(g.stress)}</td>
                  <td>{out ? rates(g.perSecond * out.amount * out.chance, out.kind === 'fluid').join(' · ') : `${fmt(g.perSecond)} exéc./s`}</td>
                  <td className="small">
                    {step ? (
                      <>
                        {step.machines} × à {fmt(step.rpm)} tr/min, {fmtSU(step.stress)}{' '}
                        {Math.abs(step.stress - g.stress) < 1e-6 && step.machines === g.count / g.units ? (
                          <span className="tag">identique</span>
                        ) : (
                          <span className="tag warn">différent</span>
                        )}
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Choisissez la recette d'une machine dans l'inspecteur pour obtenir son débit. Les blocs placés alimentent la liste de matériaux
        (origine « grille »). La colonne « Plan de production » compare avec l'étape du plan qui utilise la même machine.
      </p>
    </Section>
  );
}
