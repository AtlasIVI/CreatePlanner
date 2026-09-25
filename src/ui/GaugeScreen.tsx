// Recreation of Create 6's factory gauge screen (FactoryPanelScreen): same layout, same wording
// (official French translation), scroll-wheel and left-click behaviour. Drawn with CSS, no game textures.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { gaugeStatus, targetAmount, type Board, type Gauge, type SimState } from '../core/gauges';
import type { Id } from '../core/types';
import { itemName, stackSize } from '../data/items';
import { ItemIcon, ItemPicker } from './common';

/** One GUI pixel = P screen pixels (Minecraft GUI scale 2). */
const P = 2;
const px = (n: number) => n * P;
const at = (x: number, y: number, w?: number, h?: number): CSSProperties => ({
  left: px(x),
  top: px(y),
  ...(w !== undefined ? { width: px(w) } : {}),
  ...(h !== undefined ? { height: px(h) } : {}),
});

// Official strings (assets/create/lang/fr_fr.json)
const T = {
  titleRecipe: 'Paramètres de la recette',
  titleRestock: 'Paramètres du restockage',
  unconfigured: 'Ingrédients de la recette\nLes ingrédients peuvent être ajoutés en\nconnectant d’autres jauges d’usine',
  sending: (item: string, n: number) => `Envoi de ${item} ×${n}\nFaites défiler pour changer la quantité\nClic gauche pour s’y déconnecter`,
  expected: (item: string, n: number) =>
    `S’attend à ${item} x${n}\nLa quantité d’objets reçus\naprès chaque requête réussie\nFaites défiler pour changer`,
  connectInput: 'Ajouter une nouvelle connexion',
  relocate: 'Déplacer cette jauge',
  crafting: 'Utiliser la fabrication mécanique',
  recipeAddress: 'Envoyer les objets d’entrée à...\nEntrez l’adresse où\ncette recette est fabriquée.',
  restockAddress: 'Envoyer les objets à...\nEntrez l’adresse qui permettra\naux colis d’être acheminés ici.',
  noPromises: (restock: boolean) =>
    `Pas de promesses ouvertes\n${
      restock
        ? 'Quand des objets sont envoyés, une promesse\nest conservée jusqu’à ce que qu’ils arrivent.'
        : 'Quand des objets d’entrées sont envoyés, une promesse\nest conservée jusqu’à ce que les objets de sortie arrivent.'
    }\nCela empêche un envoi excessif.`,
  promised: (item: string, n: number) => `Objets promis\n${item} x${n}\nClic gauche pour réinitialiser`,
  expireTitle: 'Les promesses expirent après',
  reset: 'Réinitialiser tous les paramètres',
  save: 'Sauvegarder et fermer',
  targetAmount: 'Quantité stockée ciblée',
  placeItem: 'Placez un objet à surveiller',
  addressMissing: 'Inactif : il manque une adresse cible',
};

function useWheel(handler: (dir: number, fast: boolean) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const h = useRef(handler);
  h.current = handler;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      h.current(e.deltaY < 0 ? 1 : -1, e.shiftKey);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  return ref;
}

function Slot({
  x,
  y,
  item,
  count,
  tip,
  onWheel,
  onClick,
  className = '',
  children,
}: {
  x: number;
  y: number;
  item: Id | null;
  count?: number | string;
  tip: string;
  onWheel?: (dir: number, fast: boolean) => void;
  onClick?: () => void;
  className?: string;
  children?: ReactNode;
}) {
  const ref = useWheel((d, f) => onWheel?.(d, f));
  return (
    <div ref={ref} className={`mc-slot ${className}`} style={at(x - 1, y - 1, 18, 18)} title={tip} onClick={onClick} role={onClick ? 'button' : undefined}>
      {item && <ItemIcon id={item} size={px(16)} />}
      {count !== undefined && count !== '' && <span className="mc-count">{count}</span>}
      {children}
    </div>
  );
}

function McButton({ x, y, tip, onClick, children, active }: { x: number; y: number; tip: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button className={`mc-btn ${active ? 'on' : ''}`} style={at(x, y, 18, 18)} title={tip} aria-label={tip.split('\n')[0]} onClick={onClick}>
      {children}
    </button>
  );
}

const timeoutLabel = (v: number) => (v === -1 ? ' /' : v === 0 ? '30s' : `${v}m`);

