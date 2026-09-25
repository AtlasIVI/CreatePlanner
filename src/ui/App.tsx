import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  emptyBoard,
  findDestination,
  gaugeStatus,
  initSim,
  newDestination,
  newGauge,
  normalizeBoard,
  removeGauge,
  sendManual,
  stepSim,
  targetAmount,
  type Board,
  type Destination,
  type Gauge,
  type GaugeStatus,
  type SimState,
} from '../core/gauges';
import type { Id } from '../core/types';
import { dataOrigin, itemName, stackSize } from '../data/items';
import { fmt, fmtTime, ItemIcon, ItemPicker, Num } from './common';

const STORAGE_KEY = 'createplanner:gauges';
const CELL = 92;

type Selection = { kind: 'gauge' | 'dest'; id: string } | null;
type Mode = { kind: 'select' } | { kind: 'place-gauge' } | { kind: 'place-dest'; id: string } | { kind: 'connect'; target: string };

function loadBoard(): Board {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeBoard(JSON.parse(raw));
  } catch {
    /* storage unavailable or corrupted: start empty */
  }
  return emptyBoard();
}

const STATE_FR: Record<GaugeStatus['state'], string> = {
  idle: 'aucun objet',
  satisfied: 'stock atteint',
  promised: 'en attente de livraison',
  waiting: 'sous la cible',
  'missing-inputs': 'entrées insuffisantes',
  'no-address': 'adresse vide',
};

