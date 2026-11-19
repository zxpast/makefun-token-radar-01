# Token Radar — round 3

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/zxpast/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/zxpast/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A fitted implied value for pre-token protocols, from the sealed snapshot's own
live-token protocols. Round 3 ("radar-3") replaces the round 1/2 flat multiple
with a log-log power law (elasticity ≈ 0.47, refit from the snapshot on every
run) blended 0.7 / 0.3 with 12 nearest live comps, same category first.

## What the entry proves, on its own dashboard

- Leave-one-out by brute-force refit (held-out row excluded from every fitted
  quantity, including the kNN pool) plus repeated 5-fold cross-validation.
- A walk-forward cut by listing age, both cuts shown including the unfavourable one.
- Terms the blind test drops (growth, age, chain count, category dummies),
  shown with their own leave-one-out numbers.
- Rank ranges from 200 bootstrap refits per row, and the 12 comps behind
  every row's value.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22+, standard library only. No network at run time. The run is
deterministic: the same snapshot always writes the same bytes.

---

<sub>Entered on [make.fun](https://make.fun/?ref=6hmpy1rq&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
