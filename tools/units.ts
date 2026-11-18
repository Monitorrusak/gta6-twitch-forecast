// Unit checks of the text classifiers and small helpers against the phrasings the cases use (and the final may).
//   node tools/units.ts
import { platformClass, unlockClass, usDst, normCdf, targetPlatform, type Case } from '../main.ts';
let fail = 0;
const eq = (got: unknown, want: unknown, what: string) => { if (got !== want) { fail++; console.log(`FAIL ${what}: got ${got}, want ${want}`); } };
eq(platformClass('PS5 and Xbox Series X|S only (no PC until 2027)'), 'console', 'GTA no-PC phrasing');
eq(platformClass('PS5, Xbox Series X|S'), 'console', 'GTA platforms');
eq(platformClass('PS4, Xbox One (console only; PC 2019-11)'), 'console', 'RDR2');
eq(platformClass('PC (PS5 2023-09-06)'), 'pc', 'BG3');
eq(platformClass('Xbox Series, PC (PS5 later)'), 'pc', 'FH6');
eq(platformClass('PC, PS5 (Xbox later)'), 'pc', 'Wukong');
eq(platformClass('PS5 only (Sony first-party, single-player)'), 'console', 'Wolverine');
eq(platformClass('Switch'), 'console', 'Zelda');
eq(platformClass('PC, Stadia, PS4/XB1 (+next-gen via BC)'), 'pc', 'Cyberpunk');
eq(unlockClass('Midnight local time on Nov 9 in every timezone, rolling, no simultaneous launch'), 'rolling', 'GoW');
eq(unlockClass('Single simultaneous global unlock 2025-09-04T14:00Z'), 'global', 'Silksong');
eq(unlockClass('unverified. Tier: comparable.'), 'unknown', 'unverified');
eq(usDst(Date.parse('2026-11-19T12:00:00Z')), false, 'GTA day standard time');
eq(usDst(Date.parse('2023-10-20T12:00:00Z')), true, 'SM2 day DST');
eq(usDst(Date.parse('2025-03-20T12:00:00Z')), true, 'ACS after 2nd Sunday of March');
eq(usDst(Date.parse('2023-11-10T12:00:00Z')), false, 'MW3 after 1st Sunday of November');
eq(Math.abs(normCdf(1.6448536) - 0.95) < 1e-6, true, 'normCdf');
const gta: Case = { game: { name: 'Grand Theft Auto VI' }, notes: 'Grand Theft Auto VI, released 2026-11-19 on PS5 and Xbox Series X|S only (no PC until 2027); rolling midnight local', comparables: [] };
eq(targetPlatform(gta), 'console', 'GTA target platform from notes');
eq(targetPlatform({ ...gta, notes: 'Minute reads.', comparables: [{ name: 'Grand Theft Auto VI category before release', unlock: 'Not a launch. Tier: target-history', platforms: 'PS5, Xbox Series X|S' }] }), 'console', 'GTA target platform from its own history');
console.log(fail ? `${fail} failed` : 'all unit checks pass');
process.exit(fail ? 1 : 0);
