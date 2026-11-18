// GTA VI launch-day Twitch viewers: an analog-ensemble forecaster (Node 22, standard library only, no network).
//
// For each case it forecasts hours 2..24 of the UTC release day as five quantiles of the category's concurrent
// viewers, given hour 1's print and everything recorded before it. The method:
//
//   1. Every comparable launch is turned into a curve of log ratios to its own hour 1 (00:00 UTC of its release day),
//      after shifting launches that happened under US daylight time by one hour, so that "midnight on the US east
//      coast" (04:00Z in summer, 05:00Z in November) lines up with the target's.
//   2. Each analog is weighted by how much the target's own run-up resembles the analog's: the shape of the 16 hours
//      before hour 1 (log ratios to hour 1) and how far hour 1 sits above the pre-release baseline (which tells a
//      launch that is already unlocked somewhere in the world from one still waiting for a global unlock).
//   3. Hour h's forecast is the weighted mixture of normals centred on the analogs' log ratios, with a spread that
//      grows with the horizon; its quantiles at 5/25/50/75/95% are read off by bisection and scaled by hour 1's print.
//
// Everything is deterministic (no randomness, inputs read in name order), and every output is validated: if anything
// fails, the case falls back to a persistence forecast with a widening spread, so a valid file is always written.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
const Z = [-1.6448536, -0.6744898, 0, 0.6744898, 1.6448536];
const HOUR_MS = 3600_000;

// ---------------------------------------------------------------------------------------------------------------
// Types (loose: every field may be missing or null in an odd input)

export interface HourlyPoint { from?: string | null; at?: string | null; viewers?: number | null; channels?: number | null; reads?: number | null }
export interface Comparable { name?: string; day_start?: string; unlock?: string; platforms?: string; hourly?: HourlyPoint[] | null }
export interface Case {
  id?: string;
  day_start?: string;
  checkpoint?: string;
  levels?: number[];
  known?: Array<{ hour?: number; viewers?: number | null; reads?: number | null }> | null;
  forecast?: Array<{ hour?: number }> | null;
  history?: HourlyPoint[] | null;
  history_hourly?: HourlyPoint[] | null;
  streams?: unknown;
  categories_hourly?: unknown;
  comparables?: Comparable[] | null;
  notes?: string | null;
  game?: { name?: string; twitch_id?: string } | null;
}

export interface Params {
  shapeLen: number; // hours of run-up compared
  shapeClipLo: number; // log-ratio floor for the run-up (pre-unlock hours are ~0 viewers)
  shapeClipHi: number;
  baseClip: number; // cap of ln(hour 1 / pre-release baseline)
  wBase: number; // weight of the baseline feature against the mean squared shape difference
  bandwidth: number; // kernel bandwidth on the distance
  s0: number; // spread of each mixture component: s0 + s1 * sqrt(h - 1)
  s1: number;
  shrink: number; // analog log ratios are multiplied by this (shrinks toward persistence)
  priorEarly: number; // prior weight of an early-access-contaminated analog
  priorWeak: number; // prior weight of a weak analog
  priorOtherClass: number; // prior weight of an analog whose unlock class is the opposite of the target's
  priorUnknownClass: number; // ... whose unlock class is unknown
  maxViewers: number; // no analog may take the category above this many viewers (all of Twitch peaks at a few million)
  priorOtherPlat: number; // prior weight of an analog on other platforms (PC-inclusive vs console-only)
  wSize: number; // weight of the size difference ln(p1 target / p1 analog) in the distance
  betaSize: number; // each analog's ratios move by betaSize * (size difference), clipped to +-sizeClip
  sizeClip: number;
  essInflate: number; // component spread grows by (1 + essInflate / sqrt(effective analog count))
  nowcastClip: number; // the minute nowcast's surprise is clipped to +-this (log units)
  nowcastWeights: number[]; // ... and added to hours 2, 3, 4, ... times these
}

