// Synthetic final-shaped cases for robustness tests: minute reads since 2026-11-17, streams, categories, the practice
// case's comparables (which hold GTA VI's own pre-release entry), and odd variants (no notes, tiny or huge hour 1, no
// history, no comparables, nulls everywhere, a broken file). Deterministic.
//
//   node tools/synth.ts <practice case.in> <out dir>

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const src = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const dir = process.argv[3];
mkdirSync(dir, { recursive: true });

const T0 = Date.parse('2026-11-19T00:00:00Z');
const MIN = 60_000;
const iso = (t: number) => new Date(t).toISOString().replace('.000Z', 'Z');

// a deterministic wiggle
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

/** The scenario's viewers at minute t: a quiet pre-release cycle, then the rolling unlock from NZ (11:00Z the day before). */
const level = (t: number, peak: number, h1: number): number => {
  const hUtc = ((t / 3600_000) % 24 + 24) % 24;
  if (t < T0 - 13 * 3600_000) return 1500 + 800 * Math.sin(((hUtc - 6) / 24) * 2 * Math.PI) + 200 * rnd();
  // after the NZ unlock: ramp to the evening peak at 19Z, then ease to hour 1's level at 00Z
  const x = (t - (T0 - 13 * 3600_000)) / 3600_000; // 0 at 11Z
  const ramp = x < 8 ? peak * Math.min(1, x / 8) : peak + (h1 - peak) * ((x - 8) / 5);
  return Math.max(100, ramp * (1 + 0.02 * (rnd() - 0.5)));
};

const build = (id: string, peak: number, h1: number, mutate?: (c: any) => void) => {
  const history: any[] = [];
  for (let t = Date.parse('2026-11-17T03:00:00Z'); t < T0; t += MIN) {
    history.push({ at: iso(t), viewers: Math.round(level(t, peak, h1)), channels: 200 });
  }
  const hour1: number[] = [];
  for (let t = T0; t < T0 + 3600_000; t += MIN) hour1.push(Math.round(h1 * (0.95 + 0.1 * ((t - T0) / 3600_000))));
  hour1.forEach((v, i) => history.push({ at: iso(T0 + i * MIN), viewers: v, channels: 20000 }));
  const hh = new Map<number, number[]>();
  for (const p of history) {
    const k = Math.floor(Date.parse(p.at) / 3600_000) * 3600_000;
    if (!hh.has(k)) hh.set(k, []);
    hh.get(k)!.push(p.viewers);
  }
  const history_hourly = [...hh].map(([k, vs]) => ({ from: iso(k), viewers: Math.round(vs.reduce((a, b) => a + b, 0) / vs.length), channels: 100, reads: vs.length }));
  const p1 = Math.round(hour1.reduce((a, b) => a + b, 0) / hour1.length);
  const c: any = {
    schema: 'makefun/twitch-ccu-case/v1',
    id,
    game: { name: 'Grand Theft Auto VI', twitch_id: '1867279146' },
    day_start: iso(T0),
    checkpoint: iso(T0 + 3600_000),
    levels: [0.05, 0.25, 0.5, 0.75, 0.95],
    known: [{ hour: 1, from: iso(T0), until: iso(T0 + 3600_000), viewers: p1, channels: 20000, reads: 60 }],
    forecast: Array.from({ length: 23 }, (_, i) => ({ hour: i + 2, from: iso(T0 + (i + 1) * 3600_000), until: iso(T0 + (i + 2) * 3600_000) })),
    history,
    history_hourly,
    streams: Array.from({ length: 20 }, (_, i) => ({ login: `s${i}`, viewers: Math.round(p1 / (i + 3)), language: i % 3 ? 'en' : 'es', started_at: iso(T0 - i * 3600_000) })),
    categories_hourly: [{ from: iso(T0), top: [{ name: 'Grand Theft Auto VI', viewers: p1, channels: 20000 }, { name: 'Just Chatting', viewers: 400000, channels: 9000 }] }],
    comparables: src.comparables,
    notes: 'Grand Theft Auto VI (Twitch category 1867279146), released 2026-11-19 on PS5 and Xbox Series X|S; unlock: rolling midnight local (New Zealand first, 2026-11-18T11:00Z). Minute reads of the make.fun recorder.',
  };
  if (mutate) mutate(c);
  writeFileSync(join(dir, `${id}.in`), JSON.stringify(c));
};

build('h00', 2_500_000, 1_200_000);
build('h01_nonotes', 2_500_000, 1_200_000, (c) => { c.notes = null; });
build('h02_small', 30_000, 20_000);
build('h03_huge', 9_000_000, 8_000_000);
build('h04_prelaunch', 3000, 2500, (c) => { c.notes = 'unlock: single global unlock at 14:00Z'; });
build('h05_nohist', 2_500_000, 1_200_000, (c) => { c.history = []; c.history_hourly = null; });
build('h06_nocomps', 2_500_000, 1_200_000, (c) => { c.comparables = null; });
build('h07_nulls', 2_500_000, 1_200_000, (c) => { c.history = [null, { at: null, viewers: 'x' }]; c.history_hourly = [{ from: 'bad', viewers: -5 }]; c.comparables = [null, { name: 'x', hourly: null }, ...c.comparables.slice(0, 3)]; c.streams = null; c.categories_hourly = null; });
build('h08_noknown', 2_500_000, 1_200_000, (c) => { c.known = []; });
build('h09_zero', 2_500_000, 0, (c) => { c.known[0].viewers = 0; });
writeFileSync(join(dir, 'h10_broken.in'), '{"id": "h10", "known": [');
console.log('written to', dir);
