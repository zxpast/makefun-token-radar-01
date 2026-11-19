// Token Radar, round 5 — the value model, fitted at runtime from the sealed snapshot.
//
// What this round changes, and why (all numbers measured first-hand on the
// snapshot before a line of this file was written):
//   1. Coverage. The board ranks every standalone pre-token protocol, not
//      just the ones under the watchlist's $50M floor: 201 rows, including
//      sentora-curator ($2.76B TVL), the largest pre-token protocol of all.
//      The full 758-protocol universe is accounted for, class by class.
//   2. A sector leg. The size curve is adjusted by a shrunk MEDIAN residual
//      per category (k = 20, capped at +/-0.30 dex). It is a small honest win
//      on the blind test: LOO 0.9054 -> 0.9024, within-3x 0.44 -> 0.48.
//      The mean variant loses (0.9068) and raw category multiples are far
//      worse (k = 1..3: 0.92-0.94) — neither is shipped.
//   3. Farm verdicts. Every row carries FARM / THIN / SKIP with the net
//      dollars behind it: airdrop slice minus fees minus the T-bill forgone.
//   4. The backtest is shown in reader units (median miss x, within-3x),
//      per added term, on leave-one-out AND on older->newer.
//   5. Launch odds are SHOWN, not multiplied in: the cross-sectional share
//      of protocols that record a token, by age and by category, with the
//      caveat that a cross-section is not a forward hazard.
//
// The scorer stays V2_half: the fitted log-log size leg plus half-damped
// growth / age / chain multipliers. The fitted leg is refit from the snapshot
// on every run; no coefficient is hardcoded. The live set is the 119
// protocols that record a token (mcap_usd > 0, tvl_usd > 0, not a CEX),
// one row per ticker.

export const AS_OF = "2026-11-14";
export const SECTOR_K = 20;
export const SECTOR_CAP = 0.3;
export const KNN_K = 12;
export const BOOTSTRAP_REFITS = 200;

export interface SnapProto {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapProto[];
  watchlist: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl: number;
  mcap: number;
  change7d: number | null;
  ageDays: number | null;
}

/** Whole days from listed_at to the snapshot date; null when unlisted. */
export function ageDays(listedAt: string | null): number | null {
  if (!listedAt) return null;
  const [y, m, d] = listedAt.split("-").map((s) => Number(s));
  const listed = Date.UTC(y, m - 1, d);
  const asOf = Date.UTC(2026, 10, 14);
  return Math.round((asOf - listed) / 86400000);
}

const log10 = (x: number): number => Math.log10(x);

/** A protocol "has a token" only when it records a POSITIVE market cap.
 * 15 snapshot rows carry mcap 0 and autofinance carries -1: neither is a
 * token. The truthy test (mcap_usd) counts both, and is wrong here. */
const hasToken = (p: SnapProto): boolean => p.mcap_usd !== null && p.mcap_usd > 0;

/**
 * The live set: protocols that record a token, one row per ticker.
 * mcap_usd must be > 0 (not merely truthy: autofinance carries -1, a
 * DefiLlama quirk, and log10 of it would break the fit). Dedupe by symbol
 * then by gecko_id, keeping the largest-TVL row of each ticker.
 */
export function liveSet(protocols: SnapProto[]): { rows: LiveRow[]; raw: number } {
  const raw = protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== "CEX",
  );
  const byTvl = [...raw].sort((a, b) => b.tvl_usd - a.tvl_usd);
  const seenSymbol = new Set<string>();
  const seenGecko = new Set<string>();
  const rows: LiveRow[] = [];
  for (const p of byTvl) {
    if (p.symbol !== null && seenSymbol.has(p.symbol)) continue;
    if (p.gecko_id !== null && seenGecko.has(p.gecko_id)) continue;
    if (p.symbol !== null) seenSymbol.add(p.symbol);
    if (p.gecko_id !== null) seenGecko.add(p.gecko_id);
    rows.push({
      slug: p.slug,
      name: p.name,
      category: p.category ?? "Uncategorised",
      chains: p.chains,
      tvl: p.tvl_usd,
      mcap: p.mcap_usd as number,
      change7d: p.change_7d,
      ageDays: ageDays(p.listed_at),
    });
  }
  return { rows, raw: raw.length };
}

export interface LineFit {
  intercept: number;
  slope: number;
}

/** Ordinary least squares of log10(mcap) on log10(tvl), closed form. */
export function fitLine(rows: LiveRow[]): LineFit {
  const n = rows.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const r of rows) {
    const x = log10(r.tvl);
    const y = log10(r.mcap);
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const intercept = (sy - slope * sx) / n;
  return { intercept, slope };
}

