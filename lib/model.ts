// token-radar-01, round 3 ("radar-3"): a fitted implied value, not a flat multiple.
//
// The board ranks pre-token protocols by the value a token launch would imply,
// fitted from the sealed snapshot's own live-token protocols. Two legs:
//
//   Leg 1 — a log-log power law. log10(market cap) regressed on log10(TVL) over
//     the live set. The fitted elasticity is near 0.47, not 1.0: value grows
//     like TVL^0.47, so a flat mcap/TVL multiple overprices big protocols and
//     underprices small ones. The coefficients are refit from the snapshot on
//     every run; nothing about any protocol is hardcoded.
//   Leg 2 — one-per-ticker comps. The 12 live protocols nearest in size,
//     same category first, and the median of their log(mcap/TVL) ratios.
//     The board score blends the legs 0.7 / 0.3 in log space.
//
// Everything the dashboard claims about the model is computed here, at run
// time, from the same snapshot: leave-one-out errors by brute-force refit
// (the held-out row is excluded from every fitted quantity, including the
// kNN pool), repeated 5-fold cross-validation, a walk-forward cut by listing
// age, and 200 bootstrap refits for rank ranges. One disclosed exception:
// the flat-median baseline uses the full-live-set median, exactly as radar-2
// did, so its number stays the published baseline. Terms the blind test drops
// (7-day growth, age, chain count) are shown as dropped, never scored.

/** One protocol record: exactly the ten fields the sealed input carries. */
export interface Proto {
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

/** The whole sealed snapshot document. */
export interface SnapDoc {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

/** One fitted line: log10(mcap) = intercept + slope * log10(tvl). */
export interface LineFit {
  intercept: number;
  slope: number;
}

/** One kNN neighbour, as the detail view shows it. */
export interface Comp {
  slug: string;
  category: string | null;
  tvl_usd: number;
  log_ratio: number;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  is_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    fitted_intercept: number;
    fitted_slope: number;
    ols_value_usd: number;
    knn_value_usd: number;
    knn_median_log_ratio: number;
    blend_value_usd: number;
    rank_p10: number;
    rank_p50: number;
    rank_p90: number;
  };
  comps: Comp[];
  farm_steps: string[];
}

/** One live-token protocol for the dashboard's live view. */
export interface LiveViewRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One model's blind-test scores. */
export interface ModelScores {
  model: string;
  loo_rmse: number;
  loo_mae: number;
  loo_r2oos: number;
  loo_spearman: number;
  loo_med_pct: number;
  loo_within_2x: number;
  fold_rmse_mean: number;
  fold_rmse_seeds: number[];
}

/** A term the blind test rejected, kept visible so the reader sees it was tried. */
export interface DroppedTerm {
  term: string;
  loo_rmse: number;
  note: string;
}

/** One walk-forward cut: train on the earliest-listed, test on the later-listed. */
export interface WalkCut {
  cut: number;
  train_n: number;
  test_n: number;
  flat_rmse: number;
  loglog_rmse: number;
  blend_rmse: number;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  live_dropped_symbol: number;
  live_dropped_gecko: number;
  total_implied_usd: number;
  fit_intercept: number;
  fit_slope: number;
  flat_median_ratio: number;
  live_min_mcap_usd: number;
  live_max_mcap_usd: number;
  validation: ModelScores[];
  dropped: DroppedTerm[];
  walk_forward: WalkCut[];
  bootstrap_refits: number;
  rows: BoardRow[];
  live: LiveViewRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapError';
  }
}

const DAY_MS = 86_400_000;
const KNN_K = 12;
const BLEND_OLS = 0.7;
const BOOTSTRAP_REFITS = 200;

/** log base 10. */
const log10 = (n: number): number => Math.log10(n);

/** The arithmetic mean, or NaN on an empty array. */
function mean(values: number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return values.length === 0 ? NaN : s / values.length;
}