export const DEFAULT_PARAMS: Params = {
  shapeLen: 12,
  shapeClipLo: -4,
  shapeClipHi: 2.5,
  baseClip: 7,
  wBase: 0.05,
  bandwidth: 0.9,
  s0: 0.12,
  s1: 0.06,
  shrink: 0.85,
  priorEarly: 0.5,
  priorWeak: 0.3,
  priorOtherClass: 0.15,
  priorUnknownClass: 0.6,
  maxViewers: 7e6,
  priorOtherPlat: 0.25,
  wSize: 0.15,
  betaSize: -0.2,
  sizeClip: 2,
  essInflate: 0.2,
  nowcastClip: 0.12,
  nowcastWeights: [1, 0.6, 0.3],
};

/** The target's unlock class: its notes, else the target-history comparable's notes (the final's GTA VI entry). */
export const targetClass = (c: Case): UnlockClass => {
  const own = unlockClass(c.notes);
  if (own !== 'unknown') return own;
  // the game's own pre-release entry describes the coming launch ("releases 2026-11-19, rolling midnight local")
  const hist = ownHistory(c);
  return hist ? unlockClass(hist.unlock) : 'unknown';
};

/** The target's platform class: its notes ("released ... on PS5 only"), else the target-history comparable's platforms. */
export const targetPlatform = (c: Case): PlatformClass => {
  const notes = c.notes ?? '';
  // only the sentence naming the platforms, not the sources' boilerplate
  const m = /released[^.;]*?\bon\b([^.;]*)/i.exec(notes);
  const own = platformClass(m ? m[1] : '');
  if (own !== 'unknown') return own;
  const hist = ownHistory(c);
  return hist ? platformClass(hist.platforms) : 'unknown';
};

// ---------------------------------------------------------------------------------------------------------------
// Small numeric helpers

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

const parseMs = (s: unknown): number | null => {
  if (typeof s !== 'string') return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};

/** Standard normal CDF (Abramowitz and Stegun 7.1.26 on erf, |error| < 1.5e-7). */
export const normCdf = (x: number): number => {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
};

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 ? s[(n - 1) / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2]);
};

const clip = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Whether a UTC instant falls in US daylight saving time (2nd Sunday of March .. 1st Sunday of November). */
export const usDst = (ms: number): boolean => {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const nthSunday = (month: number, n: number): number => {
    const first = new Date(Date.UTC(y, month, 1)).getUTCDay();
    const day = 1 + ((7 - first) % 7) + 7 * (n - 1);
    return Date.UTC(y, month, day);
  };
  const start = nthSunday(2, 2) + 7 * HOUR_MS; // 2 am EST
  const end = nthSunday(10, 1) + 6 * HOUR_MS; // 2 am EDT
  return ms >= start && ms < end;
};

// ---------------------------------------------------------------------------------------------------------------
// Series: hour index (0 = the release day's first UTC hour) -> viewers

export type Series = Map<number, number>;

/** Hourly points to a series indexed by whole hours from t0 (several points in one hour are averaged). */
export const toSeries = (points: HourlyPoint[] | null | undefined, t0: number): Series => {
  const sum = new Map<number, number>();
  const cnt = new Map<number, number>();
  for (const p of points ?? []) {
    if (p == null) continue;
    const t = parseMs(p.from ?? p.at);
    const v = p.viewers;
    if (t === null || !isNum(v) || v < 0) continue;
    const k = Math.floor((t - t0) / HOUR_MS);
    sum.set(k, (sum.get(k) ?? 0) + v);
    cnt.set(k, (cnt.get(k) ?? 0) + 1);
  }
  const out: Series = new Map();
  for (const [k, s] of sum) out.set(k, s / (cnt.get(k) ?? 1));
  return out;
};

/** The series' value at hour k, log-interpolated across a gap of at most maxGap hours; null if unknown. */
export const valueAt = (s: Series, k: number, maxGap = 3): number | null => {
  const v = s.get(k);
  if (v !== undefined) return v;
  let lo: number | null = null;
  let hi: number | null = null;
  for (let d = 1; d <= maxGap; d++) {
    if (lo === null && s.has(k - d)) lo = k - d;
    if (hi === null && s.has(k + d)) hi = k + d;
  }
  if (lo === null || hi === null || hi - lo > maxGap + 1) return null;
  const a = Math.log(Math.max(1, s.get(lo) as number));
  const b = Math.log(Math.max(1, s.get(hi) as number));
  return Math.exp(a + ((b - a) * (k - lo)) / (hi - lo));
};

