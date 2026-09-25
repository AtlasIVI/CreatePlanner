// Number formatting for the French UI.

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const nf3 = new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 3 });

export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  if (n !== 0 && Math.abs(n) < 0.01) return nf3.format(n);
  return nf.format(n);
}

export function fmtInt(n: number): string {
  return Number.isFinite(n) ? Math.round(n).toLocaleString('fr-FR') : '∞';
}

export function fmtSU(n: number): string {
  return `${fmtInt(n)} SU`;
}

/** Items per second shown as /s, /min, /h. */
export function rates(perSecond: number, fluid = false): [string, string, string] {
  const u = fluid ? ' mB' : '';
  return [`${fmt(perSecond)}${u}/s`, `${fmt(perSecond * 60)}${u}/min`, `${fmt(perSecond * 3600)}${u}/h`];
}

export function ticksToSeconds(t: number): string {
  return `${fmt(t / 20)} s`;
}