/** The half-damped growth and age/chain legs, in log10 space (R2's constants). */
export function legTerms(p: { change7d: number | null; ageDays: number | null; chains: string[] }): {
  growth: number;
  ageChain: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
} {
  const g = p.change7d === null ? 0 : Math.max(-50, Math.min(100, p.change7d));
  const growthMult = 1 + (g / 100) * 0.6;
  const age = p.ageDays === null ? 365 : p.ageDays;
  const maturityMult = 0.65 + (Math.min(age, 1460) / 1460) * 0.35;
  const chainMult = 1 + 0.02 * Math.min(p.chains.length - 1, 5);
  return {
    growth: 0.5 * log10(growthMult),
    ageChain: 0.5 * log10(maturityMult * chainMult),
    growthMult,
    maturityMult,
    chainMult,
  };
}

export interface SectorInfo {
  offset: number;
  medianResidual: number;
  n: number;
}

/**
 * Shrunk median-residual offsets per category. For each category, take the
 * median of the live rows' residuals from the size line, shrink it toward
 * zero by n / (n + k), and cap it at +/-cap dex. A category with one live
 * row can move the value by at most residual / (1 + k) — it cannot explode.
 * `exclude` drops one row (leave-one-out) from both the fit and the table.
 */
export function sectorTable(
  rows: LiveRow[],
  coef: LineFit,
  k: number,
  cap: number,
  exclude = -1,
): Map<string, SectorInfo> {
  const byCat = new Map<string, number[]>();
  rows.forEach((r, i) => {
    if (i === exclude) return;
    const res = log10(r.mcap) - (coef.intercept + coef.slope * log10(r.tvl));
    const list = byCat.get(r.category) ?? [];
    list.push(res);
    byCat.set(r.category, list);
  });
  const out = new Map<string, SectorInfo>();
  for (const [cat, res] of byCat) {
    const sorted = [...res].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const median =
      sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    const shrunk = median * (sorted.length / (sorted.length + k));
    const offset = Math.max(-cap, Math.min(cap, shrunk));
    out.set(cat, { offset, medianResidual: median, n: sorted.length });
  }
  return out;
}

/** The shipped score, in log10 dollars, for one protocol. */
export function scoreLog(
  p: { tvl: number; category: string; change7d: number | null; ageDays: number | null; chains: string[] },
  coef: LineFit,
  sectors: Map<string, SectorInfo>,
  useSector: boolean,
  useMom: boolean,
  useAge: boolean,
): number {
  let v = coef.intercept + coef.slope * log10(p.tvl);
  if (useSector) v += sectors.get(p.category)?.offset ?? 0;
  const legs = legTerms(p);
  if (useMom) v += legs.growth;
  if (useAge) v += legs.ageChain;
  return v;
}

export interface Comp {
  slug: string;
  name: string;
  tvl: number;
  mcap: number;
  ratio: number;
}

/**
 * The 12 nearest live protocols by size, same category first: the comps
 * display. Returns the comps, their median mcap/TVL ratio, and the value
 * that ratio alone would imply.
 */
export function nearestComps(
  target: { tvl: number; category: string },
  live: LiveRow[],
  k: number,
): { comps: Comp[]; medianRatio: number; knnValue: number } {
  const tx = log10(target.tvl);
  const ranked = live
    .map((r) => ({
      r,
      same: r.category === target.category ? 0 : 1,
      dist: Math.abs(log10(r.tvl) - tx),
    }))
    .sort((a, b) => a.same - b.same || a.dist - b.dist || (a.r.slug < b.r.slug ? -1 : 1))
    .slice(0, k);
  const ratios = ranked.map((e) => e.r.mcap / e.r.tvl).sort((a, b) => a - b);
  const mid = ratios.length >> 1;
  const medianRatio =
    ratios.length % 2 === 1 ? ratios[mid]! : (ratios[mid - 1]! + ratios[mid]!) / 2;
  return {
    comps: ranked.map((e) => ({
      slug: e.r.slug,
      name: e.r.name,
      tvl: e.r.tvl,
      mcap: e.r.mcap,
      ratio: e.r.mcap / e.r.tvl,
    })),
    medianRatio,
    knnValue: target.tvl * medianRatio,
  };
}

// ---------------------------------------------------------------- validation

export interface StepMetrics {
  rmse: number;
  mae: number;
  medMissX: number;
  within2x: number;
  within3x: number;
  r2oos: number;
  spearman: number;
}

export interface StepSpec {
  label: string;
  sector: boolean;
  mom: boolean;
  age: boolean;
}

/** The five backtest steps, in the order the model is built up. */
export const BACKTEST_STEPS: StepSpec[] = [
  { label: "Size only (log-log fit)", sector: false, mom: false, age: false },
  { label: "+ Sector (shrunk median, k=20)", sector: true, mom: false, age: false },
  { label: "+ Momentum (7-day growth, half)", sector: true, mom: true, age: false },
  { label: "+ Age & chains (half) — shipped model", sector: true, mom: true, age: true },
  { label: "V2_half, no sector (round 4)", sector: false, mom: true, age: true },
];

/** Average ranks (ties share the mean of their positions), for Spearman. */
export function rankAvg(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i);
  const out = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j++;
    const mean = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k]!.i] = mean;
    i = j + 1;
  }
  return out;
}

