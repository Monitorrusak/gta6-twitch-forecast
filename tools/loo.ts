// Leave-one-out evaluation over the comparables: each comparable launch becomes a pseudo-case cut like a practice
// case (its day's hour 1 known, its history before that, the other comparables as analogs) and is scored on its real
// hours 2..24 with the contest's log pinball loss, next to the house baseline.
//
//   node tools/loo.ts <case.in> [paramJSON]
//
// Prints per-launch losses, the mean over all launches and over the "unlocked by hour 1" subset (hour 1 far above the
// pre-release baseline, as GTA VI's will be).

import { readFileSync } from 'node:fs';
import { type Case, type Comparable, DEFAULT_PARAMS, type Detail, type Params, forecastLogRatios, toSeries, valueAt, features, LEVELS } from '../main.ts';

const HOUR_MS = 3600_000;
const ZB = [-1.645, -0.674, 0, 0.674, 1.645];

/** Rolling midnight-local console launches already unlocked somewhere by their hour 1: the final's kind of case. */
export const GTA_LIKE = /ELDEN RING$|Resident Evil Requiem|Cyberpunk|Ghost of|Monster Hunter Wilds|Call of Duty|Tears of the Kingdom|Borderlands 4|FINAL FANTASY VII|Last of Us|Stellar Blade|Death Stranding 2|Hogwarts|DOOM|Assassin|Wolverine|Red Dead|Ragnar|Spider-Man/;

/** The console-only subset of those: GTA VI's closest kin (PS5 / Xbox Series only, US unlock still ahead at hour 1). */
export const CONSOLE_LIKE = /Ghost of|Tears of the Kingdom|Last of Us|Stellar Blade|FINAL FANTASY VII|Death Stranding 2|Wolverine|Red Dead|Ragnar|Spider-Man/;

export const pinball = (y: number, q: number[]): number => {
  let s = 0;
  for (let i = 0; i < 5; i++) {
    const d = Math.log(Math.max(1, y)) - Math.log(q[i]);
    const t = LEVELS[i];
    s += 2 * Math.max(t * d, (t - 1) * d);
  }
  return s / 5;
};

export interface Pseudo { name: string; c: Case; answer: Map<number, number>; p1: number; base: number | null }

export const pseudoCases = (comps: Comparable[]): Pseudo[] => {
  const out: Pseudo[] = [];
  comps.forEach((comp, i) => {
    if (/not a launch|target-history/i.test(comp.unlock ?? '')) return;
    const t0 = Date.parse(comp.day_start ?? '');
    const s = toSeries(comp.hourly, t0);
    const p1 = s.get(0);
    if (p1 === undefined) return;
    const answer = new Map<number, number>();
    for (let h = 2; h <= 24; h++) {
      const v = s.get(h - 1);
      if (v !== undefined) answer.set(h, v);
    }
    if (answer.size < 12) return;
    const history_hourly = (comp.hourly ?? []).filter((p) => Date.parse(p.from ?? '') < t0);
    const c: Case = {
      id: `loo${i}`,
      notes: `${comp.name}, released ${comp.day_start?.slice(0, 10)} on ${comp.platforms}; real unlock: ${comp.unlock}`,
      day_start: comp.day_start,
      known: [{ hour: 1, viewers: p1 }],
      history_hourly,
      comparables: comps.filter((_, j) => j !== i),
    };
    const f = features(s, 0, p1, DEFAULT_PARAMS);
    out.push({ name: comp.name ?? '?', c, answer, p1, base: f.base });
  });
  return out;
};

export interface Score { all: number; unlocked: number; console: number; base: number; baseUnlocked: number; baseConsole: number; cov: number }

export const scoreModel = (ps: Pseudo[], P: Params, verbose = false): Score => {
  let sa = 0, na = 0, su = 0, nu = 0, ba = 0, bu = 0, cov = 0, ncov = 0, sc = 0, bc = 0, nc = 0;
  for (const p of ps) {
    const det: Detail = { weights: [], ess: 0 };
    const lr = forecastLogRatios(p.c, P, det);
    let l = 0, b = 0, n = 0;
    for (const [h, y] of p.answer) {
      const q = lr[h - 2].map((x) => p.p1 * Math.exp(x));
      l += pinball(y, q);
      b += pinball(y, ZB.map((z) => p.p1 * Math.exp(z * 0.15 * Math.sqrt(h - 1))));
      n++;
      cov += q[0] <= y && y <= q[4] ? 1 : 0;
      ncov++;
    }
    const unlocked = GTA_LIKE.test(p.name);
    sa += l; ba += b; na += n;
    if (unlocked) { su += l; bu += b; nu += n; }
    if (CONSOLE_LIKE.test(p.name)) { sc += l; bc += b; nc += n; }
    if (verbose) {
      const top = det.weights.slice(0, 3).map((x) => `${x.name.slice(0, 14)}:${x.w.toFixed(2)}`).join(' ');
      console.log(`${p.name.slice(0, 26).padEnd(26)} base=${p.base?.toFixed(1).padStart(5)} loss=${(l / n).toFixed(3)} house=${(b / n).toFixed(3)} ess=${det.ess.toFixed(1).padStart(4)} ${top}`);
    }
  }
  return { all: sa / na, unlocked: su / nu, console: sc / nc, base: ba / na, baseUnlocked: bu / nu, baseConsole: bc / nc, cov: cov / ncov };
};

export const fmt = (r: Score): string =>
  `model all=${r.all.toFixed(4)} gtaLike=${r.unlocked.toFixed(4)} console=${r.console.toFixed(4)} | house all=${r.base.toFixed(4)} gtaLike=${r.baseUnlocked.toFixed(4)} console=${r.baseConsole.toFixed(4)} | cov90=${r.cov.toFixed(3)}`;

if (import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/').split('/').pop() ?? '#')) {
  const c = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Case;
  const P = { ...DEFAULT_PARAMS, ...(process.argv[3] ? JSON.parse(process.argv[3]) : {}) } as Params;
  const ps = pseudoCases(c.comparables ?? []);
  const r = scoreModel(ps, P, !process.argv[4]);
  console.log(`n=${ps.length}  ${fmt(r)}`);
}
