// Validate every <id>.out in a directory against the contest's output contract, the way the grader reads it.
//
//   node tools/check.ts <out dir> [<other out dir> to compare byte for byte]

import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const other = process.argv[3];
let bad = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.out')).sort()) {
  const p = join(dir, f);
  const raw = readFileSync(p);
  const problems: string[] = [];
  if (!lstatSync(p).isFile()) problems.push('not a regular file');
  if (raw.length > 65536) problems.push(`too large: ${raw.length}`);
  try {
    const o = JSON.parse(raw.toString('utf8'));
    if (Object.keys(o).length !== 1 || !Array.isArray(o.hours)) problems.push('top level must be exactly {hours}');
    else {
      if (o.hours.length !== 23) problems.push(`${o.hours.length} rows`);
      const seen = new Set<number>();
      for (const r of o.hours) {
        if (Object.keys(r).sort().join(',') !== 'hour,q') problems.push(`row keys ${Object.keys(r)}`);
        if (!Number.isInteger(r.hour) || r.hour < 2 || r.hour > 24 || seen.has(r.hour)) problems.push(`hour ${r.hour}`);
        seen.add(r.hour);
        if (!Array.isArray(r.q) || r.q.length !== 5) { problems.push(`q of hour ${r.hour}`); continue; }
        r.q.forEach((x: unknown, i: number) => {
          if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0 || x > 1e9) problems.push(`hour ${r.hour} q[${i}]=${x}`);
          if (i > 0 && (x as number) < r.q[i - 1]) problems.push(`hour ${r.hour} not monotone`);
        });
      }
    }
  } catch (e) {
    problems.push(`not JSON: ${(e as Error).message}`);
  }
  if (other) {
    const raw2 = readFileSync(join(other, f));
    if (!raw.equals(raw2)) problems.push('differs from the other run');
  }
  if (problems.length) bad++;
  console.log(`${f}: ${problems.length ? 'INVALID ' + problems.slice(0, 5).join('; ') : 'ok'}`);
}
console.log(bad ? `${bad} invalid` : 'all valid');
process.exit(bad ? 1 : 0);