export function App() {
  const [board, setBoardState] = useState<Board>(loadBoard);
  const boardRef = useRef(board);
  boardRef.current = board;
  const simRef = useRef<SimState>(initSim(board));
  const [, setFrame] = useState(0);
  const redraw = () => setFrame((f) => f + 1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [sel, setSel] = useState<Selection>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'select' });

  const setBoard = useCallback((fn: (b: Board) => Board) => setBoardState((b) => fn(b)), []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
    } catch {
      /* not critical */
    }
  }, [board]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      stepSim(boardRef.current, simRef.current, speed, stackSize);
      redraw();
    }, 50);
    return () => clearInterval(t);
  }, [playing, speed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMode({ kind: 'select' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Before the simulation starts, edits to the initial stock apply immediately.
  useEffect(() => {
    if (simRef.current.tick === 0) {
      simRef.current = initSim(board);
      redraw();
    }
  }, [board]);

  const resetSim = () => {
    simRef.current = initSim(board);
    redraw();
  };

  const patchGauge = (id: string, v: Partial<Gauge>) => setBoard((b) => ({ ...b, gauges: b.gauges.map((g) => (g.id === id ? { ...g, ...v } : g)) }));
  const patchDest = (id: string, v: Partial<Destination>) =>
    setBoard((b) => ({ ...b, destinations: b.destinations.map((d) => (d.id === id ? { ...d, ...v } : d)) }));

  const occupied = (x: number, y: number) =>
    board.gauges.some((g) => g.x === x && g.y === y) || board.destinations.some((d) => d.x === x && d.y === y);

  const clickCell = (x: number, y: number) => {
    if (mode.kind === 'place-gauge' && !occupied(x, y)) {
      const g = newGauge(x, y, board.gauges.length + 1);
      setBoard((b) => ({ ...b, gauges: [...b.gauges, g] }));
      setSel({ kind: 'gauge', id: g.id });
      setMode({ kind: 'select' });
    } else if (mode.kind === 'place-dest' && !occupied(x, y)) {
      patchDest(mode.id, { x, y });
      setMode({ kind: 'select' });
    } else if (mode.kind === 'select') setSel(null);
  };

  const clickGauge = (g: Gauge) => {
    if (mode.kind === 'connect') {
      if (g.id !== mode.target) {
        const target = board.gauges.find((x) => x.id === mode.target);
        if (target && !target.inputs.some((i) => i.from === g.id)) patchGauge(target.id, { inputs: [...target.inputs, { from: g.id, amount: 1 }] });
      }
      setMode({ kind: 'select' });
      setSel({ kind: 'gauge', id: mode.target });
      return;
    }
    setSel({ kind: 'gauge', id: g.id });
  };

  const drop = (x: number, y: number, data: string) => {
    const [kind, id] = data.split(':');
    if (occupied(x, y)) return;
    if (kind === 'gauge') patchGauge(id, { x, y });
    if (kind === 'dest') patchDest(id, { x, y });
  };

  const sim = simRef.current;
  const selected = sel?.kind === 'gauge' ? board.gauges.find((g) => g.id === sel.id) : undefined;
  const selectedDest = sel?.kind === 'dest' ? board.destinations.find((d) => d.id === sel.id) : undefined;

  const fileInput = useRef<HTMLInputElement>(null);
  const exportBoard = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(board, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${board.name.replace(/[^\w-]+/g, '_') || 'usine'}.jauges.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <>
      <header className="topbar">
        <strong className="brand">⚙ Create Planner — jauges d'usine</strong>
        <input className="board-name" value={board.name} onChange={(e) => setBoard((b) => ({ ...b, name: e.target.value }))} aria-label="Nom du plan" />
        <button onClick={exportBoard}>Exporter</button>
        <button onClick={() => fileInput.current?.click()}>Importer</button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const b = normalizeBoard(JSON.parse(await f.text()));
              setBoardState(b);
              simRef.current = initSim(b);
              setSel(null);
            } catch (err) {
              alert(`Import impossible : ${(err as Error).message}`);
            }
          }}
        />
        <button
          className="ghost"
          onClick={() => {
            if (!confirm('Effacer tout le plan (jauges, adresses, stock) ?')) return;
            const b = emptyBoard();
            setBoardState(b);
            simRef.current = initSim(b);
            setSel(null);
          }}
        >
          Nouveau plan
        </button>
        <span className="muted small push">Objets : {dataOrigin === 'generated' ? 'données importées' : 'jeu de démonstration'}</span>
      </header>

      <div className="layout">
        <aside className="left">
          <section className="card">
            <h2>Outils</h2>
            <button className={mode.kind === 'place-gauge' ? 'active wide' : 'wide'} onClick={() => setMode(mode.kind === 'place-gauge' ? { kind: 'select' } : { kind: 'place-gauge' })}>
              + Jauge d'usine
            </button>
            <p className="muted small">{modeHint(mode, board)}</p>
            <div className="row">
              <label className="small">
                Grille {board.width} × {board.height}
              </label>
              <Num value={board.width} min={4} max={40} width={52} label="Largeur" onChange={(v) => setBoard((b) => ({ ...b, width: v }))} />
              <Num value={board.height} min={3} max={30} width={52} label="Hauteur" onChange={(v) => setBoard((b) => ({ ...b, height: v }))} />
            </div>
          </section>
          <AddressList board={board} sim={sim} sel={sel} setSel={setSel} setBoard={setBoard} setMode={setMode} />
        </aside>

        <main className="center">
          <BoardView
            board={board}
            sim={sim}
            sel={sel}
            mode={mode}
            onCell={clickCell}
            onGauge={clickGauge}
            onDest={(d) => setSel({ kind: 'dest', id: d.id })}
            onDrop={drop}
          />
          <SimPanel
            board={board}
            sim={sim}
            playing={playing}
            setPlaying={setPlaying}
            speed={speed}
            setSpeed={setSpeed}
            reset={resetSim}
            step={(ticks) => {
              stepSim(board, sim, ticks, stackSize);
              redraw();
            }}
            setBoard={setBoard}
            redraw={redraw}
          />
        </main>

        <aside className="right">
          {selected && (
            <GaugeEditor
              g={selected}
              board={board}
              sim={sim}
              patch={(v) => patchGauge(selected.id, v)}
              remove={() => {
                setBoard((b) => removeGauge(b, selected.id));
                setSel(null);
              }}
              connect={() => setMode({ kind: 'connect', target: selected.id })}
              connecting={mode.kind === 'connect'}
            />
          )}
          {selectedDest && (
            <DestEditor
              d={selectedDest}
              board={board}
              patch={(v) => patchDest(selectedDest.id, v)}
              place={() => setMode({ kind: 'place-dest', id: selectedDest.id })}
              remove={() => {
                setBoard((b) => ({ ...b, destinations: b.destinations.filter((x) => x.id !== selectedDest.id) }));
                setSel(null);
              }}
            />
          )}
          {!selected && !selectedDest && (
            <section className="card muted small">
              <h2>Configuration</h2>
              <p>Cliquez sur une jauge ou une adresse pour la configurer.</p>
              <p>
                Comme en jeu : une jauge surveille un objet dans le réseau et, tant que le stock plus les quantités promises restent sous la cible,
                elle envoie ses entrées à son adresse toutes les 101 ticks (≈ 5 s), puis promet la « sortie de recette ».
              </p>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

function modeHint(mode: Mode, board: Board): string {
  switch (mode.kind) {
    case 'place-gauge':
      return 'Cliquez une case libre pour poser la jauge (Échap pour annuler).';
    case 'place-dest':
      return `Cliquez une case libre pour placer « ${board.destinations.find((d) => d.id === mode.id)?.address} ».`;
    case 'connect':
      return 'Cliquez la jauge à relier comme entrée (Échap pour annuler).';
    default:
      return 'Glissez une jauge ou une adresse pour la déplacer.';
  }
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

const center = (x: number, y: number) => ({ cx: x * CELL + CELL / 2, cy: y * CELL + CELL / 2 });

function BoardView({
  board,
  sim,
  sel,
  mode,
  onCell,
  onGauge,
  onDest,
  onDrop,
}: {
  board: Board;
  sim: SimState;
  sel: Selection;
  mode: Mode;
  onCell: (x: number, y: number) => void;
  onGauge: (g: Gauge) => void;
  onDest: (d: Destination) => void;
  onDrop: (x: number, y: number, data: string) => void;
}) {
  const W = board.width * CELL;
  const H = board.height * CELL;
  const byId = new Map(board.gauges.map((g) => [g.id, g]));
  const cells = [];
  for (let y = 0; y < board.height; y++)
    for (let x = 0; x < board.width; x++)
      cells.push(
        <div
          key={`${x},${y}`}
          className={`cell ${mode.kind === 'place-gauge' || mode.kind === 'place-dest' ? 'placing' : ''}`}
          style={{ left: x * CELL, top: y * CELL, width: CELL, height: CELL }}
          onClick={() => onCell(x, y)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => onDrop(x, y, e.dataTransfer.getData('text/plain'))}
        />,
      );

  return (
    <div className="board-scroll">
      <div className="board" style={{ width: W, height: H }}>
        {cells}
        <svg className="overlay" width={W} height={H} aria-hidden>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--brass)" />
            </marker>
            <marker id="arrow-bad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--bad)" />
            </marker>
          </defs>
          {/* gauge -> its address (dashed) */}
          {board.gauges.map((g) => {
            const d = g.address ? findDestination(board, g.address) : undefined;
            if (!d || d.x === null || d.y === null) return null;
            const a = center(g.x, g.y);
            const b = center(d.x, d.y);
            return <line key={`addr-${g.id}`} x1={a.cx} y1={a.cy} x2={b.cx} y2={b.cy} className="addr-line" />;
          })}
          {/* input connections */}
          {board.gauges.flatMap((g) =>
            g.inputs.map((inp) => {
              const src = byId.get(inp.from);
              if (!src) return null;
              const a = center(src.x, src.y);
              const b = center(g.x, g.y);
              const len = Math.hypot(b.cx - a.cx, b.cy - a.cy) || 1;
              const k = (CELL * 0.42) / len;
              const x1 = a.cx + (b.cx - a.cx) * k;
              const y1 = a.cy + (b.cy - a.cy) * k;
              const x2 = b.cx - (b.cx - a.cx) * k;
              const y2 = b.cy - (b.cy - a.cy) * k;
              const short = src.item ? (sim.stock[src.item] ?? 0) < inp.amount : true;
              return (
                <g key={`${inp.from}->${g.id}`}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} className={short ? 'link bad' : 'link'} markerEnd={short ? 'url(#arrow-bad)' : 'url(#arrow)'} />
                  <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} className="link-label">
                    ×{inp.amount}
                  </text>
                </g>
              );
            }),
          )}
          {/* packages */}
          {sim.packages.map((p) => {
            if (p.status === 'delivered' || p.status === 'undeliverable') return null;
            const d = board.destinations.find((x) => x.id === p.destination);
            const g = p.gauge ? byId.get(p.gauge) : undefined;
            if (!d || d.x === null || d.y === null || !g) return null;
            const from = center(g.x, g.y);
            const to = center(d.x, d.y);
            const total = Math.max(1, (d.travelSec || 0.05) * 20);
            let t = 1;
            if (p.status === 'transit') t = 1 - Math.max(0, p.until - sim.tick) / total;
            if (p.status === 'returning') t = Math.max(0, p.until - sim.tick) / total;
            const cx = from.cx + (to.cx - from.cx) * t;
            const cy = from.cy + (to.cy - from.cy) * t;
            return <rect key={p.id} x={cx - 7} y={cy - 7} width={14} height={14} rx={2} className={`pkg ${p.status}`} />;
          })}
        </svg>
        {board.destinations.map((d) =>
          d.x === null || d.y === null ? null : (
            <button
              key={d.id}
              className={`tile dest ${sel?.kind === 'dest' && sel.id === d.id ? 'sel' : ''}`}
              style={{ left: d.x * CELL + 6, top: d.y * CELL + 6, width: CELL - 12, height: CELL - 12 }}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/plain', `dest:${d.id}`)}
              onClick={() => onDest(d)}
              title={`Adresse « ${d.address} »`}
            >
              <span className="dest-icon">✉</span>
              <span className="tile-label">{d.address || '(sans nom)'}</span>
              <span className="small muted">{sim.packages.filter((p) => p.destination === d.id && p.status === 'processing').length} en cours</span>
            </button>
          ),
        )}
        {board.gauges.map((g) => {
          const st = gaugeStatus(sim, g, stackSize);
          const pct = st.target > 0 ? Math.min(1, st.inStorage / st.target) : 0;
          return (
            <button
              key={g.id}
              className={`tile gauge st-${st.state} ${sel?.kind === 'gauge' && sel.id === g.id ? 'sel' : ''} ${mode.kind === 'connect' ? 'connecting' : ''}`}
              style={{ left: g.x * CELL + 6, top: g.y * CELL + 6, width: CELL - 12, height: CELL - 12 }}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/plain', `gauge:${g.id}`)}
              onClick={() => onGauge(g)}
              title={`${g.label} — ${itemName(g.item)} : ${STATE_FR[st.state]}`}
            >
              <span className="tile-top">
                <ItemIcon id={g.item} size={26} />
                <span className="tile-count">
                  {fmt(Math.floor(st.inStorage))}
                  <span className="muted">/{fmt(st.target)}</span>
                </span>
              </span>
              <span className="tile-label">{g.label}</span>
              <span className="bar">
                <span style={{ width: `${pct * 100}%` }} />
              </span>
              {g.mode === 'restock' && <span className="badge">réappro.</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gauge configuration (mirrors the in-game screen)
// ---------------------------------------------------------------------------

const TIMEOUTS: { v: number; label: string }[] = [
  { v: -1, label: 'Jamais' },
  { v: 0, label: '30 secondes' },
  ...[1, 2, 5, 10, 15, 20, 30].map((m) => ({ v: m, label: `${m} min` })),
];

function GaugeEditor({
  g,
  board,
  sim,
  patch,
  remove,
  connect,
  connecting,
}: {
  g: Gauge;
  board: Board;
  sim: SimState;
  patch: (v: Partial<Gauge>) => void;
  remove: () => void;
  connect: () => void;
  connecting: boolean;
}) {
  const st = gaugeStatus(sim, g, stackSize);
  const byId = new Map(board.gauges.map((x) => [x.id, x]));
  const feeds = board.gauges.filter((x) => x.inputs.some((i) => i.from === g.id));
  const dest = g.address ? findDestination(board, g.address) : undefined;
  return (
    <section className="card editor">
      <h2>Jauge d'usine</h2>
      <label className="field">
        <span>Nom</span>
        <input value={g.label} onChange={(e) => patch({ label: e.target.value })} />
      </label>
      <label className="field">
        <span>Objet surveillé (filtre)</span>
        <ItemPicker value={g.item} onChange={(item) => patch({ item, label: /^Jauge \d+$/.test(g.label) || g.label === itemName(g.item) ? itemName(item) : g.label })} />
      </label>
      <label className="field">
        <span>Garder en stock</span>
        <div className="row">
          <Num value={g.amount} min={0} max={g.unit === 'stacks' ? 9999 : 999999} onChange={(amount) => patch({ amount })} label="Quantité" />
          <select value={g.unit} onChange={(e) => patch({ unit: e.target.value as Gauge['unit'] })} aria-label="Unité">
            <option value="items">objets</option>
            <option value="stacks">piles</option>
          </select>
        </div>
        {g.unit === 'stacks' && g.item && <span className="muted small">= {targetAmount(g, stackSize)} objets</span>}
      </label>
      <label className="field">
        <span>Posée sur</span>
        <select value={g.mode} onChange={(e) => patch({ mode: e.target.value as Gauge['mode'] })}>
          <option value="recipe">Lien de stock / téléscripteur (recette)</option>
          <option value="restock">Empaqueteur (réapprovisionnement)</option>
        </select>
      </label>
      <label className="field">
        <span>Adresse {g.mode === 'recipe' ? 'de la recette (où envoyer les entrées)' : 'de livraison'}</span>
        <input value={g.address} list="addresses" placeholder="ex. presse, four*" onChange={(e) => patch({ address: e.target.value })} />
        {g.address && !dest && <span className="warn small">Aucune adresse de la liste ne correspond.</span>}
      </label>
      <datalist id="addresses">
        {board.destinations.map((d) => (
          <option key={d.id} value={d.address} />
        ))}
      </datalist>
      {g.mode === 'recipe' && (
        <label className="field">
          <span>Sortie de recette (objets promis par requête)</span>
          <Num value={g.recipeOutput} min={1} max={9999} onChange={(recipeOutput) => patch({ recipeOutput })} />
        </label>
      )}
      <label className="field">
        <span>Délai d'expiration des promesses</span>
        <select value={g.promiseTimeout} onChange={(e) => patch({ promiseTimeout: Number(e.target.value) })}>
          {TIMEOUTS.map((t) => (
            <option key={t.v} value={t.v}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      {g.mode === 'recipe' ? (
        <div className="field">
          <span>Entrées (jauges reliées, quantité par requête)</span>
          {g.inputs.length === 0 && <span className="muted small">Aucune : la jauge ne fait que surveiller son stock.</span>}
          {g.inputs.map((inp, i) => {
            const src = byId.get(inp.from);
            return (
              <div key={inp.from} className="row input-row">
                <ItemIcon id={src?.item ?? null} />
                <span className="grow" title={src?.label}>
                  {src ? itemName(src.item) : '(supprimée)'}
                </span>
                <Num
                  value={inp.amount}
                  min={1}
                  max={9999}
                  width={60}
                  label="Quantité"
                  onChange={(amount) => patch({ inputs: g.inputs.map((x, j) => (j === i ? { ...x, amount } : x)) })}
                />
                <button className="ghost" onClick={() => patch({ inputs: g.inputs.filter((_, j) => j !== i) })} aria-label="Retirer l'entrée">
                  ×
                </button>
              </div>
            );
          })}
          <button className={connecting ? 'active' : ''} onClick={connect}>
            {connecting ? 'Cliquez une jauge…' : '+ Relier une jauge en entrée'}
          </button>
        </div>
      ) : (
        <>
          <label className="field">
            <span>Stock initial de l'inventaire rempli</span>
            <Num value={g.localStock} min={0} onChange={(localStock) => patch({ localStock })} />
          </label>
          <label className="field">
            <span>Consommation de cet inventaire (objets/min)</span>
            <Num value={g.consumptionPerMin} min={0} onChange={(consumptionPerMin) => patch({ consumptionPerMin })} />
          </label>
        </>
      )}

      {feeds.length > 0 && <p className="small muted">Alimente : {feeds.map((f) => f.label).join(', ')}</p>}

      <div className={`status st-${st.state}`}>
        <div>
          <strong>{STATE_FR[st.state]}</strong>
        </div>
        <div className="small">
          En stock {fmt(st.inStorage)} · promis {fmt(st.promised)} · cible {fmt(st.target)}
        </div>
      </div>
      <button className="ghost danger" onClick={remove}>
        Supprimer la jauge
      </button>
    </section>
  );
}

function DestEditor({ d, board, patch, place, remove }: { d: Destination; board: Board; patch: (v: Partial<Destination>) => void; place: () => void; remove: () => void }) {
  const users = board.gauges.filter((g) => g.address && findDestination(board, g.address)?.id === d.id);
  return (
    <section className="card editor">
      <h2>Adresse</h2>
      <label className="field">
        <span>Nom de l'adresse (port grenouille, boîte postale, empaqueteur)</span>
        <input value={d.address} onChange={(e) => patch({ address: e.target.value })} />
        <span className="muted small">« * » accepte n'importe quelle suite de caractères (ex. four*).</span>
      </label>
      <label className="field">
        <span>Trajet d'un colis (s)</span>
        <Num value={d.travelSec} min={0} step={0.5} onChange={(travelSec) => patch({ travelSec })} />
      </label>
      <label className="field">
        <span>Fabrication d'une requête sur place (s)</span>
        <Num value={d.processSec} min={0} step={0.5} onChange={(processSec) => patch({ processSec })} />
      </label>
      <div className="row">
        <button onClick={place}>{d.x === null ? 'Placer sur la grille' : 'Déplacer'}</button>
        {d.x !== null && (
          <button className="ghost" onClick={() => patch({ x: null, y: null })}>
            Retirer de la grille
          </button>
        )}
      </div>
      <p className="small muted">Jauges qui envoient ici : {users.map((g) => g.label).join(', ') || 'aucune'}</p>
      <button className="ghost danger" onClick={remove}>
        Supprimer l'adresse
      </button>
    </section>
  );
}

function AddressList({
  board,
  sim,
  sel,
  setSel,
  setBoard,
  setMode,
}: {
  board: Board;
  sim: SimState;
  sel: Selection;
  setSel: (s: Selection) => void;
  setBoard: (fn: (b: Board) => Board) => void;
  setMode: (m: Mode) => void;
}) {
  const [name, setName] = useState('');
  const add = () => {
    const d = newDestination(name.trim() || `adresse ${board.destinations.length + 1}`);
    setBoard((b) => ({ ...b, destinations: [...b.destinations, d] }));
    setSel({ kind: 'dest', id: d.id });
    setMode({ kind: 'place-dest', id: d.id });
    setName('');
  };
  return (
    <section className="card">
      <h2>Adresses</h2>
      <div className="row">
        <input value={name} placeholder="ex. presse" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} aria-label="Nouvelle adresse" />
        <button onClick={add}>+</button>
      </div>
      <ul className="addr-list">
        {board.destinations.map((d) => {
          const inTransit = sim.packages.filter((p) => p.destination === d.id && (p.status === 'transit' || p.status === 'processing')).length;
          return (
            <li key={d.id}>
              <button className={`ghost wide ${sel?.kind === 'dest' && sel.id === d.id ? 'active' : ''}`} onClick={() => setSel({ kind: 'dest', id: d.id })}>
                ✉ {d.address || '(sans nom)'}
                {d.x === null && <span className="muted small"> · hors grille</span>}
                {inTransit > 0 && <span className="tag">{inTransit} colis</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {board.destinations.length === 0 && <p className="muted small">Ajoutez les adresses de vos ports / machines.</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function SimPanel({
  board,
  sim,
  playing,
  setPlaying,
  speed,
  setSpeed,
  reset,
  step,
  setBoard,
  redraw,
}: {
  board: Board;
  sim: SimState;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  speed: number;
  setSpeed: (v: number) => void;
  reset: () => void;
  step: (ticks: number) => void;
  setBoard: (fn: (b: Board) => Board) => void;
  redraw: () => void;
}) {
  const [newItem, setNewItem] = useState<Id | null>(null);
  const items = useMemo(() => {
    const s = new Set<Id>([...Object.keys(board.stock), ...Object.keys(board.supply), ...Object.keys(board.demand)]);
    for (const g of board.gauges) if (g.item) s.add(g.item);
    for (const k of Object.keys(sim.stock)) if (sim.stock[k] > 0) s.add(k);
    return [...s].sort((a, b) => itemName(a).localeCompare(itemName(b), 'fr'));
  }, [board, sim.stock, sim.tick]);
  const setMap = (key: 'stock' | 'supply' | 'demand', id: Id, v: number) =>
    setBoard((b) => {
      const m = { ...b[key] };
      if (v > 0) m[id] = v;
      else delete m[id];
      return { ...b, [key]: m };
    });
  const active = sim.packages.filter((p) => p.status !== 'delivered');
  return (
    <section className="card sim">
      <div className="row wrap">
        <h2>Simulation</h2>
        <button onClick={() => setPlaying(!playing)}>{playing ? '⏸ Pause' : '▶ Lancer'}</button>
        <button className="ghost" onClick={() => step(20)}>
          +1 s
        </button>
        <button className="ghost" onClick={() => step(20 * 30)}>
          +30 s
        </button>
        <label className="small">
          Vitesse
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {[1, 2, 5, 10, 20].map((s) => (
              <option key={s} value={s}>
                ×{s}
              </option>
            ))}
          </select>
        </label>
        <button className="ghost" onClick={reset} title="Revenir au stock initial">
          ↺ Réinitialiser
        </button>
        <span className="clock">⏱ {fmtTime(sim.tick)}</span>
      </div>

      <div className="sim-grid">
        <div>
          <h3>Stock du réseau</h3>
          <table>
            <thead>
              <tr>
                <th>Objet</th>
                <th>Initial</th>
                <th>Apport /min</th>
                <th>Conso /min</th>
                <th>Actuel</th>
              </tr>
            </thead>
            <tbody>
              {items.map((id) => (
                <tr key={id}>
                  <td>
                    <span className="item-name">
                      <ItemIcon id={id} size={16} /> {itemName(id)}
                    </span>
                  </td>
                  <td>
                    <Num value={board.stock[id] ?? 0} min={0} width={64} label="Stock initial" onChange={(v) => setMap('stock', id, v)} />
                  </td>
                  <td>
                    <Num value={board.supply[id] ?? 0} min={0} width={60} label="Apport par minute" onChange={(v) => setMap('supply', id, v)} />
                  </td>
                  <td>
                    <Num value={board.demand[id] ?? 0} min={0} width={60} label="Consommation par minute" onChange={(v) => setMap('demand', id, v)} />
                  </td>
                  <td className="num">
                    <strong>{fmt(Math.floor(sim.stock[id] ?? 0))}</strong>
                    {(sim.unmet[id] ?? 0) > 0.5 && <span className="warn small"> manque {fmt(sim.unmet[id])}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row">
            <div style={{ flex: 1 }}>
              <ItemPicker value={newItem} onChange={setNewItem} placeholder="Ajouter un objet au réseau…" />
            </div>
            <button disabled={!newItem} onClick={() => newItem && setMap('stock', newItem, (board.stock[newItem] ?? 0) + 64)}>
              +64
            </button>
          </div>
          <p className="muted small">Le stock initial est appliqué au lancement ou après « Réinitialiser ».</p>
        </div>

        <div>
          <h3>Colis ({active.length})</h3>
          <ManualSend board={board} sim={sim} redraw={redraw} />
          <ul className="packages">
            {active.slice(-40).reverse().map((p) => (
              <li key={p.id} className={p.status}>
                #{p.id} → « {p.address} » · {p.contents.map((c) => `${c.count} ${itemName(c.item)}`).join(', ')} ·{' '}
                {p.status === 'transit' ? 'en route' : p.status === 'processing' ? 'en fabrication' : p.status === 'returning' ? 'retour au réseau' : 'non livrable'}
              </li>
            ))}
          </ul>
          <h3>Journal</h3>
          <ul className="log">
            {sim.log
              .slice(-60)
              .reverse()
              .map((l, i) => (
                <li key={i} className={l.level}>
                  <span className="muted">{fmtTime(l.tick)}</span> {l.text.replace(/\b[a-z_]+:[a-z0-9_/]+\b/g, (id) => itemName(id))}
                </li>
              ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function ManualSend({ board, sim, redraw }: { board: Board; sim: SimState; redraw: () => void }) {
  const [address, setAddress] = useState('');
  const [item, setItem] = useState<Id | null>(null);
  const [count, setCount] = useState(1);
  const [msg, setMsg] = useState<string | null>(null);
  const match = address ? findDestination(board, address) : undefined;
  return (
    <div className="manual">
      <div className="row wrap">
        <input value={address} list="addresses" placeholder="Adresse" style={{ width: 120 }} onChange={(e) => setAddress(e.target.value)} aria-label="Adresse du colis" />
        <div style={{ minWidth: 170, flex: 1 }}>
          <ItemPicker value={item} onChange={setItem} placeholder="Contenu…" />
        </div>
        <Num value={count} min={1} width={60} label="Quantité" onChange={setCount} />
        <button
          disabled={!item}
          onClick={() => {
            if (!item) return;
            const err = sendManual(board, sim, address, [{ item, count }], stackSize);
            setMsg(err);
            redraw();
          }}
        >
          Envoyer
        </button>
      </div>
      <span className="small muted">
        {address ? (match ? `→ livré à « ${match.address} »` : 'aucune adresse ne correspond : le colis ne sera pas livré') : 'Envoi manuel depuis le stock du réseau'}
        {msg && <span className="warn"> — {msg}</span>}
      </span>
    </div>
  );
}