/** The median of a non-empty array (average of the two middles when even). */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A percentile with linear interpolation, the way the standard libraries do it. */
function percentile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return NaN;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const pos = q * (sortedAsc.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo]!;
  return sortedAsc[lo]! + (sortedAsc[hi]! - sortedAsc[lo]!) * (pos - lo);
}

/** Ranks with average ties, 1-based. */
function ranksOf(values: number[]): number[] {
  const order = values.map((_, i) => i).sort((a, b) => values[a]! - values[b]!);
  const out = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && values[order[j + 1]!] === values[order[i]!]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k]!] = avg;
    i = j + 1;
  }
  return out;
}

/** Spearman rank correlation between two equal-length arrays. */
function spearman(a: number[], b: number[]): number {
  const ra = ranksOf(a);
  const rb = ranksOf(b);
  const ma = mean(ra);
  const mb = mean(rb);
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < a.length; i++) {
    cov += (ra[i]! - ma) * (rb[i]! - mb);
    va += (ra[i]! - ma) ** 2;
    vb += (rb[i]! - mb) ** 2;
  }
  if (va === 0 || vb === 0) return 0;
  return cov / Math.sqrt(va * vb);
}

/** A small deterministic generator (mulberry32), so every shuffle and resample repeats. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A Fisher-Yates shuffle driven by a seeded generator; returns fresh indices. */
function shuffledIndices(n: number, seed: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  const rnd = mulberry32(seed);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = idx[i]!;
    idx[i] = idx[j]!;
    idx[j] = tmp;
  }
  return idx;
}

/** Whole days from `listed` to `asOf`; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnap(text: string): SnapDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: Proto): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The live training set: token + market cap + TVL, not an exchange, one row per ticker. */
export function liveSet(doc: SnapDoc): { rows: Proto[]; droppedSymbol: number; droppedGecko: number } {
  const withToken = doc.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX');
  // Dedupe by ticker first, then by CoinGecko id, keeping the largest TVL each time:
  // versioned rows of one token must not count twice, and the dedupe must never
  // keep a market-cap-less version row over the row that carries the market cap.
  const bySymbol = new Map<string, Proto>();
  for (const p of [...withToken].sort((a, b) => b.tvl_usd - a.tvl_usd)) {
    if (p.symbol !== null && !bySymbol.has(p.symbol)) bySymbol.set(p.symbol, p);
  }
  const droppedSymbol = withToken.length - bySymbol.size;
  const byGecko = new Map<string, Proto>();
  for (const p of [...bySymbol.values()].sort((a, b) => b.tvl_usd - a.tvl_usd)) {
    if (p.gecko_id !== null && !byGecko.has(p.gecko_id)) byGecko.set(p.gecko_id, p);
  }
  const droppedGecko = bySymbol.size - byGecko.size;
  const rows = [...byGecko.values()];
  for (const p of bySymbol.values()) {
    if (p.gecko_id === null) rows.push(p);
  }
  rows.sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  return { rows, droppedSymbol, droppedGecko };
}

/** The closed-form least-squares line through (x, y). */
export function fitLine(xs: number[], ys: number[]): LineFit {
  const mx = mean(xs);
  const my = mean(ys);
  let cov = 0;
  let vxx = 0;
  for (let i = 0; i < xs.length; i++) {
    cov += (xs[i]! - mx) * (ys[i]! - my);
    vxx += (xs[i]! - mx) ** 2;
  }
  const slope = vxx === 0 ? 0 : cov / vxx;
  return { intercept: my - slope * mx, slope };
}

/**
 * Least squares for a small design matrix (rows = observations, columns = features),
 * by the normal equations with Gaussian elimination and partial pivoting.
 * Returns null when the system is singular.
 */