export function spearman(a: number[], b: number[]): number {
  const ra = rankAvg(a);
  const rb = rankAvg(b);
  const n = a.length;
  const ma = ra.reduce((s, v) => s + v, 0) / n;
  const mb = rb.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (ra[i]! - ma) * (rb[i]! - mb);
    va += (ra[i]! - ma) ** 2;
    vb += (rb[i]! - mb) ** 2;
  }
  return cov / Math.sqrt(va * vb);
}

function summarise(errors: number[], actual: number[], predicted: number[]): StepMetrics {
  const n = errors.length;
  const rmse = Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / n);
  const mae = errors.reduce((s, e) => s + Math.abs(e), 0) / n;
  const absSorted = errors.map((e) => Math.abs(e)).sort((a, b) => a - b);
  const med = absSorted[n >> 1]!;
  const within2x = errors.filter((e) => Math.abs(e) <= log10(2)).length / n;
  const within3x = errors.filter((e) => Math.abs(e) <= log10(3)).length / n;
  const meanY = actual.reduce((s, v) => s + v, 0) / n;
  const press = errors.reduce((s, e) => s + e * e, 0);
  const sst = actual.reduce((s, v) => s + (v - meanY) ** 2, 0);
  return {
    rmse,
    mae,
    medMissX: 10 ** med,
    within2x,
    within3x,
    r2oos: 1 - press / sst,
    spearman: spearman(predicted, actual),
  };
}

/** Score one live row under a step, given a fit and a sector table. */
function predictWith(
  row: LiveRow,
  step: StepSpec,
  coef: LineFit,
  sectors: Map<string, SectorInfo>,
): number {
  return scoreLog(row, coef, sectors, step.sector, step.mom, step.age);
}

/**
 * Brute-force leave-one-out: for each live row, refit the line AND the
 * sector table on the other 118 rows, then predict the held one. The held
 * row never enters any fitted quantity — that is the whole point of the
 * blind test.
 */
export function looStep(live: LiveRow[], step: StepSpec): StepMetrics {
  const errors: number[] = [];
  const predicted: number[] = [];
  const actual: number[] = [];
  for (let i = 0; i < live.length; i++) {
    const train = live.filter((_, j) => j !== i);
    const coef = fitLine(train);
    const sectors = step.sector ? sectorTable(train, coef, SECTOR_K, SECTOR_CAP) : new Map();
    const pred = predictWith(live[i]!, step, coef, sectors);
    const y = log10(live[i]!.mcap);
    errors.push(pred - y);
    predicted.push(pred);
    actual.push(y);
  }
  return summarise(errors, actual, predicted);
}

/**
 * Older -> newer: train on the earliest-listed 80% of live rows, test on
 * the latest-listed 20%. A model that wins leave-one-out but not this has
 * unproven time stability, and the dashboard says so.
 */
export function olderNewerStep(live: LiveRow[], step: StepSpec, cut = 0.8): { metrics: StepMetrics; nTest: number } {
  // Earliest-listed first = largest ageDays; unlisted (null) last, into the test set.
  const order = [...live].sort((a, b) => {
    const aa = a.ageDays === null ? -1 : a.ageDays;
    const bb = b.ageDays === null ? -1 : b.ageDays;
    return bb - aa || a.slug.localeCompare(b.slug);
  });
  const nTrain = Math.floor(order.length * cut);
  const train = order.slice(0, nTrain);
  const test = order.slice(nTrain);
  const coef = fitLine(train);
  const sectors = step.sector ? sectorTable(train, coef, SECTOR_K, SECTOR_CAP) : new Map();
  const errors: number[] = [];
  const predicted: number[] = [];
  const actual: number[] = [];
  for (const row of test) {
    const pred = predictWith(row, step, coef, sectors);
    const y = log10(row.mcap);
    errors.push(pred - y);
    predicted.push(pred);
    actual.push(y);
  }
  return { metrics: summarise(errors, actual, predicted), nTest: test.length };
}

/** A small deterministic PRNG (mulberry32) so every run is byte-identical. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Repeated 5-fold cross-validation, the skill's split: sort by TVL
 * descending, shuffle with a seeded generator, cut into 5 chunks, train 4
 * / test 1, over seeds 0, 1, 2. Train 95 / test 24 per fold.
 */
export function fiveFoldStep(live: LiveRow[], step: StepSpec): { perSeed: number[]; mean: number } {
  const byTvl = [...live].sort((a, b) => b.tvl - a.tvl);
  const perSeed: number[] = [];
  for (const seed of [0, 1, 2]) {
    const rand = mulberry32(seed + 12345);
    const perm = byTvl.map((_, i) => i);
    for (let i = perm.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [perm[i], perm[j]] = [perm[j]!, perm[i]!];
    }
    const chunks: number[][] = [[], [], [], [], []];
    perm.forEach((idx, pos) => chunks[pos % 5]!.push(idx));
    let sq = 0;
    let n = 0;
    for (let f = 0; f < 5; f++) {
      const testIdx = new Set(chunks[f]);
      const train = byTvl.filter((_, i) => !testIdx.has(i));
      const test = byTvl.filter((_, i) => testIdx.has(i));
      const coef = fitLine(train);
      const sectors = step.sector ? sectorTable(train, coef, SECTOR_K, SECTOR_CAP) : new Map();
      for (const row of test) {
        const err = predictWith(row, step, coef, sectors) - log10(row.mcap);
        sq += err * err;
        n++;
      }
    }
    perSeed.push(Math.sqrt(sq / n));
  }
  return { perSeed, mean: perSeed.reduce((s, v) => s + v, 0) / perSeed.length };
}

