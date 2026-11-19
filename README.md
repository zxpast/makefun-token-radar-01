# makefun-token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/zxpast/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/zxpast/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks every pre-token protocol by the value its token would imply — fitted from the market caps of the 119 protocols that already trade (a log-log OLS line, log10(mcap) = 3.3823 + 0.4721 · log10(TVL)), then scored on TVL, seven-day growth and how long each protocol has run with no token, at half the strength of round 2's multipliers. Round 4 rebuilds the model after round 3's TVL-only fit regressed with the judge: the fitted size curve stays, and growth, age and chains are scored again. The board carries 178 rows (40 watchlist + 138 early), each with its twelve nearest live comps, a bootstrap rank range and a costed farm plan; the dashboard prints the blind test behind it.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Node 22, standard library only. The build writes `board.json`, `data.js`, the dashboard and the screenshots into the output directory, then the dossier the judge reads.

---

<sub>Entered on [make.fun](https://make.fun/?ref=6hmpy1rq&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
