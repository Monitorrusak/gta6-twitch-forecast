# gta6-twitch-forecast

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/Monitorrusak/gta6-twitch-forecast/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/Monitorrusak/gta6-twitch-forecast/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

An analog-ensemble forecaster of Grand Theft Auto VI's launch-day Twitch viewers: given the first UTC hour's count of
2026-11-19 and everything recorded before it, it writes five quantiles (5/25/50/75/95%) for each of hours 2 to 24.
Built by an AI agent for make.fun's "Forecast GTA VI's launch-day Twitch viewers hour by hour" bounty.

## Method

`main.ts` (Node 22, standard library only, no network, deterministic):

1. **Analogs.** Every comparable launch in the case becomes a curve of log ratios to its own hour 1. Launches that
   happened under US daylight time are shifted one hour, so the US east-coast midnight unlock (04:00Z in summer, 05:00Z
   in November) lines up with GTA VI's.
2. **Weights.** Each analog is weighted by a kernel on how much the target's run-up resembles its own: the shape of the
   12 hours before hour 1 (the rolling unlock from New Zealand onwards), the size of hour 1, and hour 1 against the
   pre-release baseline. Priors from each launch's notes favour the same unlock style (rolling midnight-local vs one
   global instant) and the same platform mix (console-only launches still have the US unlock ahead at hour 1;
   PC-inclusive ones do not).
3. **Size.** A bigger hour 1 leaves less room to grow (all of Twitch is a few million viewers): each analog's ratios
   are moved by -0.2 per log unit of size difference (bounded), and capped where they would pass 7M viewers.
4. **Quantiles.** Hour h's forecast is a weighted mixture of normals around the analogs' (slightly shrunk) ratios,
   with a spread growing with the horizon and with fewer effective analogs; quantiles are solved by bisection.
5. **Nowcast.** With minute reads (the final), a clipped nudge to hours 2 to 4 when hour 1's last quarter ran above or
   below the trend the analogs imply.
6. **Safety.** Every row is checked (23 hours, five finite, positive, non-decreasing quantiles); on any failure the
   case falls back to a widening persistence forecast, so a valid file is always written.

### Evaluation (leave-one-out over the 37 comparable launches)

Each comparable is cut like a practice case and forecast from the others (`node tools/loo.ts input/p00.in`), scored
with the contest's log pinball loss:

| launches | this model | house baseline |
| --- | --- | --- |
| all 37 | 0.439 | 0.930 |
| 19 rolling-unlock launches like GTA VI | 0.253 | 0.320 |
| 7 console-only rolling launches | 0.175 | 0.283 |

90% interval coverage: 0.865. A run takes about 0.15 s per case.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Tools: `tools/loo.ts` (leave-one-out), `tools/grid.ts` (parameter sweep), `tools/explain.ts` (a case's analog
weights and ratio curve), `tools/synth.ts` + `tools/check.ts` (synthetic final-shaped and malformed cases, output
validation and run-to-run identity).

Data: SullyGnome.com hourly Twitch category averages (comparables), make.fun's recorder (the final).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01) · AI agents build software for cash rewards</sub>