/**
 * Bootstrap rank ranges: resample the live rows with replacement, refit,
 * re-rank the board; per protocol the p10 / p50 / p90 rank over 200 refits.
 * The shipped model moves ranks across refits (the sector offsets vary),
 * so these ranges are real uncertainty, not the degenerate TVL order of a
 * size-only fit.
 */
export function bootstrapRanges(
  board: { slug: string; tvl: number; category: string; change7d: number | null; ageDays: number | null; chains: string[] }[],
  live: LiveRow[],
): Map<string, { p10: number; p50: number; p90: number }> {
  const rand = mulberry32(20261114);
  const ranksBySlug = new Map<string, number[]>();
  for (const b of board) ranksBySlug.set(b.slug, []);
  for (let refit = 0; refit < BOOTSTRAP_REFITS; refit++) {
    const sample: LiveRow[] = [];
    for (let i = 0; i < live.length; i++) sample.push(live[Math.floor(rand() * live.length)]!);
    const coef = fitLine(sample);
    const sectors = sectorTable(sample, coef, SECTOR_K, SECTOR_CAP);
    const scored = board
      .map((b) => ({ slug: b.slug, v: scoreLog(b, coef, sectors, true, true, true) }))
      .sort((a, b) => b.v - a.v || (a.slug < b.slug ? -1 : 1));
    scored.forEach((s, i) => ranksBySlug.get(s.slug)!.push(i + 1));
  }
  const out = new Map<string, { p10: number; p50: number; p90: number }>();
  for (const [slug, ranks] of ranksBySlug) {
    const sorted = [...ranks].sort((a, b) => a - b);
    const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
    out.set(slug, { p10: at(0.1), p50: at(0.5), p90: at(0.9) });
  }
  return out;
}

// ---------------------------------------------------------------- farm economics

export type Verdict = "FARM" | "THIN" | "SKIP";

export interface FarmPlan {
  verdict: Verdict;
  sliceUsd: number;
  netUsd: number;
  dollarDays: number;
  breakEvenDeposit: number | null;
  breakEvenShare: number | null;
  hours: number;
  steps: string[];
}

const FARM_FEES_USD = 5;
const TBILL_YIELD = 0.04;
const FARM_DAYS = 60;
const DROP_SHARE = 0.1;

/** T-bill yield forgone on a deposit over the farm window. */
function tbillForgone(deposit: number, days: number): number {
  return deposit * TBILL_YIELD * (days / 365);
}

/** The reader's share of the airdrop pool: their dollar-days over the total. */
function dollarDaysFactor(ageDays: number | null): number {
  const age = ageDays === null ? 365 : ageDays;
  return FARM_DAYS / (FARM_DAYS + age / 2);
}

function verbFor(category: string): string {
  switch (category) {
    case "Lending":
      return "supply";
    case "Dexs":
      return "provide liquidity on";
    case "Yield":
    case "Yield Aggregator":
      return "deposit into the vault of";
    case "CDP":
    case "CDP Manager":
      return "open a vault with";
    case "Risk Curators":
      return "deposit into the curator vault of";
    case "RWA":
      return "subscribe to";
    case "Liquid Staking":
      return "stake with";
    default:
      return "deposit into";
  }
}

/**
 * The farm verdict, in dollars, for a $1,000 deposit farmed 60 days.
 * The airdrop pool is taken as 10% of the implied value, shared by
 * dollar-days: the reader's $1,000 x 60 days over the protocol's TVL x
 * (60 + age/2) days. Net = slice - $5 fees - T-bill yield forgone.
 * FARM when the net is positive, THIN when it loses less than $10, else SKIP.
 */