const logv = (v: number): number => Math.log(Math.max(1, v));

// ---------------------------------------------------------------------------------------------------------------
// Features of a run-up: the shape of the hours before hour 1 and hour 1 against the pre-release baseline

export interface Features { shape: Array<number | null>; base: number | null; size: number }

/** Features of a series s whose "hour 1" is at index k1, with p1 its value. */
export const features = (s: Series, k1: number, p1: number, P: Params): Features => {
  const l1 = logv(p1);
  const shape: Array<number | null> = [];
  for (let m = 1; m <= P.shapeLen; m++) {
    const v = valueAt(s, k1 - m);
    shape.push(v === null ? null : clip(logv(v) - l1, P.shapeClipLo, P.shapeClipHi));
  }
  const pre: number[] = [];
  for (let k = k1 - 96; k <= k1 - 30; k++) {
    const v = s.get(k);
    if (v !== undefined) pre.push(v);
  }
  const base = pre.length >= 3 ? clip(l1 - logv(median(pre)), -2, P.baseClip) : null;
  return { shape, base, size: l1 };
};

/** Squared distance between two run-ups' features. */
export const distance2 = (a: Features, b: Features, P: Params): number => {
  let ss = 0;
  let n = 0;
  for (let i = 0; i < a.shape.length; i++) {
    const x = a.shape[i];
    const y = b.shape[i];
    if (x === null || y === null) continue;
    ss += (x - y) ** 2;
    n++;
  }
  let d2 = n > 0 ? ss / n : 1;
  if (a.base !== null && b.base !== null) d2 += P.wBase * (a.base - b.base) ** 2;
  d2 += P.wSize * (a.size - b.size) ** 2;
  return d2;
};

// ---------------------------------------------------------------------------------------------------------------
// Analogs

/** How a launch unlocked, from its notes: rolling midnight-local, one simultaneous global instant, or unknown. */
export type UnlockClass = 'rolling' | 'global' | 'unknown';

export const unlockClass = (text: string | undefined | null): UnlockClass => {
  const t = text ?? '';
  if (/midnight local|rolling|local midnight|in each timezone|every timezone/i.test(t)) return 'rolling';
  if (/simultaneous|single global|global unlock|single time|single simultaneous/i.test(t)) return 'global';
  return 'unknown';
};

/** Whether a launch included PC (unlocked everywhere at once on PC, so the US had it by hour 1) or was console-only. */
export type PlatformClass = 'console' | 'pc' | 'unknown';

export const platformClass = (text: string | undefined | null): PlatformClass => {
  // a PC version that is absent or later ("no PC until 2027", "PC 2019-11", "PC later") is not a PC launch
  const t = (text ?? '')
    .replace(/\b(?:no|without|not on)\s+PC\b[^,;)]*/gi, ' ')
    .replace(/\bPC\s*(?:version\s*)?(?:later|until|in\s+20\d\d|\(?20\d\d)[^,;)]*/gi, ' ');
  if (/console[- ]only|consoles? only/i.test(t)) return 'console';
  if (/\bPC\b|Steam|Stadia|Windows/i.test(t)) return 'pc';
  if (/PS\s?\d|PlayStation|Xbox|Switch/i.test(t)) return 'console';
  return 'unknown';
};

/** Prior weight of an analog of class a for a target of class t. */
const classPrior = (t: UnlockClass, a: UnlockClass, P: Params): number => {
  if (t === 'unknown' || a === t) return 1;
  if (a === 'unknown') return P.priorUnknownClass;
  return P.priorOtherClass;
};

