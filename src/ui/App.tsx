import { useEffect, useState } from 'react';
import { BlockLibrary } from './BlockLibrary';

const STORAGE_KEY = 'createplanner:grid';
const CELL = 48;

interface GridSize {
  width: number;
  height: number;
}

function loadSize(): GridSize {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<GridSize>;
      if (typeof s.width === 'number' && typeof s.height === 'number') return { width: s.width, height: s.height };
    }
  } catch {
    /* storage unavailable: default size */
  }
  return { width: 20, height: 12 };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function App() {
  const [size, setSize] = useState<GridSize>(loadSize);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(size));
    } catch {
      /* not critical */
    }
  }, [size]);

  const setDim = (key: keyof GridSize, v: number) => {
    if (Number.isFinite(v)) setSize((s) => ({ ...s, [key]: clamp(Math.round(v), 1, 64) }));
  };

  return (
    <>
      <header className="topbar">
        <strong className="brand">⚙ Create Planner</strong>
        <label>
          Largeur{' '}
          <input type="number" min={1} max={64} value={size.width} onChange={(e) => setDim('width', e.target.valueAsNumber)} />
        </label>
        <label>
          Hauteur{' '}
          <input type="number" min={1} max={64} value={size.height} onChange={(e) => setDim('height', e.target.valueAsNumber)} />
        </label>
      </header>
      <div className="layout">
        <BlockLibrary />
        <main className="board-scroll">
          <div className="board" style={{ width: size.width * CELL, height: size.height * CELL }} aria-label="Grille" />
        </main>
      </div>
    </>
  );
}
