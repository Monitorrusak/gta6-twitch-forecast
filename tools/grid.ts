// A coarse grid over the forecaster's few free parameters, scored by leave-one-out (tools/loo.ts). Kept coarse on
// purpose: the console-only subset is 7 launches, so only differences that hold across all three subsets are trusted.
//
//   node tools/grid.ts <case.in>

import { readFileSync } from 'node:fs';
import { type Case, DEFAULT_PARAMS, type Params } from '../main.ts';
import { fmt, pseudoCases, scoreModel } from './loo.ts';

const c = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Case;
const ps = pseudoCases(c.comparables ?? []);

const axes: Record<string, number[]> = {
  bandwidth: [0.3, 0.45, 0.6, 0.9, 1.5],
  s0: [0.06, 0.12, 0.2],
  s1: [0.0, 0.04, 0.08],
  shrink: [0.7, 0.85, 1],
  wBase: [0, 0.15, 0.5],
  priorOtherPlat: [0.1, 0.25, 0.5],
  priorOtherClass: [0.05, 0.15, 0.4],
  shapeLen: [8, 12, 16, 24],
};

// one axis at a time around the defaults
for (const [k, vals] of Object.entries(axes)) {
  for (const v of vals) {
    const P = { ...DEFAULT_PARAMS, [k]: v } as Params;
    const r = scoreModel(ps, P);
    console.log(`${k}=${v}`.padEnd(22), fmt(r));
  }
}