export interface Analog {
  name: string;
  cls: UnlockClass;
  plat: PlatformClass;
  prior: number;
  feats: Features;
  /** ratios[h - 2] = ln(viewers at hour h / viewers at hour 1), or null where the analog has no value. */
  ratios: Array<number | null>;
}

const isTargetHistory = (c: Comparable): boolean => /not a launch|target-history|before release/i.test(`${c.name ?? ''} ${c.unlock ?? ''}`);

/** The case's own game's pre-release history among the comparables (the final's GTA VI entry), if any. */
export const ownHistory = (c: Case): Comparable | null => {
  const name = (c.game?.name ?? '').trim().toLowerCase();
  if (!name) return null;
  for (const comp of c.comparables ?? []) {
    if (comp && isTargetHistory(comp) && (comp.name ?? '').toLowerCase().startsWith(name)) return comp;
  }
  return null;
};

/** One comparable as an analog for a target whose day starts at targetT0 (null if it has no usable hour 1). */
export const makeAnalog = (c: Comparable, targetDst: boolean, P: Params): Analog | null => {
  if (c == null || isTargetHistory(c)) return null;
  const t0 = parseMs(c.day_start);
  if (t0 === null) return null;
  const s = toSeries(c.hourly, t0);
  // target hour index k <-> analog index k - shift
  const shift = (usDst(t0 + 12 * HOUR_MS) ? 1 : 0) - (targetDst ? 1 : 0);
  const k1 = -shift;
  const p1 = valueAt(s, k1, 2);
  if (p1 === null || p1 <= 0) return null;
  const l1 = logv(p1);
  const ratios: Array<number | null> = [];
  let have = 0;
  for (let h = 2; h <= 24; h++) {
    const v = valueAt(s, k1 + h - 1);
    ratios.push(v === null ? null : logv(v) - l1);
    if (v !== null) have++;
  }
  if (have < 12) return null;
  const tier = /tier:\s*([a-z-]+)/i.exec(c.unlock ?? '')?.[1]?.toLowerCase() ?? '';
  const prior = tier.startsWith('early') ? P.priorEarly : tier === 'weak' ? P.priorWeak : 1;
  return { name: c.name ?? '?', cls: unlockClass(c.unlock), plat: platformClass(c.platforms), prior, feats: features(s, k1, p1, P), ratios };
};

// ---------------------------------------------------------------------------------------------------------------
// The forecast

/** The tau-quantile of a weighted mixture of normals (means mu, common sd s), by bisection. */
export const mixtureQuantile = (mu: number[], w: number[], s: number, tau: number): number => {
  let lo = Infinity;
  let hi = -Infinity;
  for (const m of mu) {
    lo = Math.min(lo, m);
    hi = Math.max(hi, m);
  }
  lo -= 6 * s;
  hi += 6 * s;
  const wsum = w.reduce((a, b) => a + b, 0);
  for (let it = 0; it < 60; it++) {
    const x = 0.5 * (lo + hi);
    let cdf = 0;
    for (let i = 0; i < mu.length; i++) cdf += w[i] * normCdf((x - mu[i]) / s);
    if (cdf / wsum < tau) lo = x;
    else hi = x;
  }
  return 0.5 * (lo + hi);
};

export interface Detail { weights: Array<{ name: string; w: number }>; ess: number; nowcast?: number }

