// Probe: does a run-up summary predict the GTA-like launches' log ratios? Per launch: features and day-0 ratios.
import { readFileSync } from 'node:fs';
import { type Case, toSeries, valueAt, usDst } from '../main.ts';
import { GTA_LIKE } from './loo.ts';
const H = 3600_000;
const c = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Case;
const rows: number[][] = [];
for (const x of c.comparables ?? []) {
  if (!GTA_LIKE.test(x.name ?? '')) continue;
  const t0 = Date.parse(x.day_start!); const s = toSeries(x.hourly, t0); const sh = usDst(t0 + 12 * H) ? 1 : 0;
  const at = (k: number) => { const v = valueAt(s, k - sh); return v === null ? NaN : Math.log(Math.max(1, v)); };
  const p = at(0);
  const prevMax = Math.max(...Array.from({ length: 12 }, (_, i) => at(-12 + i)).filter((v) => !isNaN(v)));
  const prevMean = Math.log(Array.from({ length: 12 }, (_, i) => Math.exp(at(-12 + i))).filter((v) => !isNaN(v)).reduce((a, b) => a + b, 0) / 12);
  const mom = p - at(-1);
  const early = [1, 2, 3].map((k) => at(k) - p).reduce((a, b) => a + b) / 3;
  const us = [5, 6, 7].map((k) => at(k) - p).reduce((a, b) => a + b) / 3;
  const morn = [8, 9, 10, 11].map((k) => at(k) - p).reduce((a, b) => a + b) / 4;
  const aft = [16, 17, 18, 19, 20, 21].map((k) => at(k) - p).reduce((a, b) => a + b) / 6;
  const late = [22, 23].map((k) => at(k) - p).reduce((a, b) => a + b) / 2;
  rows.push([prevMax - p, prevMean - p, mom, early, us, morn, aft, late]);
  console.log(`${x.name!.slice(0, 24).padEnd(24)} prevMax=${(prevMax - p).toFixed(2)} prevMean=${(prevMean - p).toFixed(2)} mom=${mom.toFixed(2)} | early=${early.toFixed(2)} us=${us.toFixed(2)} morn=${morn.toFixed(2)} aft=${aft.toFixed(2)} late=${late.toFixed(2)}`);
}
const corr = (i: number, j: number) => { const n = rows.length; const mx = rows.reduce((a, r) => a + r[i], 0) / n, my = rows.reduce((a, r) => a + r[j], 0) / n; let sxy = 0, sxx = 0, syy = 0; for (const r of rows) { sxy += (r[i] - mx) * (r[j] - my); sxx += (r[i] - mx) ** 2; syy += (r[j] - my) ** 2; } return [sxy / Math.sqrt(sxx * syy), sxy / sxx, my - (sxy / sxx) * mx, Math.sqrt(syy / n)]; };
for (const [fi, fn] of [[0, 'prevMax'], [1, 'prevMean'], [2, 'mom']] as const) for (const [ti, tn] of [[3, 'early'], [4, 'us'], [5, 'morn'], [6, 'aft'], [7, 'late']] as const) { const [r, b, a, sd] = corr(fi, ti); console.log(`${fn}->${tn}: r=${r.toFixed(2)} slope=${b.toFixed(2)} icpt=${a.toFixed(2)} sd(y)=${sd.toFixed(2)}`); }