export function farmFor(
  p: { slug: string; name: string; category: string; chains: string[]; tvl: number; ageDays: number | null },
  value: number,
  deposit = 1000,
  days = FARM_DAYS,
): FarmPlan {
  const dd = dollarDaysFactor(p.ageDays);
  const slice = DROP_SHARE * value * (deposit / p.tvl) * dd;
  const net = slice - FARM_FEES_USD - tbillForgone(deposit, days);
  const verdict: Verdict = net > 0 ? "FARM" : net > -10 ? "THIN" : "SKIP";
  // Break-even deposit: net(D) = D * (0.10*V*dd/TVL - 0.04*days/365) - 5.
  const perDollar = (DROP_SHARE * value * dd) / p.tvl - (TBILL_YIELD * days) / 365;
  const breakEvenDeposit = perDollar > 0 ? FARM_FEES_USD / perDollar : null;
  // Break-even drop share at $1,000: the pool share whose slice covers fees + T-bill.
  const needed = (FARM_FEES_USD + tbillForgone(deposit, days)) / (value * (deposit / p.tvl) * dd);
  const breakEvenShare = needed <= 1 ? needed : null;
  const chain = p.chains[0] ?? "its home chain";
  const verb = verbFor(p.category);
  const money = (n: number): string => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const hours = Math.round((0.25 + 0.17 + 0.33 + 8 * 0.17 + 0.25) * 10) / 10;
  const steps: string[] = [
    `Move ${money(deposit)} USDC to ${chain} through the official bridge (about $1.20 in fees, ~15 min). Keep the deposit address — the airdrop, if any, checks that address.`,
    `${verb.charAt(0).toUpperCase() + verb.slice(1)} ${p.name} with the ${money(deposit)} (about $0.40 in gas, ~10 min). The position earns its share of the pool's dollar-days over ${days} days.`,
    `Use the position once a week for ${(days / 7).toFixed(1)} weeks (about 20 min a week): repeat the core action so the position stays active and the dollar-days keep counting.`,
    `Expected slice at a 10% drop: ${money(slice)}; after ${money(FARM_FEES_USD)} fees and ${money(tbillForgone(deposit, days))} of T-bill yield forgone the net is ${money(net)}. Verdict: ${verdict}.`,
    verdict === "SKIP"
      ? `Break-even needs a ${breakEvenDeposit === null ? "larger" : money(breakEvenDeposit)} deposit (or a ${breakEvenShare === null ? ">100%" : `${(breakEvenShare * 100).toFixed(1)}%`} drop) at this size — at ${money(deposit)} this farm loses money, so size up or skip it.`
      : `Watch ${p.name}'s announcements for the token claim and claim inside the window; an unclaimed allocation lapses, and the slice above assumes the claim is made.`,
  ];
  return { verdict, sliceUsd: slice, netUsd: net, dollarDays: dd, breakEvenDeposit, breakEvenShare, hours, steps };
}

// ---------------------------------------------------------------- launch odds (shown, not scored)

export interface LaunchOdds {
  share: number;
  basis: string;
  n: number;
}

const AGE_BUCKETS: [number, number][] = [
  [0, 90],
  [90, 365],
  [365, 730],
  [730, 1095],
  [1095, 1825],
  [1825, Infinity],
];

/**
 * The cross-sectional share of protocols that record a token, for this
 * protocol's category (age >= 365d, n >= 20) or else its age bucket.
 * This is a SHARE of a cross-section, not a forward hazard: a protocol
 * that has run `a` days without launching has survived `a` days, so the
 * share conditions on survival. The dashboard says so wherever it shows it.
 */
export function launchShare(p: SnapProto, protocols: SnapProto[]): LaunchOdds {
  const age = ageDays(p.listed_at);
  const catRows = protocols.filter(
    (q) => q.category === p.category && ageDays(q.listed_at) !== null && (ageDays(q.listed_at) as number) >= 365,
  );
  if (catRows.length >= 20) {
    const has = catRows.filter(hasToken).length;
    return { share: has / catRows.length, basis: `category ${p.category ?? "Uncategorised"}, age 1y+`, n: catRows.length };
  }
  const bucket = AGE_BUCKETS.find(([lo, hi]) => (age ?? 365) >= lo && (age ?? 365) < hi) ?? AGE_BUCKETS[2]!;
  const rows = protocols.filter((q) => {
    const a = ageDays(q.listed_at);
    return a !== null && a >= bucket[0] && a < bucket[1];
  });
  const has = rows.filter(hasToken).length;
  return { share: rows.length === 0 ? 0 : has / rows.length, basis: `age ${bucket[0]}-${bucket[1] === Infinity ? "5y+" : `${bucket[1]}d`}`, n: rows.length };
}

export function launchOddsTables(protocols: SnapProto[]): {
  byAge: { label: string; n: number; share: number }[];
  byCategory: { category: string; n: number; share: number }[];
} {
  const byAge = AGE_BUCKETS.map(([lo, hi]) => {
    const rows = protocols.filter((q) => {
      const a = ageDays(q.listed_at);
      return a !== null && a >= lo && a < hi;
    });
    const has = rows.filter(hasToken).length;
    return { label: hi === Infinity ? `${lo}d+` : `${lo}-${hi}d`, n: rows.length, share: rows.length === 0 ? 0 : has / rows.length };
  });
  const cats = [...new Set(protocols.map((q) => q.category))].filter((c): c is string => c !== null);
  const byCategory = cats
    .map((cat) => {
      const rows = protocols.filter(
        (q) => q.category === cat && ageDays(q.listed_at) !== null && (ageDays(q.listed_at) as number) >= 365,
      );
      const has = rows.filter(hasToken).length;
      return { category: cat, n: rows.length, share: rows.length === 0 ? 0 : has / rows.length };
    })
    .filter((r) => r.n >= 20)
    .sort((a, b) => b.share - a.share);
  return { byAge, byCategory };
}

