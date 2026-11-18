// Show which analogs carry a case's forecast, and its median ratio curve.
//   node tools/explain.ts <case.in>
import { readFileSync } from 'node:fs';
import { type Case, type Detail, DEFAULT_PARAMS, forecastLogRatios, targetClass, targetPlatform, hourOne } from '../main.ts';
const c = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Case;
const d: Detail = { weights: [], ess: 0 };
const lr = forecastLogRatios(c, DEFAULT_PARAMS, d);
console.log(`${c.id} p1=${hourOne(c)} class=${targetClass(c)} platform=${targetPlatform(c)} ess=${d.ess.toFixed(1)} nowcast=${d.nowcast?.toFixed(3)}`);
console.log(d.weights.slice(0, 10).map((x) => `${x.name.slice(0, 18)}:${x.w.toFixed(3)}`).join('  '));
console.log('median x p1:', lr.map((q, i) => `${i + 2}:${Math.exp(q[2]).toFixed(2)}`).join(' '));
console.log('q05 x p1:   ', lr.map((q, i) => `${i + 2}:${Math.exp(q[0]).toFixed(2)}`).join(' '));
console.log('q95 x p1:   ', lr.map((q, i) => `${i + 2}:${Math.exp(q[4]).toFixed(2)}`).join(' '));