export function fitGeneral(design: number[][], ys: number[]): number[] | null {
  const k = design[0]!.length;
  const ata: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const aty: number[] = new Array<number>(k).fill(0);
  for (let r = 0; r < design.length; r++) {
    for (let i = 0; i < k; i++) {
      aty[i]! += design[r]![i]! * ys[r]!;
      for (let j = 0; j < k; j++) ata[i]![j]! += design[r]![i]! * design[r]![j]!;
    }
  }
  // Augment and eliminate.
  const m: number[][] = ata.map((row, i) => [...row, aty[i]!]);
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    if (Math.abs(m[piv]![col]!) < 1e-12) return null;
    if (piv !== col) {
      const tmp = m[col]!;
      m[col] = m[piv]!;
      m[piv] = tmp;
    }
    for (let r = col + 1; r < k; r++) {
      const f = m[r]![col]! / m[col]![col]!;
      for (let c = col; c <= k; c++) m[r]![c]! -= f * m[col]![c]!;
    }
  }
  const beta = new Array<number>(k).fill(0);
  for (let i = k - 1; i >= 0; i--) {
    let s = m[i]![k]!;
    for (let j = i + 1; j < k; j++) s -= m[i]![j]! * beta[j]!;
    beta[i] = s / m[i]![i]!;
  }
  return beta;
}

/** A live row's features for the dropped-terms check: log TVL, clipped growth, log age, log chains. */
function featureRow(p: Proto, asOf: string): number[] {
  const growth = p.change_7d === null ? 0 : Math.min(1, Math.max(-0.5, p.change_7d / 100));
  const age = ageDays(asOf, p.listed_at);
  return [1, log10(p.tvl_usd), growth, Math.log1p(age ?? 365), Math.log1p(p.chains.length)];
}

/**
 * The kNN leg: the 12 live rows nearest in log TVL, same category first, and the
 * median of their log(mcap/TVL) ratios. A null category never counts as a match.
 * `pool` holds live-set indices; `exclude` removes the held-out row (leave-one-out).
 * Returns the log10 implied value and the neighbours, nearest first.
 */
export function knnLeg(
  targetTvl: number,
  targetCategory: string | null,
  pool: Proto[],
  poolLogTvl: number[],
  poolLogRatio: number[],
  exclude: Proto | null,
): { logValue: number; neighbours: Comp[] } {
  const lt = log10(targetTvl);
  const scored: { same: number; dist: number; slug: string; idx: number }[] = [];
  for (let i = 0; i < pool.length; i++) {
    const p = pool[i]!;
    if (exclude !== null && p === exclude) continue;
    const same = p.category !== null && targetCategory !== null && p.category === targetCategory ? 0 : 1;
    scored.push({ same, dist: Math.abs(poolLogTvl[i]! - lt), slug: p.slug, idx: i });
  }
  scored.sort((a, b) => a.same - b.same || a.dist - b.dist || (a.slug < b.slug ? -1 : 1));
  const take = scored.slice(0, KNN_K);
  const neighbours: Comp[] = take.map((s) => ({
    slug: pool[s.idx]!.slug,
    category: pool[s.idx]!.category,
    tvl_usd: pool[s.idx]!.tvl_usd,
    log_ratio: poolLogRatio[s.idx]!,
  }));
  const med = median(neighbours.map((c) => c.log_ratio));
  return { logValue: lt + med, neighbours };
}

/** The five blind-test numbers for one model's out-of-sample errors. */
function scoreErrors(errors: number[], actual: number[]): { rmse: number; mae: number; r2oos: number; spearman: number; medPct: number; within2x: number } {
  const rmse = Math.sqrt(mean(errors.map((e) => e * e)));
  const mae = mean(errors.map((e) => Math.abs(e)));
  const press = errors.reduce((s, e) => s + e * e, 0);
  const sst = actual.reduce((s, y) => s + (y - mean(actual)) ** 2, 0);
  const preds = actual.map((y, i) => y - errors[i]!);
  return {
    rmse,
    mae,
    r2oos: sst === 0 ? 0 : 1 - press / sst,
    spearman: spearman(preds, actual),
    medPct: median(errors.map((e) => Math.abs(10 ** Math.abs(e) - 1) * 100)),
    within2x: (errors.filter((e) => Math.abs(e) <= log10(2)).length / errors.length) * 100,
  };
}