/** Forecast log ratios to hour 1: for each hour 2..24, five quantiles. */
export const forecastLogRatios = (c: Case, P: Params = DEFAULT_PARAMS, detail?: Detail): number[][] => {
  const t0 = parseMs(c.day_start);
  if (t0 === null) throw new Error('no day_start');
  const targetDst = usDst(t0 + 12 * HOUR_MS);
  const p1 = hourOne(c);
  const hist = toSeries(c.history_hourly && c.history_hourly.length ? c.history_hourly : c.history, t0);
  // hours the case's history lacks, from the game's own pre-release entry among the comparables (same game only)
  const own = ownHistory(c);
  if (own) {
    for (const [k, v] of toSeries(own.hourly, t0)) if (k < 0 && !hist.has(k)) hist.set(k, v);
  }
  hist.set(0, p1);
  const tf = features(hist, 0, p1, P);

  const analogs: Analog[] = [];
  for (const comp of c.comparables ?? []) {
    const a = makeAnalog(comp, targetDst, P);
    if (a) analogs.push(a);
  }
  if (analogs.length === 0) throw new Error('no analogs');

  const tcls = targetClass(c);
  const tplat = targetPlatform(c);
  const platPrior = (a: PlatformClass): number => (tplat === 'unknown' || a === 'unknown' || a === tplat ? 1 : P.priorOtherPlat);
  const d2 = analogs.map((a) => distance2(tf, a.feats, P));
  const dmin = Math.min(...d2);
  // weights relative to the nearest analog keep the kernel well scaled whatever the target looks like
  const w = analogs.map(
    (a, i) => a.prior * classPrior(tcls, a.cls, P) * platPrior(a.plat) * Math.exp(-(d2[i] - dmin) / (2 * P.bandwidth * P.bandwidth)),
  );
  // the category cannot outgrow all of Twitch: cap every analog's ratio where p1 * ratio passes maxViewers
  const capHi = Math.max(Math.log(1.5), Math.log(P.maxViewers / p1));
  const wsum = w.reduce((x, y) => x + y, 0);
  const ess = wsum ** 2 / w.reduce((x, y) => x + y * y, 0);
  if (detail) {
    detail.weights = analogs.map((a, i) => ({ name: a.name, w: w[i] / wsum })).sort((x, y) => y.w - x.w);
    detail.ess = ess;
  }

  const out: number[][] = [];
  for (let h = 2; h <= 24; h++) {
    const mu: number[] = [];
    const ww: number[] = [];
    analogs.forEach((a, i) => {
      const r = a.ratios[h - 2];
      if (r !== null && w[i] > 0) {
        const sizeAdj = P.betaSize * clip(tf.size - a.feats.size, -P.sizeClip, P.sizeClip);
        mu.push(Math.min(capHi, P.shrink * r + sizeAdj));
        ww.push(w[i]);
      }
    });
    // few effective analogs: their spread understates the truth, so each component widens
    const s = (P.s0 + P.s1 * Math.sqrt(h - 1)) * (1 + P.essInflate / Math.sqrt(Math.max(1, ess)));
    if (mu.length === 0) {
      out.push(Z.map((z) => z * (s + 0.15 * Math.sqrt(h - 1))));
      continue;
    }
    out.push(LEVELS.map((tau) => mixtureQuantile(mu, ww, s, tau)));
  }

  // minute nowcast (the final's history is minute reads): if hour 1 ended above or below the trend the analogs and
  // the run-up imply, the next hours start from there. Clipped and decaying: a nudge, not a new model.
  const nc = nowcast(c, t0, p1, hist, out[0][2], P);
  if (nc !== 0) {
    P.nowcastWeights.forEach((k, i) => {
      if (i < out.length) out[i] = out[i].map((x) => x + k * nc);
    });
  }
  if (detail) detail.nowcast = nc;
  return out;
};

/**
 * The hour-1 surprise from minute reads: ln(mean of hour 1's last 15 minutes / hour 1's print) minus what a smooth
 * curve through hour 0, hour 1 and the forecast median of hour 2 would put there. 0 without minute reads.
 */
export const nowcast = (c: Case, t0: number, p1: number, hist: Series, medR2: number, P: Params): number => {
  const last: number[] = [];
  let n = 0;
  for (const p of c.history ?? []) {
    const t = parseMs(p?.at ?? p?.from);
    if (t === null || t < t0 || t >= t0 + HOUR_MS || !isNum(p.viewers)) continue;
    n++;
    if (t >= t0 + 45 * 60_000) last.push(p.viewers);
  }
  if (n < 20 || last.length < 5) return 0;
  const surprise = logv(last.reduce((a, b) => a + b, 0) / last.length) - logv(p1);
  const v0 = valueAt(hist, -1, 1);
  const slopeIn = v0 === null ? medR2 : logv(p1) - logv(v0);
  // the last quarter's centre lies 22.5 minutes after the hour's centre: 0.375 h of the slope at the hour's end
  const expected = 0.375 * 0.5 * (slopeIn + medR2);
  return clip(surprise - expected, -P.nowcastClip, P.nowcastClip);
};