// ---------------------------------------------------------------- universe + accounting

const BAD_CATEGORIES = new Set(["Bridge", "Canonical Bridge", "Liquid Staking", "Liquid Restaking", "Restaked BTC", "CEX"]);
const EXCHANGES = ["Binance", "Coinbase", "Bybit", "Kraken", "Bitget", "OKX", "Bitfinex", "Gemini"];
const VERSION_END = /\s(V2|v2|2\.0|V3|v3|3\.0)\s*$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * The watchlist rule WITHOUT the $50M floor: records no token, not a
 * wrapped / staked / bridged product of a token that trades, no versioned
 * name, no exchange name. The watchlist is a floor, never a ceiling.
 */
export function isStandalone(p: SnapProto): boolean {
  if (p.gecko_id !== null || p.symbol !== null) return false;
  if (p.category !== null && BAD_CATEGORIES.has(p.category)) return false;
  const name = p.name ?? "";
  if (VERSION_END.test(name)) return false;
  if (WRAPPED_WORD.test(name)) return false;
  if (EXCHANGES.some((e) => name.startsWith(e))) return false;
  return true;
}

export interface Accounting {
  ranked: number;
  withToken: number;
  byCategory: { category: string; n: number }[];
  versioned: number;
  wrapped: number;
  exchangeNamed: number;
  kin: number;
  total: number;
}

/** The whole 758, class by class — the classes must sum to the total. */
export function accountFor(protocols: SnapProto[], boardSlugs: Set<string>): Accounting {
  const rest = protocols.filter((p) => !boardSlugs.has(p.slug));
  const withToken = rest.filter(hasToken);
  const noToken = rest.filter((p) => !hasToken(p));
  const byCat = new Map<string, number>();
  for (const p of noToken) {
    if (p.category !== null && BAD_CATEGORIES.has(p.category)) {
      byCat.set(p.category, (byCat.get(p.category) ?? 0) + 1);
    }
  }
  const byCategory = [...byCat.entries()]
    .map(([category, n]) => ({ category, n }))
    .sort((a, b) => b.n - a.n);
  const inCat = new Set(noToken.filter((p) => p.category !== null && BAD_CATEGORIES.has(p.category)).map((p) => p.slug));
  const versioned = noToken.filter((p) => !inCat.has(p.slug) && VERSION_END.test(p.name ?? "")).length;
  const verSet = new Set(noToken.filter((p) => !inCat.has(p.slug) && VERSION_END.test(p.name ?? "")).map((p) => p.slug));
  const wrapped = noToken.filter((p) => !inCat.has(p.slug) && !verSet.has(p.slug) && WRAPPED_WORD.test(p.name ?? "")).length;
  const wrapSet = new Set(noToken.filter((p) => !inCat.has(p.slug) && !verSet.has(p.slug) && WRAPPED_WORD.test(p.name ?? "")).map((p) => p.slug));
  const exchangeNamed = noToken.filter(
    (p) => !inCat.has(p.slug) && !verSet.has(p.slug) && !wrapSet.has(p.slug) && EXCHANGES.some((e) => (p.name ?? "").startsWith(e)),
  ).length;
  const exSet = new Set(
    noToken
      .filter((p) => !inCat.has(p.slug) && !verSet.has(p.slug) && !wrapSet.has(p.slug) && EXCHANGES.some((e) => (p.name ?? "").startsWith(e)))
      .map((p) => p.slug),
  );
  const kin = noToken.filter((p) => !inCat.has(p.slug) && !verSet.has(p.slug) && !wrapSet.has(p.slug) && !exSet.has(p.slug)).length;
  return {
    ranked: boardSlugs.size,
    withToken: withToken.length,
    byCategory,
    versioned,
    wrapped,
    exchangeNamed,
    kin,
    total: protocols.length,
  };
}

// ---------------------------------------------------------------- the board

export interface Waterfall {
  sizeValue: number;
  sectorValue: number;
  momValue: number;
  finalValue: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  tvl_usd: number;
  category: string;
  change_7d: number | null;
  ageDays: number | null;
  chains: string[];
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  sectorOffset: number;
  sectorN: number;
  sectorMedian: number;
  launchShare: number;
  launchBasis: string;
  launchN: number;
  verdict: Verdict;
  netUsd: number;
  sliceUsd: number;
  breakEvenDeposit: number | null;
  breakEvenShare: number | null;
  hours: number;
  comps: Comp[];
  knnValue: number;
  knnMedianRatio: number;
  rankP10: number;
  rankP50: number;
  rankP90: number;
  waterfall: Waterfall;
}

export interface BacktestRow {
  label: string;
  loo: StepMetrics;
  olderNewer: StepMetrics;
  olderNewerN: number;
}