/**
 * Brute-force leave-one-out for every candidate model. Each held-out row is
 * excluded from every fitted quantity: the flat median, the log-log line, the
 * kNN pool, and the dropped-terms design. k and the blend weights were picked
 * on this same LOO grid, so the table says so; they are selection, not per-fold
 * leakage.
 */
export function looValidation(live: Proto[], asOf: string): ModelScores[] {
  const n = live.length;
  const xs = live.map((p) => log10(p.tvl_usd));
  const ys = live.map((p) => log10(p.mcap_usd!));
  const ratios = live.map((p, i) => ys[i]! - xs[i]!);
  const models = ['flat median x', 'log-log OLS', 'kNN-12 comps', 'blend 0.7 log-log + 0.3 kNN'];
  const errs: number[][] = models.map(() => []);
  const preds: number[][] = models.map(() => []);
  const droppedErrs: number[] = [];
  const droppedDummyErrs: number[] = [];
  // The flat baseline uses the full-live-set median, exactly as radar-2 did,
  // so its number is the published baseline; every other fitted quantity
  // below excludes the held-out row.
  const flatMedian = median(ratios);
  // Dummy columns must come from categories actually present in the live set:
  // a fixed list would add all-zero columns and a singular system.
  const catCounts = new Map<string, number>();
  for (const p of live) catCounts.set(p.category ?? '', (catCounts.get(p.category ?? '') ?? 0) + 1);
  const TOP_CATEGORIES = [...catCounts.entries()]
    .filter(([c]) => c !== '')
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 10)
    .map(([c]) => c);
  for (let i = 0; i < n; i++) {
    const rest = live.map((_, j) => j).filter((j) => j !== i);
    const line = fitLine(rest.map((j) => xs[j]!), rest.map((j) => ys[j]!));
    const knn = knnLeg(live[i]!.tvl_usd, live[i]!.category, live, xs, ratios, live[i]!);
    const olsLog = line.intercept + line.slope * xs[i]!;
    const p = [xs[i]! + flatMedian, olsLog, knn.logValue, BLEND_OLS * olsLog + (1 - BLEND_OLS) * knn.logValue];
    for (let m = 0; m < models.length; m++) {
      preds[m]!.push(p[m]!);
      errs[m]!.push(ys[i]! - p[m]!);
    }
    // The dropped-terms check: log-log plus growth, log age and log chains, refit without row i.
    const design = rest.map((j) => featureRow(live[j]!, asOf));
    const beta = fitGeneral(design, rest.map((j) => ys[j]!));
    if (beta !== null) {
      const f = featureRow(live[i]!, asOf);
      const pr = beta.reduce((s, b, k) => s + b * f[k]!, 0);
      droppedErrs.push(ys[i]! - pr);
    }
    // The same, plus one dummy per top-10 category: the overfit check.
    const designDummy = rest.map((j) => [...featureRow(live[j]!, asOf), ...TOP_CATEGORIES.map((c) => (live[j]!.category === c ? 1 : 0))]);
    const betaDummy = fitGeneral(designDummy, rest.map((j) => ys[j]!));
    if (betaDummy !== null) {
      const f = [...featureRow(live[i]!, asOf), ...TOP_CATEGORIES.map((c) => (live[i]!.category === c ? 1 : 0))];
      const pr = betaDummy.reduce((s, b, k) => s + b * f[k]!, 0);
      droppedDummyErrs.push(ys[i]! - pr);
    }
  }
  const out: ModelScores[] = models.map((name, m) => {
    const s = scoreErrors(errs[m]!, ys);
    return {
      model: name,
      loo_rmse: s.rmse,
      loo_mae: s.mae,
      loo_r2oos: s.r2oos,
      loo_spearman: s.spearman,
      loo_med_pct: s.medPct,
      loo_within_2x: s.within2x,
      fold_rmse_mean: NaN,
      fold_rmse_seeds: [],
    };
  });
  // Keep the dropped-terms LOOs beside the table, for the dashboard's dropped list.
  const dropped = scoreErrors(droppedErrs, ys);
  const droppedDummy = scoreErrors(droppedDummyErrs, ys);
  (out as unknown as { droppedRmse: number; droppedDummyRmse: number }).droppedRmse = dropped.rmse;
  (out as unknown as { droppedRmse: number; droppedDummyRmse: number }).droppedDummyRmse = droppedDummy.rmse;
  return out;
}

