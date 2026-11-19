# makefun-token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/zxpast/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/zxpast/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks 201 pre-token protocols by the market cap a launch would
imply, with farm verdicts, nearest-comps and a backtest in reader units.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
# then open out/dashboard/index.html
```

## What it does

The snapshot (14 Nov 2026, 758 protocols) is the only input. The model is a
log-log size law fitted on the 119 protocols that already record a token
(`log10(market cap) = 3.3823 + 0.4721 · log10(TVL)`), plus three legs
the blind test kept, each at half strength: a shrunk *median* sector residual
(k = 20, capped at ±0.30 dex), seven-day momentum (weight 0.6 — spikes
mean-revert), and age & chains (maturity 0.65 → 1.00 over 1,460 days, +2% per
extra chain to +10%).

Round 5 changes over round 4:

1. **Coverage.** The board ranks every standalone pre-token protocol —
   201 rows, not 178. The watchlist's $50M floor no longer hides the
   biggest pre-token protocols (sentora-curator $2.76B, polymarket $320M,
   cian $280M). The whole 758 is accounted for: 201 ranked, 128 with a
   token, 199 set aside by category, 52 versioned names, 6 wrapped/staked
   names, 0 exchange names, 172 kin of a token.
2. **Farm verdicts.** Every row carries FARM / THIN / SKIP and a net dollar
   figure at $1,000 over 60 days, with break-even deposit and break-even
   drop share, plus step-by-step farming instructions and what-if controls.
3. **Board-first.** Screenshot 0 is the board with the KPI strip; the model
   essay is a section, not the cover.
4. **Backtest in reader units.** Leave-one-out and older → newer, reported
   as median miss and within-3×, per step, on the board page and in the
   dossier.
5. **Sector leg.** Shrunk median (k = 20, ±0.30 dex cap) — a small honest
   win on the blind test; the mean variant and raw category multiples lose
   and are not used.
6. **Launch odds.** The share of protocols that record a token, by age and
   by category — labelled a cross-sectional share, not a forward forecast.

## Validation (shipped model, leave-one-out on 119 live protocols)

- LOO RMSE 0.9070 dex, median miss ×3.38, within-3× 47%,
  R² out of sample 0.113, Spearman 0.376.
- Repeated 5-fold (seeds 0, 1, 2): 0.9157 dex mean.
- Older → newer (train on the earliest-listed 80%, test on the latest 20%):
  RMSE 1.0263 dex, median miss ×6.40, within-3× 29% —
  mixed, as it should be on 24 test rows; the model is a ranking improvement
  with unproven time stability, and the board says so.

## Files

- `main.ts` — entrypoint: reads the snapshot, writes `board.json`,
  `data.js`, the dashboard, the screenshots and `dossier.json`.
- `lib/model.ts` — the model: live set, fit, sector table, board, farm
  math, backtest, accounting.
- `dashboard/` — the board (`index.html`, `app.css`, `app.js`).
- `vendor/makefun-board.ts` — the scorer's dossier builder (untouched).

---

<sub>Entered on [make.fun](https://make.fun/?ref=6hmpy1rq&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