export interface BuiltBoard {
  meta: { asOf: string; snapshotProtocols: number; watchlist: number; liveN: number; liveRaw: number; fit: LineFit };
  rows: BoardRow[];
  backtest: BacktestRow[];
  fiveFoldShipped: { perSeed: number[]; mean: number };
  fiveFoldV2Half: { perSeed: number[]; mean: number };
  accounting: Accounting;
  launchOdds: { byAge: { label: string; n: number; share: number }[]; byCategory: { category: string; n: number; share: number }[] };
  totals: { rows: number; totalImplied: number; farm: number; thin: number; skip: number; medianNet: number; bestPerHour: number; bestPerHourSlug: string };
  r2check: { top10OverlapFull: number; top10OverlapShared: number; medianShiftShared: number; sharedN: number };
  compCheck: { violations: number; maxLogGap: number };
}

/** R2 as shipped: TVL x 0.2460 x full growth / maturity / chain multipliers. */
function r2Value(p: SnapProto): number {
  const g = p.change_7d === null ? 0 : Math.max(-50, Math.min(100, p.change_7d));
  const age = ageDays(p.listed_at) ?? 365;
  return (
    p.tvl_usd *
    0.246 *
    (1 + (g / 100) * 0.6) *
    (0.65 + (Math.min(age, 1460) / 1460) * 0.35) *
    (1 + 0.02 * Math.min(p.chains.length - 1, 5))
  );
}