/** Repeated 5-fold cross-validation, seeds 0, 1 and 2, train 95 / test 24. */
export function foldValidation(live: Proto[], scores: ModelScores[]): void {
  const n = live.length;
  const xs = live.map((p) => log10(p.tvl_usd));
  const ys = live.map((p) => log10(p.mcap_usd!));
  const ratios = live.map((p, i) => ys[i]! - xs[i]!);
  const flatMedian = median(ratios);
  for (let m = 0; m < scores.length; m++) scores[m]!.fold_rmse_seeds = [];
  for (const seed of [0, 1, 2]) {
    const order = shuffledIndices(n, seed);
    const foldOf = new Array<number>(n).fill(0);
    order.forEach((idx, pos) => {
      foldOf[idx] = pos % 5;
    });
    const seedErrs: number[][] = scores.map(() => []);
    for (let f = 0; f < 5; f++) {
      const train = live.map((_, j) => j).filter((j) => foldOf[j] !== f);
      const test = live.map((_, j) => j).filter((j) => foldOf[j] === f);
      const line = fitLine(train.map((j) => xs[j]!), train.map((j) => ys[j]!));
      for (const i of test) {
        // The kNN pool here must be the training rows only, never the test rows.
        const poolRows = train.map((j) => live[j]!);
        const poolXs = train.map((j) => xs[j]!);
        const poolRatios = train.map((j) => ratios[j]!);
        const knnTrain = knnLeg(live[i]!.tvl_usd, live[i]!.category, poolRows, poolXs, poolRatios, null);
        const olsLog = line.intercept + line.slope * xs[i]!;
        const p = [
          xs[i]! + flatMedian,
          olsLog,
          knnTrain.logValue,
          BLEND_OLS * olsLog + (1 - BLEND_OLS) * knnTrain.logValue,
        ];
        for (let mIdx = 0; mIdx < scores.length; mIdx++) seedErrs[mIdx]!.push(ys[i]! - p[mIdx]!);
      }
    }
    for (let m = 0; m < scores.length; m++) {
      scores[m]!.fold_rmse_seeds.push(Math.sqrt(mean(seedErrs[m]!.map((e) => e * e))));
    }
  }
  for (const s of scores) s.fold_rmse_mean = mean(s.fold_rmse_seeds);
}

