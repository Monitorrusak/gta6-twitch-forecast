// Probe: per hour, how well do two analog anchorings predict the GTA-like launches (leave-one-out, equal weights)?
//  A: ln v_h = ln p1 + median over analogs of ln(v_h / p1)
//  B: ln v_h = ln v_{h-24} + median over analogs of ln(v_h / v_{h-24})   (only where yesterday is post-unlock)
import { readFileSync } from 'node:fs';
import { type Case, toSeries, valueAt, usDst } from '../main.ts';
import { GTA_LIKE } from './loo.ts';
const H = 3600_000;
const c = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Case;
const L = (c.comparables ?? []).filter((x) => GTA_LIKE.test(x.name ?? '')).map((x) => {
  const t0 = Date.parse(x.day_start!); const s = toSeries(x.hourly, t0); const sh = usDst(t0 + 12 * H) ? 1 : 0;
  const at = (k: number) => { const v = valueAt(s, k - sh); return v === null ? null : Math.log(Math.max(1, v)); };
  return { name: x.name!, at };
});
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
for (let h = 2; h <= 24; h++) {
  const k = h - 1; let ea = 0, eb = 0, n = 0, nb = 0, yb = 0;
  for (const t of L) {
    const y = t.at(k), p = t.at(0), yd = t.at(k - 24); if (y === null || p === null) continue;
    const others = L.filter((o) => o !== t);
    const ra = others.map((o) => { const a = o.at(k), b = o.at(0); return a === null || b === null ? null : a - b; }).filter((x): x is number => x !== null);
    ea += Math.abs(y - (p + med(ra))); n++;
    if (yd !== null && yd - p > -1.5) {
      const rb = others.map((o) => { const a = o.at(k), b = o.at(k - 24), q = o.at(0); return a === null || b === null || q === null || b - q < -1.5 ? null : a - b; }).filter((x): x is number => x !== null);
      if (rb.length >= 3) { eb += Math.abs(y - (yd + med(rb))); yb += Math.abs(y - (p + med(ra))); nb++; }
    }
  }
  console.log(`h${String(h).padStart(2)} (${String(k).padStart(2)}Z) A mae=${(ea / n).toFixed(3)} n=${n}   B mae=${nb ? (eb / nb).toFixed(3) : '  -  '} vs A on same=${nb ? (yb / nb).toFixed(3) : ' - '} n=${nb}`);
}