/** Hour 1's print (at least 1). */
export const hourOne = (c: Case): number => {
  const k = (c.known ?? []).find((r) => r && r.hour === 1);
  let v = k && isNum(k.viewers) ? k.viewers : null;
  if (v === null) {
    // no print: the last hourly mean before the checkpoint
    const t0 = parseMs(c.day_start) ?? 0;
    const s = toSeries(c.history_hourly ?? c.history, t0);
    v = s.get(0) ?? s.get(-1) ?? null;
  }
  return Math.max(1, v ?? 1);
};

// ---------------------------------------------------------------------------------------------------------------
// Output: validation and the fallback

export interface Row { hour: number; q: number[] }

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** The house-style persistence forecast, used only if the model fails. */
export const fallbackRows = (p1: number, hours: number[]): Row[] =>
  hours.map((h) => ({ hour: h, q: Z.map((z) => round2(p1 * Math.exp(z * 0.2 * Math.sqrt(Math.max(1, h - 1))))) }));

/** Clean a row's quantiles: finite, within (0, 1e9], non-decreasing, 2 decimals. */
export const cleanQ = (q: number[], p1: number): number[] => {
  const out: number[] = [];
  let prev = 0.01;
  for (let i = 0; i < 5; i++) {
    let x = q[i];
    if (!isNum(x)) x = p1;
    x = clip(round2(x), 0.01, 1e9);
    if (x < prev) x = prev;
    out.push(x);
    prev = x;
  }
  return out;
};

export const validRows = (rows: Row[]): boolean => {
  if (!Array.isArray(rows) || rows.length !== 23) return false;
  const seen = new Set<number>();
  for (const r of rows) {
    if (!Number.isInteger(r.hour) || r.hour < 2 || r.hour > 24 || seen.has(r.hour)) return false;
    seen.add(r.hour);
    if (!Array.isArray(r.q) || r.q.length !== 5) return false;
    for (let i = 0; i < 5; i++) {
      const x = r.q[i];
      if (!isNum(x) || x <= 0 || x > 1e9 || (i > 0 && x < r.q[i - 1])) return false;
    }
  }
  return true;
};

const HOURS = Array.from({ length: 23 }, (_, i) => i + 2);

/** The full forecast for a case, always valid. */
export const forecastRows = (c: Case, P: Params = DEFAULT_PARAMS): Row[] => {
  let p1 = 1;
  try {
    p1 = hourOne(c);
  } catch {
    p1 = 1;
  }
  try {
    const lr = forecastLogRatios(c, P);
    const rows = HOURS.map((h, i) => ({ hour: h, q: cleanQ(lr[i].map((x) => p1 * Math.exp(x)), p1) }));
    if (validRows(rows)) return rows;
  } catch {
    // fall through to the fallback
  }
  return fallbackRows(p1, HOURS);
};

// ---------------------------------------------------------------------------------------------------------------
// Main: every *.in in the input directory, in name order

const main = (): void => {
  const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outputDir, { recursive: true });
  const files = readdirSync(inputDir).filter((f) => f.endsWith('.in')).sort();
  for (const file of files) {
    const id = file.slice(0, -3);
    let rows: Row[];
    try {
      const c = JSON.parse(readFileSync(join(inputDir, file), 'utf8')) as Case;
      rows = forecastRows(c);
    } catch {
      rows = fallbackRows(1, HOURS);
    }
    writeFileSync(join(outputDir, `${id}.out`), `${JSON.stringify({ hours: rows })}\n`);
  }
};

// Run unless imported by one of tools/*.ts (the evaluation scripts): the grader's `node /bot/main.ts` always runs.
const entry = (process.argv[1] ?? '').replace(/\\/g, '/');
if (!/\/tools\/[^/]+\.ts$/.test(entry)) main();