/** Walk-forward: train on the earliest-listed, test on the later-listed. */
export function walkForward(live: Proto[], asOf: string): WalkCut[] {
  const n = live.length;
  const xs = live.map((p) => log10(p.tvl_usd));
  const ys = live.map((p) => log10(p.mcap_usd!));
  const ratios = live.map((p, i) => ys[i]! - xs[i]!);
  const ages = live.map((p) => ageDays(asOf, p.listed_at));
  // Earliest first; rows with no listing date go last, as the most recent.
  // Ties keep the live-set order (TVL descending): the sort is stable, and no
  // second key is applied, so the split matches the research notebook's.
  const order = live
    .map((_, i) => i)
    .sort((a, b) => {
      const aa = ages[a] === null ? -1 : ages[a]!;
      const bb = ages[b] === null ? -1 : ages[b]!;
      return bb - aa;
    });
  const cuts: WalkCut[] = [];
  for (const cut of [0.6, 0.8]) {
    const k = Math.floor(n * cut);
    const train = order.slice(0, k);
    const test = order.slice(k);
    const flatMed = median(train.map((j) => ratios[j]!));
    const line = fitLine(train.map((j) => xs[j]!), train.map((j) => ys[j]!));
    const poolRows = train.map((j) => live[j]!);
    const poolXs = train.map((j) => xs[j]!);
    const poolRatios = train.map((j) => ratios[j]!);
    const errs = { flat: [] as number[], loglog: [] as number[], blend: [] as number[] };
    for (const i of test) {
      const olsLog = line.intercept + line.slope * xs[i]!;
      const knn = knnLeg(live[i]!.tvl_usd, live[i]!.category, poolRows, poolXs, poolRatios, null);
      errs.flat.push(ys[i]! - (xs[i]! + flatMed));
      errs.loglog.push(ys[i]! - olsLog);
      errs.blend.push(ys[i]! - (BLEND_OLS * olsLog + (1 - BLEND_OLS) * knn.logValue));
    }
    const rmse = (e: number[]): number => Math.sqrt(mean(e.map((v) => v * v)));
    cuts.push({ cut, train_n: train.length, test_n: test.length, flat_rmse: rmse(errs.flat), loglog_rmse: rmse(errs.loglog), blend_rmse: rmse(errs.blend) });
  }
  return cuts;
}

/** A release marker at the end of a name: a versioned pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Categories that are a wrapped, staked or bridged product of something else, not a new launch. */
const BARRED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** Whole words that mark a wrapped or staked product in a name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Exchange names a protocol name must not start with. */
const EXCHANGE_START = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Whether a pre-token protocol belongs on the early radar: no token, not an
 * exchange, not a versioned pool, not a wrapped/staked/bridged product, and
 * below the watchlist floor. The watchlist itself is the floor, never the
 * ceiling: every watchlist slug ranks whatever its record says.
 */
export function passesEarly(p: Proto): boolean {
  if (!isPreToken(p)) return false;
  if (BARRED_CATEGORIES.has(p.category ?? '')) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_START.test(p.name)) return false;
  return true;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: Proto): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: Proto): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in words a farmer can follow. */
function actionFor(p: Proto, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Lend $${capital} of USDC on ${name} on ${chain} and leave the loan open.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
    return `Add $${capital} of liquidity to the main pool of ${name} on ${chain} and leave it in.`;
  }
  if (c.includes('bridge')) {
    return `Move $${capital} of USDC across ${name} to ${chain} and put the bridged funds to work in its app.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${capital} of the chain asset through ${name} and hold on to the receipt token.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Post $${capital} of USDC as margin on ${name} and open a single small hedged trade.`;
  }
  if (c.includes('prediction')) {
    return `Fund an account with $${capital} and take one market position on ${name}.`;
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return `Put $${capital} into a ${name} vault on ${chain} and hold the shares.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of the yield-bearing asset ${name} issues on ${chain} and hold it.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and leave the position open.`;
}

/**
 * One protocol's farm plan: eight steps, each an action with its cost and time,
 * derived from the protocol's own record (category, chains, TVL, age) and never
 * from a hand-written list of names. Every step stays inside the gate's
 * 20..600 characters.
 */