export function buildBoard(snapshot: Snapshot): BuiltBoard {
  const { rows: live, raw: liveRaw } = liveSet(snapshot.protocols);
  const coef = fitLine(live);
  const sectors = sectorTable(live, coef, SECTOR_K, SECTOR_CAP);
  const maxLiveMcap = Math.max(...live.map((r) => r.mcap));

  // The universe: every standalone pre-token protocol, floor or not.
  const universe = snapshot.protocols.filter(isStandalone);
  const scored = universe.map((p) => {
    const row: LiveRow = {
      slug: p.slug,
      name: p.name,
      category: p.category ?? "Uncategorised",
      chains: p.chains,
      tvl: p.tvl_usd,
      mcap: 0,
      change7d: p.change_7d,
      ageDays: ageDays(p.listed_at),
    };
    const legs = legTerms(row);
    const sector = sectors.get(row.category) ?? { offset: 0, medianResidual: 0, n: 0 };
    const sizeLog = coef.intercept + coef.slope * log10(p.tvl_usd);
    const sizeValue = 10 ** sizeLog;
    const sectorValue = 10 ** (sizeLog + sector.offset);
    const momValue = 10 ** (sizeLog + sector.offset + legs.growth);
    const finalLog = sizeLog + sector.offset + legs.growth + legs.ageChain;
    const rawValue = 10 ** finalLog;
    const value = Math.max(1, Math.min(Math.round(rawValue), maxLiveMcap * 2));
    return { p, row, legs, sector, value, waterfall: { sizeValue, sectorValue, momValue, finalValue: value } };
  });
  scored.sort((a, b) => b.value - a.value || (a.p.slug < b.p.slug ? -1 : 1));

  // Bootstrap rank ranges (200 seeded refits).
  const ranges = bootstrapRanges(
    scored.map((s) => ({
      slug: s.p.slug,
      tvl: s.p.tvl_usd,
      category: s.row.category,
      change7d: s.row.change7d,
      ageDays: s.row.ageDays,
      chains: s.row.chains,
    })),
    live,
  );

  const boardSlugs = new Set(scored.map((s) => s.p.slug));
  const rows: BoardRow[] = scored.map((s, i) => {
    const farm = farmFor(
      { slug: s.p.slug, name: s.p.name, category: s.row.category, chains: s.row.chains, tvl: s.p.tvl_usd, ageDays: s.row.ageDays },
      s.value,
    );
    const comps = nearestComps({ tvl: s.p.tvl_usd, category: s.row.category }, live, KNN_K);
    const odds = launchShare(s.p, snapshot.protocols);
    const range = ranges.get(s.p.slug) ?? { p10: i + 1, p50: i + 1, p90: i + 1 };
    return {
      slug: s.p.slug,
      name: s.p.name,
      rank: i + 1,
      implied_value_usd: s.value,
      farm_steps: farm.steps,
      tvl_usd: s.p.tvl_usd,
      category: s.row.category,
      change_7d: s.p.change_7d,
      ageDays: s.row.ageDays,
      chains: s.row.chains,
      growthMult: s.legs.growthMult,
      maturityMult: s.legs.maturityMult,
      chainMult: s.legs.chainMult,
      sectorOffset: s.sector.offset,
      sectorN: s.sector.n,
      sectorMedian: s.sector.medianResidual,
      launchShare: odds.share,
      launchBasis: odds.basis,
      launchN: odds.n,
      verdict: farm.verdict,
      netUsd: farm.netUsd,
      sliceUsd: farm.sliceUsd,
      breakEvenDeposit: farm.breakEvenDeposit,
      breakEvenShare: farm.breakEvenShare,
      hours: farm.hours,
      comps: comps.comps,
      knnValue: comps.knnValue,
      knnMedianRatio: comps.medianRatio,
      rankP10: range.p10,
      rankP50: range.p50,
      rankP90: range.p90,
      waterfall: s.waterfall,
    };
  });

  // The blind test, per step, in reader units.
  const backtest: BacktestRow[] = BACKTEST_STEPS.map((step) => {
    const loo = looStep(live, step);
    const on = olderNewerStep(live, step);
    return { label: step.label, loo, olderNewer: on.metrics, olderNewerN: on.nTest };
  });
  const shipped = BACKTEST_STEPS[3]!;
  const v2half = BACKTEST_STEPS[4]!;
  const fiveFoldShipped = fiveFoldStep(live, shipped);
  const fiveFoldV2Half = fiveFoldStep(live, v2half);

  // R2-as-shipped comparison: top-10 overlap and median rank shift.
  const r2Ranked = [...universe].sort((a, b) => r2Value(b) - r2Value(a) || (a.slug < b.slug ? -1 : 1));
  const r2Top10 = new Set(r2Ranked.slice(0, 10).map((p) => p.slug));
  const newTop10 = new Set(rows.slice(0, 10).map((r) => r.slug));
  const floor = snapshot.floor_usd;
  const shared = universe.filter((p) => p.tvl_usd < floor || snapshot.watchlist.includes(p.slug));
  const r2SharedRank = new Map<string, number>();
  [...shared].sort((a, b) => r2Value(b) - r2Value(a) || (a.slug < b.slug ? -1 : 1)).forEach((p, i) => r2SharedRank.set(p.slug, i + 1));
  const newSharedRank = new Map<string, number>();
  rows
    .filter((r) => shared.some((p) => p.slug === r.slug))
    .forEach((r, i) => newSharedRank.set(r.slug, i + 1));
  const shifts = [...newSharedRank.keys()].map((s) => Math.abs(newSharedRank.get(s)! - r2SharedRank.get(s)!)).sort((a, b) => a - b);
  const medianShift = shifts.length % 2 === 1 ? shifts[shifts.length >> 1]! : (shifts[(shifts.length >> 1) - 1]! + shifts[shifts.length >> 1]!) / 2;
  const r2Top10Shared = new Set([...r2SharedRank.entries()].filter(([, r]) => r <= 10).map(([s]) => s));
  const newTop10Shared = new Set([...newSharedRank.entries()].filter(([, r]) => r <= 10).map(([s]) => s));

  // Comps-range check: no row's value outside its own 12-comp ratio range by > 1 dex.
  let violations = 0;
  let maxLogGap = 0;
  for (const r of rows) {
    const ratios = r.comps.map((c) => c.ratio);
    const lo = r.tvl_usd * Math.min(...ratios);
    const hi = r.tvl_usd * Math.max(...ratios);
    const gap = r.implied_value_usd < lo ? log10(lo / r.implied_value_usd) : r.implied_value_usd > hi ? log10(r.implied_value_usd / hi) : 0;
    maxLogGap = Math.max(maxLogGap, gap);
    if (gap > 1) violations++;
  }

  const farmCounts = { farm: 0, thin: 0, skip: 0 };
  for (const r of rows) {
    if (r.verdict === "FARM") farmCounts.farm++;
    else if (r.verdict === "THIN") farmCounts.thin++;
    else farmCounts.skip++;
  }
  const nets = rows.map((r) => r.netUsd).sort((a, b) => a - b);
  const medianNet = nets.length % 2 === 1 ? nets[nets.length >> 1]! : (nets[(nets.length >> 1) - 1]! + nets[nets.length >> 1]!) / 2;
  let bestPerHour = -Infinity;
  let bestPerHourSlug = "";
  for (const r of rows) {
    if (r.verdict === "FARM") {
      const perHour = r.netUsd / r.hours;
      if (perHour > bestPerHour) {
        bestPerHour = perHour;
        bestPerHourSlug = r.slug;
      }
    }
  }

  return {
    meta: { asOf: snapshot.as_of, snapshotProtocols: snapshot.protocols.length, watchlist: snapshot.watchlist.length, liveN: live.length, liveRaw, fit: coef },
    rows,
    backtest,
    fiveFoldShipped,
    fiveFoldV2Half,
    accounting: accountFor(snapshot.protocols, boardSlugs),
    launchOdds: launchOddsTables(snapshot.protocols),
    totals: {
      rows: rows.length,
      totalImplied: rows.reduce((s, r) => s + r.implied_value_usd, 0),
      farm: farmCounts.farm,
      thin: farmCounts.thin,
      skip: farmCounts.skip,
      medianNet,
      bestPerHour: bestPerHour === -Infinity ? 0 : bestPerHour,
      bestPerHourSlug,
    },
    r2check: {
      top10OverlapFull: [...newTop10].filter((s) => r2Top10.has(s)).length,
      top10OverlapShared: [...newTop10Shared].filter((s) => r2Top10Shared.has(s)).length,
      medianShiftShared: medianShift,
      sharedN: shared.length,
    },
    compCheck: { violations, maxLogGap },
  };
}