export function GaugeScreen({
  g,
  board,
  sim,
  patch,
  close,
  onConnect,
  onRelocate,
  onResetPromises,
  children,
}: {
  g: Gauge;
  board: Board;
  sim: SimState;
  patch: (v: Partial<Gauge>) => void;
  close: () => void;
  onConnect: () => void;
  onRelocate: () => void;
  onResetPromises: () => void;
  /** Planner-only settings shown under the game window. */
  children?: ReactNode;
}) {
  const restock = g.mode === 'restock';
  const topH = restock ? 40 : 96;
  const H = topH + 64;
  const byId = new Map(board.gauges.map((x) => [x.id, x]));
  const st = gaugeStatus(sim, g, stackSize);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const expireRef = useWheel((d) => patch({ promiseTimeout: Math.min(30, Math.max(-1, g.promiseTimeout + d)) }));
  const amountRef = useWheel((d, fast) => patch({ amount: Math.max(0, g.amount + d * (fast ? 10 : 1)) }));

  const inputs = g.inputs.slice(0, 9);
  const itemLabel = g.item ? itemName(g.item) : '';

  return (
    <div className="mc-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="mc-stack">
        {/* What is set on the gauge block itself in the world: filter item and target amount */}
        <div className="mc-block-bar">
          <div className="mc-slot mc-slot-light" title={T.placeItem} onClick={() => setPicking(!picking)} role="button" style={{ position: 'relative', width: px(18), height: px(18) }}>
            {g.item && <ItemIcon id={g.item} size={px(16)} />}
          </div>
          <div className="mc-value" ref={amountRef} title={`${T.targetAmount}\nFaites défiler pour changer (Maj : ×10)`}>
            <span className="mc-value-label">{T.targetAmount}</span>
            <input
              type="number"
              min={0}
              value={g.amount}
              onChange={(e) => Number.isFinite(e.target.valueAsNumber) && patch({ amount: Math.max(0, e.target.valueAsNumber) })}
              aria-label={T.targetAmount}
            />
            <button className={`mc-unit ${g.unit === 'items' ? 'on' : ''}`} onClick={() => patch({ unit: 'items' })}>
              objets
            </button>
            <button className={`mc-unit ${g.unit === 'stacks' ? 'on' : ''}`} onClick={() => patch({ unit: 'stacks' })}>
              ▤ piles
            </button>
            {g.unit === 'stacks' && g.item && <span className="mc-value-label">= {targetAmount(g, stackSize)}</span>}
          </div>
          {picking && (
            <div className="mc-picker">
              <ItemPicker
                value={g.item}
                placeholder={T.placeItem}
                onChange={(item) => {
                  patch({ item, label: /^Jauge \d+$/.test(g.label) || g.label === itemName(g.item) ? itemName(item) : g.label });
                  setPicking(false);
                }}
              />
            </div>
          )}
        </div>

        <div className="mc-window" style={{ width: px(200), height: px(H) }} role="dialog" aria-label={restock ? T.titleRestock : T.titleRecipe}>
          {/* Top: recipe or restock settings */}
          <div className={`mc-top ${restock ? 'restock' : ''}`} style={at(0, 0, 192, topH)}>
            <div className="mc-title-bar" style={at(0, 0, 192, 14)} />
            <div className="mc-title" style={{ top: px(restock ? 3 : 4) }}>
              {restock ? T.titleRestock : T.titleRecipe}
            </div>

            {restock ? (
              <Slot x={88} y={12} item={g.item} tip={T.sending(itemLabel, 1)} className="mc-slot-light" />
            ) : (
              <>
                <McButton x={31} y={27} tip={`${T.crafting}\n(sans effet sur la simulation)`} onClick={() => patch({ crafting: !g.crafting })} active={g.crafting}>
                  <span className="mc-3x3" />
                </McButton>
                <McButton x={31} y={47} tip={T.connectInput} onClick={onConnect}>
                  <span className="mc-plus">+</span>
                </McButton>
                <McButton x={31} y={67} tip={T.relocate} onClick={onRelocate}>
                  <span className="mc-move">✥</span>
                </McButton>

                <div className="mc-grid-frame" style={at(64, 24, 64, 64)} title={inputs.length ? undefined : T.unconfigured} />
                {Array.from({ length: 9 }, (_, i) => {
                  const inp = inputs[i];
                  const src = inp ? byId.get(inp.from) : undefined;
                  const x = 68 + (i % 3) * 20;
                  const y = 28 + Math.floor(i / 3) * 20;
                  if (!inp) return <Slot key={i} x={x} y={y} item={null} tip={T.unconfigured} className="mc-slot-light" />;
                  return (
                    <Slot
                      key={i}
                      x={x}
                      y={y}
                      item={src?.item ?? null}
                      count={inp.amount}
                      className="mc-slot-light"
                      tip={T.sending(itemName(src?.item), inp.amount)}
                      onWheel={(d, fast) =>
                        patch({ inputs: g.inputs.map((q, j) => (j === i ? { ...q, amount: Math.max(1, Math.min(9999, q.amount + d * (fast ? 10 : 1))) } : q)) })
                      }
                      onClick={() => patch({ inputs: g.inputs.filter((_, j) => j !== i) })}
                    />
                  );
                })}
                <div className="mc-arrow" style={at(136, 49, 18, 14)} />
                <Slot
                  x={160}
                  y={48}
                  item={g.item}
                  count={g.item ? g.recipeOutput : ''}
                  className="mc-slot-dark"
                  tip={T.expected(itemLabel, g.recipeOutput)}
                  onWheel={(d, fast) => patch({ recipeOutput: Math.max(1, Math.min(9999, g.recipeOutput + d * (fast ? 10 : 1))) })}
                />
              </>
            )}
          </div>

          {/* Bottom: address, promises, expiry, buttons */}
          <div className="mc-bottom" style={at(0, topH, 200, 64)}>
            <div className="mc-address-strip" style={at(0, 0, 192, 40)} />
            <span className="mc-tag-icon" style={at(9, 9, 22, 14)} aria-hidden>
              ✉
            </span>
            <input
              className={`mc-address ${g.address.trim() ? '' : 'empty'}`}
              style={at(36, 13 - 3, 110, 14)}
              value={g.address}
              placeholder={restock ? 'Envoyer les objets à...' : 'Envoyer les objets d’entrée à...'}
              list="addresses"
              title={g.address.trim() ? (restock ? T.restockAddress : T.recipeAddress) : `${T.addressMissing}\n${restock ? T.restockAddress : T.recipeAddress}`}
              onChange={(e) => patch({ address: e.target.value })}
              aria-label="Adresse"
            />
            <div className="mc-bar" style={at(0, 36, 200, 28)} />
            <Slot
              x={68}
              y={40}
              item={null}
              count={st.promised ? Math.round(st.promised) : 0}
              className="mc-slot-flat"
              tip={st.promised ? T.promised(itemLabel, Math.round(st.promised)) : T.noPromises(restock)}
              onClick={st.promised ? onResetPromises : undefined}
            >
              <span className="mc-package" />
            </Slot>
            <span className="mc-clock" style={at(86, 43, 10, 10)} aria-hidden>
              ⏱
            </span>
            <div
              ref={expireRef}
              className="mc-scroll"
              style={at(97, 40, 28, 16)}
              title={`${T.expireTitle}\n${g.promiseTimeout === -1 ? 'Les promesses n’expirent pas' : g.promiseTimeout === 0 ? '30 secondes' : `${g.promiseTimeout} minute(s)`}\nFaites défiler pour changer`}
              onClick={() => patch({ promiseTimeout: g.promiseTimeout >= 30 ? -1 : g.promiseTimeout + 1 })}
              role="button"
            >
              {timeoutLabel(g.promiseTimeout)}
            </div>
            <McButton
              x={200 - 55}
              y={40}
              tip={T.reset}
              onClick={() => {
                if (confirm(`${T.reset} ?`)) patch({ address: '', inputs: [], recipeOutput: 1, promiseTimeout: -1, crafting: false });
              }}
            >
              <span className="mc-trash">🗑</span>
            </McButton>
            <McButton x={200 - 33} y={40} tip={T.save} onClick={close}>
              <span className="mc-check">✓</span>
            </McButton>
          </div>

          {/* The gauge block with its filter, floating to the right like in game */}
          <div className="mc-preview" style={at(200, restock ? 0 : 30, 60, 60)} aria-hidden>
            <div className="mc-gauge-face">{g.item && <ItemIcon id={g.item} size={px(22)} />}</div>
          </div>
        </div>

        {children && <div className="mc-extras">{children}</div>}
      </div>
    </div>
  );
}