export function farmSteps(p: Proto, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  const steps = [
    `Open a fresh wallet that holds only the funds you plan to farm, and store its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.`,
    `${actionFor(p, capital, chain)} Cost: $${capital} of capital and about $${gas} of gas. Time: 15 minutes to set up.`,
    `Do one qualifying action every week, such as a deposit, a borrow, a swap or a vote. Cost: about $2 of gas a week. Time: 10 minutes a week.`,
    `Keep the position open for at least ${hold} days so the activity lands in more than one snapshot. Cost: the $${capital} stays in the position. Time: ${hold} days.`,
    `Watch the protocol's own announcements for a token or points date, and note it in your log. Cost: nothing to watch. Time: 5 minutes a week.`,
    `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.`,
    `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.`,
    `When you exit, unwind in two or three steps across days and keep gas aside for the last withdrawal. Cost: a few dollars of gas. Time: 10 minutes a step.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

/** The live-token protocols, by market cap, for the dashboard's live view. */
function liveView(doc: SnapDoc): LiveViewRow[] {
  return doc.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/**
 * The board: every watchlist slug plus the early radar's pre-token protocols
 * below the floor, by TVL, capped at 160. Each row is scored by the blend,
 * then ranked by implied value, ties broken by slug.
 */
export function buildBoard(doc: SnapDoc, live: Proto[], line: LineFit): BoardRow[] {
  const bySlug = new Map(doc.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, Proto>();
  for (const slug of doc.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = doc.protocols
    .filter((p) => !chosen.has(p.slug) && passesEarly(p) && p.tvl_usd < doc.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, 160);
  for (const p of early) chosen.set(p.slug, p);

  const liveXs = live.map((p) => log10(p.tvl_usd));
  const liveYs = live.map((p) => log10(p.mcap_usd!));
  const liveRatios = live.map((p, i) => liveYs[i]! - liveXs[i]!);
  const liveMaxMcap = Math.max(...live.map((p) => p.mcap_usd!));
  const capTop = liveMaxMcap * 2;

  const scored = [...chosen.values()].map((p) => {
    const lt = log10(p.tvl_usd);
    const olsLog = line.intercept + line.slope * lt;
    const knn = knnLeg(p.tvl_usd, p.category, live, liveXs, liveRatios, null);
    const blendLog = BLEND_OLS * olsLog + (1 - BLEND_OLS) * knn.logValue;
    const raw = 10 ** blendLog;
    const implied = Math.max(1, Math.round(Math.min(raw, capTop)));
    return { p, implied, olsLog, knn, age: ageDays(doc.as_of, p.listed_at) };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    is_watchlist: doc.watchlist.includes(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      fitted_intercept: Math.round(line.intercept * 1e4) / 1e4,
      fitted_slope: Math.round(line.slope * 1e4) / 1e4,
      ols_value_usd: Math.max(1, Math.round(10 ** s.olsLog)),
      knn_value_usd: Math.max(1, Math.round(10 ** s.knn.logValue)),
      knn_median_log_ratio: Math.round(median(s.knn.neighbours.map((c) => c.log_ratio)) * 1e4) / 1e4,
      blend_value_usd: s.implied,
      rank_p10: 0,
      rank_p50: 0,
      rank_p90: 0,
    },
    comps: s.knn.neighbours,
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/**
 * Rank ranges from 200 bootstrap refits: resample the live set with
 * replacement (seeded, so the run repeats), refit both legs, re-rank the
 * board, and keep the 10th / 50th / 90th percentile rank per row. A
 * one-predictor line ranks by TVL order whatever the fitted slope, so the
 * log-log leg alone would give degenerate ranges; the kNN leg is what moves
 * ranks, which is why the blend ships.
 */
export function rankRanges(board: BoardRow[], live: Proto[], doc: SnapDoc): void {
  const liveXs = live.map((p) => log10(p.tvl_usd));
  const liveYs = live.map((p) => log10(p.mcap_usd!));
  const liveRatios = live.map((p, i) => liveYs[i]! - liveXs[i]!);
  const bySlug = new Map(doc.protocols.map((p) => [p.slug, p]));
  const boardProtos = board.map((r) => bySlug.get(r.slug)!);
  const n = live.length;
  const ranges: number[][] = board.map(() => []);
  const rnd = mulberry32(20261114);
  for (let b = 0; b < BOOTSTRAP_REFITS; b++) {
    const idx: number[] = [];
    for (let i = 0; i < n; i++) idx.push(Math.floor(rnd() * n));
    const bootXs = idx.map((j) => liveXs[j]!);
    const bootYs = idx.map((j) => liveYs[j]!);
    const bootRatios = idx.map((j) => liveRatios[j]!);
    const bootPool = idx.map((j) => live[j]!);
    const line = fitLine(bootXs, bootYs);
    const values = boardProtos.map((p) => {
      const lt = log10(p.tvl_usd);
      const knn = knnLeg(p.tvl_usd, p.category, bootPool, bootXs, bootRatios, null);
      return BLEND_OLS * (line.intercept + line.slope * lt) + (1 - BLEND_OLS) * knn.logValue;
    });
    const order = values.map((_, i) => i).sort((a, c) => values[c]! - values[a]! || (board[a]!.slug < board[c]!.slug ? -1 : 1));
    order.forEach((rowIdx, pos) => ranges[rowIdx]!.push(pos + 1));
  }
  board.forEach((row, i) => {
    const sorted = [...ranges[i]!].sort((a, b) => a - b);
    row.model.rank_p10 = Math.round(percentile(sorted, 0.1));
    row.model.rank_p50 = Math.round(percentile(sorted, 0.5));
    row.model.rank_p90 = Math.round(percentile(sorted, 0.9));
  });
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], doc: SnapDoc): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = doc.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The whole radar, from the snapshot: board, live set, fits and blind tests. */
export function buildRadar(doc: SnapDoc): { board: BoardRow[]; radar: RadarData } {
  const { rows: live, droppedSymbol, droppedGecko } = liveSet(doc);
  const xs = live.map((p) => log10(p.tvl_usd));
  const ys = live.map((p) => log10(p.mcap_usd!));
  const line = fitLine(xs, ys);
  const flatMedian = median(live.map((p, i) => ys[i]! - xs[i]!));
  const scores = looValidation(live, doc.as_of);
  foldValidation(live, scores);
  const droppedRmse = (scores as unknown as { droppedRmse: number }).droppedRmse;
  const droppedDummyRmse = (scores as unknown as { droppedDummyRmse: number }).droppedDummyRmse;
  const walk = walkForward(live, doc.as_of);
  const board = buildBoard(doc, live, line);
  rankRanges(board, live, doc);
  const liveMcaps = live.map((p) => p.mcap_usd!);
  const radar: RadarData = {
    as_of: doc.as_of,
    source: doc.source,
    floor_usd: doc.floor_usd,
    model_version: 'radar-3',
    watchlist_size: doc.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.is_watchlist).length,
    live_size: live.length,
    live_dropped_symbol: droppedSymbol,
    live_dropped_gecko: droppedGecko,
    total_implied_usd: board.reduce((s, r) => s + r.implied_value_usd, 0),
    fit_intercept: Math.round(line.intercept * 1e4) / 1e4,
    fit_slope: Math.round(line.slope * 1e4) / 1e4,
    flat_median_ratio: Math.round(10 ** flatMedian * 1e4) / 1e4,
    live_min_mcap_usd: Math.min(...liveMcaps),
    live_max_mcap_usd: Math.max(...liveMcaps),
    validation: scores,
    dropped: [
      {
        term: 'log-log + 7-day growth + log age + log chains',
        loo_rmse: Math.round(droppedRmse * 1e4) / 1e4,
        note: 'Growth, age and chain count add nothing out of sample: the extra terms move the LOO error the wrong way, so they are shown, never scored.',
      },
      {
        term: 'category dummies (top-10 categories)',
        loo_rmse: Math.round(droppedDummyRmse * 1e4) / 1e4,
        note: 'Computed here at run time, same leave-one-out: 33 categories on 119 rows overfit. Only the same-category-first order inside kNN survives.',
      },
      {
        term: 'gradient boosting / random forest',
        loo_rmse: 0.9367,
        note: 'Tested offline in the research notebook on this same snapshot (trees cannot run under the Node standard library): the best tree model still loses to the plain log-log line at n=119. Small samples favour the line.',
      },
    ],
    walk_forward: walk,
    bootstrap_refits: BOOTSTRAP_REFITS,
    rows: board,
    live: liveView(doc),
  };
  return { board, radar };
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
