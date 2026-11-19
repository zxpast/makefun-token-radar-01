// The radar's scoring core: a sealed snapshot in, a ranked board out.
//
// What lives here, in the order it runs: the snapshot's shape, the one tuning number the
// snapshot's own live-token market sets, the scoring of every pre-token protocol from its
// size, its seven-day move, its age without a token and its chain spread, the farm plan each
// row carries, and the board the dashboard renders. No protocol is ever named specially:
// one arithmetic scores every row, and each plan is built from its row's own category,
// chains, size and age. The dashboard only replays what this file writes.

export type Proto = {
  slug: string; // DefiLlama's slug, unique in the snapshot
  name: string; // the protocol's name as DefiLlama writes it
  category: string | null; // DefiLlama's category, or null when it names none
  chains: string[]; // the chains DefiLlama counts the TVL on
  tvl_usd: number; // TVL in whole dollars, truncated toward zero
  change_7d: number | null; // TVL's seven-day change in per cent, or null
  mcap_usd: number | null; // its token's market cap, or null when it records no token
  listed_at: string | null; // the day DefiLlama began tracking it, or null
  gecko_id: string | null; // its token's CoinGecko id, or null
  symbol: string | null; // its token's ticker, or null
};

export type Snap = {
  as_of: string; // the fetch's UTC date, YYYY-MM-DD
  source: string; // where the data came from, and when
  floor_usd: number; // the watchlist's floor in whole dollars
  protocols: Proto[]; // every protocol at or above $5M of TVL, by slug
  watchlist: string[]; // the slugs that meet the watchlist's rule, ascending
};

export type Tuning = {
  base_multiple: number; // TVL dollars to implied token dollars, calibrated
  growth_weight: number; // how much of the seven-day move the value keeps
  growth_floor: number; // the lowest seven-day move the model credits
  growth_cap: number; // the highest seven-day move the model credits
  maturity_floor: number; // the value's floor for a brand-new protocol
  maturity_range: number; // what four years without a token add
  maturity_days: number; // the age, in days, that earns the full range
  unknown_age_days: number; // the age a protocol with no listing date is given
  chain_step: number; // what one extra chain adds
  chain_max_extra: number; // how many extra chains the model counts
};

export const TUNING: Tuning = {
  base_multiple: 0.25, growth_weight: 0.6, growth_floor: -50, growth_cap: 100,
  maturity_floor: 0.65, maturity_range: 0.35, maturity_days: 1460, unknown_age_days: 365,
  chain_step: 0.02, chain_max_extra: 5,
};

export const MODEL_VERSION = "radar-2";
export const LIVE_COUNT = 24;

export type Calib = {
  live_protocols: number; // how many live-token protocols the median rests on
  median_mcap_tvl: number; // the median market-cap-to-TVL ratio itself
  base_multiple: number; // the median, clamped to a sane band
};

export type Step = {
  text: string; // the action, in words a farmer can follow
  cost: string; // what it costs
  time: string; // how long it takes
};

export type Row = {
  rank: number; // 1 is the board's most valuable protocol
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
  token_status: "pre-token";
  is_watchlist: boolean; // true when the snapshot's watchlist names it
  age_days: number | null; // days from listing to the snapshot, or null
  implied_value_usd: number; // the model's claim, whole dollars
  model: {
    age_days: number | null; // the age the model used, or null
    base_multiple: number; // the calibrated multiple this row was scored with
    chain_multiplier: number; // rounded to four places
    growth_multiplier: number; // rounded to four places
    growth_pct: number; // the clamped seven-day move
    maturity_multiplier: number; // rounded to four places
  };
  farm_steps: string[]; // eight steps, each action plus cost plus time
};

export type CompactRow = {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  is_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
};

export type Live = {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
};

export type Radar = {
  as_of: string;
  source: string;
  floor_usd: number;
  model: Tuning;
  model_version: string;
  calibration: Calib;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  rows: CompactRow[];
  live: Live[];
};

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotError";
  }
}
const MS_PER_DAY = 86400000;

function numOr(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

function clampNum(value: number, low: number, high: number): number {
  if (value < low) {
    return low;
  }
  if (value > high) {
    return high;
  }
  return value;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function daysBetween(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) {
    return null;
  }
  const end = Date.parse(asOf + "T00:00:00Z");
  const start = Date.parse(listedAt + "T00:00:00Z");
  if (!Number.isFinite(end) || !Number.isFinite(start)) {
    return null;
  }
  return Math.max(0, Math.floor((end - start) / MS_PER_DAY));
}

function medianOf(sorted: number[]): number {
  const n = sorted.length;
  if (n % 2 === 1) {
    return sorted[(n - 1) / 2]!;
  }
  return (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}

function hasNoToken(p: Proto): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const versionMark = new RegExp("\\s(V\\d+(\\.\\d+)?|v\\d+(\\.\\d+)?|\\d+\\.\\d+)$");
const wrappedWord = new RegExp("\\b(wrapped|staked|staking)\\b", "i");
const exchangeName = new RegExp("^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\\b");
const barredKinds = ["Bridge", "Canonical Bridge", "Liquid Staking", "Liquid Restaking", "Restaked BTC", "CEX"];

function passesEarlyRule(p: Proto): boolean {
  if (!hasNoToken(p)) {
    return false;
  }
  if (p.category !== null && barredKinds.includes(p.category)) {
    return false;
  }
  if (versionMark.test(p.name)) {
    return false;
  }
  if (wrappedWord.test(p.name)) {
    return false;
  }
  if (exchangeName.test(p.name)) {
    return false;
  }
  return true;
}

export function calibrate(snap: Snap): Calib {
  const ratios = snap.protocols
    .filter((p) => !hasNoToken(p) && p.category !== "CEX" && numOr(p.mcap_usd, 0) > 0 && p.tvl_usd > 0)
    .map((p) => p.mcap_usd! / p.tvl_usd)
    .sort((a, b) => a - b);
  if (ratios.length === 0) {
    return { live_protocols: 0, median_mcap_tvl: TUNING.base_multiple, base_multiple: TUNING.base_multiple };
  }
  const median = medianOf(ratios);
  const base = Math.min(1, Math.max(0.05, median));
  return { live_protocols: ratios.length, median_mcap_tvl: median, base_multiple: base };
}

export type Score = {
  value: number;
  growthPct: number;
  growthMul: number;
  ageMul: number;
  chainMul: number;
  ageDays: number | null;
};

export function scoreEntry(entry: Proto, asOf: string, tuning: Tuning): Score {
  const ageDays = daysBetween(asOf, entry.listed_at);
  const rawGrowth = numOr(entry.change_7d, 0);
  const growthPct = clampNum(rawGrowth, tuning.growth_floor, tuning.growth_cap);
  const growthMul = 1 + (growthPct / 100) * tuning.growth_weight;
  const ageForModel = ageDays === null ? tuning.unknown_age_days : ageDays;
  const cappedAge = Math.min(Math.max(ageForModel, 0), tuning.maturity_days);
  const ageMul = tuning.maturity_floor + (cappedAge / tuning.maturity_days) * tuning.maturity_range;
  const extraChains = Math.min(Math.max(entry.chains.length - 1, 0), tuning.chain_max_extra);
  const chainMul = 1 + extraChains * tuning.chain_step;
  const base = entry.tvl_usd * tuning.base_multiple;
  const value = Math.max(1, Math.round(base * growthMul * ageMul * chainMul));
  return { value, growthPct, growthMul, ageMul, chainMul, ageDays };
}

function bySlugAsc(a: Proto, b: Proto): number {
  if (a.slug < b.slug) {
    return -1;
  }
  if (a.slug > b.slug) {
    return 1;
  }
  return 0;
}

function byValueDesc(
  a: { entry: Proto; score: Score },
  b: { entry: Proto; score: Score },
): number {
  if (a.score.value !== b.score.value) {
    return b.score.value - a.score.value;
  }
  return bySlugAsc(a.entry, b.entry);
}

const PRE_TOKEN = "pre-token";

function toRow(entry: Proto, score: Score, tuning: Tuning, onWatchlist: boolean, rank: number): Row {
  const age_days = score.ageDays;
  const base_multiple = tuning.base_multiple;
  const growth_pct = score.growthPct;
  const growth_multiplier = round4(score.growthMul);
  const maturity_multiplier = round4(score.ageMul);
  const chain_multiplier = round4(score.chainMul);
  const token_status = PRE_TOKEN;
  const is_watchlist = onWatchlist;
  const implied_value_usd = score.value;
  const model = { base_multiple, growth_pct, growth_multiplier, maturity_multiplier, chain_multiplier, age_days };
  const farm_steps = planSteps(entry, age_days).map(joinStep);
  const row: Row = {
    rank,
    slug: entry.slug,
    name: entry.name,
    category: entry.category,
    chains: entry.chains,
    tvl_usd: entry.tvl_usd,
    change_7d: entry.change_7d,
    mcap_usd: entry.mcap_usd,
    listed_at: entry.listed_at,
    gecko_id: entry.gecko_id,
    symbol: entry.symbol,
    token_status,
    is_watchlist,
    age_days,
    implied_value_usd,
    model,
    farm_steps,
  };
  return row;
}

export function buildBoard(snap: Snap, tuning: Tuning = TUNING): Row[] {
  const index = new Map(snap.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, Proto>();
  for (const slug of snap.watchlist) {
    const found = index.get(slug);
    if (found !== undefined) {
      chosen.set(slug, found);
    }
  }
  const early = snap.protocols
    .filter((p) => !chosen.has(p.slug) && passesEarlyRule(p) && p.tvl_usd < snap.floor_usd)
    .sort((a, b) => {
      if (a.tvl_usd !== b.tvl_usd) {
        return b.tvl_usd - a.tvl_usd;
      }
      return bySlugAsc(a, b);
    });
  for (const p of early) {
    chosen.set(p.slug, p);
  }
  const watch = new Set(snap.watchlist);
  const scored = [...chosen.values()].map((entry) => ({ entry, score: scoreEntry(entry, snap.as_of, tuning) }));
  scored.sort(byValueDesc);
  return scored.map((s, i) => toRow(s.entry, s.score, tuning, watch.has(s.entry.slug), i + 1));
}

export function liveSet(snap: Snap): Live[] {
  return snap.protocols
    .filter((p) => !hasNoToken(p) && p.category !== "CEX")
    .sort((a, b) => {
      if ((b.mcap_usd ?? 0) !== (a.mcap_usd ?? 0)) {
        return (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0);
      }
      return b.tvl_usd - a.tvl_usd;
    })
    .slice(0, LIVE_COUNT)
    .map((p) => {
      const slug = p.slug;
      const name = p.name;
      const category = p.category;
      const chains = p.chains;
      const tvl_usd = p.tvl_usd;
      const mcap_usd = p.mcap_usd;
      const change_7d = p.change_7d;
      return { slug, name, category, chains, tvl_usd, mcap_usd, change_7d };
    });
}

function toCompact(row: Row): CompactRow {
  const rank = row.rank;
  const slug = row.slug;
  const name = row.name;
  const category = row.category;
  const chains = row.chains;
  const tvl_usd = row.tvl_usd;
  const change_7d = row.change_7d;
  const mcap_usd = row.mcap_usd;
  const listed_at = row.listed_at;
  const is_watchlist = row.is_watchlist;
  const age_days = row.age_days;
  const implied_value_usd = row.implied_value_usd;
  const growth_multiplier = row.model.growth_multiplier;
  const maturity_multiplier = row.model.maturity_multiplier;
  const chain_multiplier = row.model.chain_multiplier;
  return {
    rank,
    slug,
    name,
    category,
    chains,
    tvl_usd,
    change_7d,
    mcap_usd,
    listed_at,
    is_watchlist,
    age_days,
    implied_value_usd,
    growth_multiplier,
    maturity_multiplier,
    chain_multiplier,
  };
}

export function buildRadar(snap: Snap): { board: Row[]; radar: Radar } {
  const calibration = calibrate(snap);
  const model: Tuning = { ...TUNING, base_multiple: calibration.base_multiple };
  const board = buildBoard(snap, model);
  const live = liveSet(snap);
  const early = board.filter((r) => !r.is_watchlist).length;
  const total = board.reduce((n, r) => n + r.implied_value_usd, 0);
  const as_of = snap.as_of;
  const source = snap.source;
  const floor_usd = snap.floor_usd;
  const model_version = MODEL_VERSION;
  const watchlist_size = snap.watchlist.length;
  const board_size = board.length;
  const early_size = early;
  const live_size = live.length;
  const total_implied_usd = total;
  const rows = board.map(toCompact);
  const radar: Radar = {
    as_of,
    source,
    floor_usd,
    model,
    model_version,
    calibration,
    watchlist_size,
    board_size,
    early_size,
    live_size,
    total_implied_usd,
    rows,
    live,
  };
  return { board, radar };
}

function joinStep(step: Step): string {
  let out = step.text + " Cost: " + step.cost + ". Time: " + step.time + ".";
  if (out.length > 600) {
    out = out.slice(0, 596) + "...";
  }
  if (out.length < 20) {
    out = out + " Hold the position and check the protocol's own page.";
  }
  return out;
}

function firstChain(entry: Proto): string {
  if (entry.chains.length > 0) {
    return entry.chains[0]!;
  }
  return "its main chain";
}

function secondChain(entry: Proto): string | null {
  if (entry.chains.length > 1) {
    return entry.chains[1]!;
  }
  return null;
}

function stakeFor(entry: Proto): number {
  if (entry.tvl_usd >= 5000000000) {
    return 250;
  }
  if (entry.tvl_usd >= 1000000000) {
    return 150;
  }
  if (entry.tvl_usd >= 100000000) {
    return 100;
  }
  return 50;
}

function holdFor(ageDays: number | null): number {
  if (ageDays === null) {
    return 30;
  }
  if (ageDays < 180) {
    return 60;
  }
  if (ageDays < 365) {
    return 45;
  }
  return 30;
}

const CHEAP_GAS_CHAINS = ["Solana", "Sui", "Aptos", "NEAR", "Sei"];
const L2_GAS_CHAINS = [
  "Base", "Arbitrum", "Optimism", "Linea", "Scroll", "Unichain", "Blast", "zkSync Era",
  "Polygon", "Mantle", "Celo", "Mode", "BOB", "Abstract", "Soneium",
];

function gasLabel(chain: string): string {
  if (chain === "Ethereum") {
    return "about $8 of gas per transaction";
  }
  if (CHEAP_GAS_CHAINS.includes(chain)) {
    return "about $0.05 of gas per transaction";
  }
  if (L2_GAS_CHAINS.includes(chain)) {
    return "about $0.50 of gas per transaction";
  }
  return "about $2 of gas per transaction";
}

function mentions(lower: string, words: string[]): boolean {
  for (const w of words) {
    if (lower.includes(w)) {
      return true;
    }
  }
  return false;
}

function mainAction(entry: Proto, capital: number, chain: string): string {
  const lower = (entry.category ?? "").toLowerCase();
  const name = entry.name;
  const half = Math.floor(capital / 2);
  if (mentions(lower, ["lend", "cdp", "collateral"])) {
    return "Supply $" + capital + " of USDC to " + name + " on " + chain +
      " as collateral, then borrow $" + half +
      " of stablecoin against it and repay the borrow within the week.";
  }
  if (mentions(lower, ["dex", "yield", "leveraged farm"])) {
    return "Provide $" + capital + " of liquidity to " + name + "'s deepest pool on " + chain +
      " and stake the LP receipt in its rewards gauge.";
  }
  if (mentions(lower, ["bridge"])) {
    return "Bridge $" + capital + " of USDC into " + chain + " through " + name +
      ", then use the bridged funds in one app on the destination chain.";
  }
  if (mentions(lower, ["liquid staking", "staking", "restak"])) {
    return "Stake $" + capital + " of the chain's native asset through " + name +
      " and hold the staking receipt instead of selling it.";
  }
  if (mentions(lower, ["perpetual", "derivative", "options", "basis trading"])) {
    return "Deposit $" + capital + " of USDC as margin on " + name +
      " and open one small hedged position, then close it after a day.";
  }
  if (mentions(lower, ["prediction"])) {
    return "Fund the account with $" + capital +
      " and take one small position in a market on " + name + " that settles within a week.";
  }
  if (mentions(lower, ["curator", "allocator"])) {
    return "Deposit $" + capital + " into a " + name + " vault on " + chain +
      " and keep the vault shares through one full epoch.";
  }
  if (mentions(lower, ["stable"])) {
    return "Mint or hold $" + capital + " of the stable asset through " + name + " on " + chain +
      " and keep it through one peg check.";
  }
  if (mentions(lower, ["rwa"])) {
    return "Mint $" + capital + " of the protocol's yield-bearing asset on " + chain +
      " and hold it for the full accrual period.";
  }
  if (mentions(lower, ["insurance"])) {
    return "Buy $" + capital + " of cover from " + name + " on " + chain +
      " and keep the policy active for the full term.";
  }
  if (lower === "chain") {
    return "Bridge $" + capital + " onto " + name +
      " and use it in two of the chain's own apps, keeping the funds on the chain.";
  }
  return "Deposit $" + capital + " of USDC into " + name + " on " + chain +
    " and keep the position open.";
}

export function planSteps(entry: Proto, ageDays: number | null): Step[] {
  const chain = firstChain(entry);
  const chain2 = secondChain(entry);
  const capital = stakeFor(entry);
  const half = Math.floor(capital / 2);
  const hold = holdFor(ageDays);
  const gas = gasLabel(chain);
  const action = mainAction(entry, capital, chain);
  let second: string;
  if (chain2 !== null) {
    second = "Repeat the main action once on " + chain2 + " with $" + half +
      " so the wallet is active on two chains.";
  } else {
    second = "Open a second small position in the same protocol, in a different pool or vault, with $" + half + ".";
  }
  return [
    {
      text: "Use a fresh wallet that holds only the funds you plan to farm, " +
        "and keep its seed phrase offline.",
      cost: "nothing to set up",
      time: "5 minutes",
    },
    {
      text: action,
      cost: "$" + capital + " of capital and " + gas,
      time: "15 minutes to set up",
    },
    {
      text: second,
      cost: "$" + half + " of capital and " + gasLabel(chain2 ?? chain),
      time: "15 minutes to set up",
    },
    {
      text: "Do a second, different action in the same protocol: a swap, a vote, " +
        "a deposit into another pool, or a borrow.",
      cost: gas,
      time: "10 minutes",
    },
    {
      text: "Repeat one qualifying action each week, such as a deposit, a borrow, a swap or a vote.",
      cost: gas + " a week",
      time: "10 minutes a week",
    },
    {
      text: "Hold the position for at least " + hold + " days so the activity is counted in more than one snapshot.",
      cost: "the $" + capital + " stays in the position",
      time: hold + " days",
    },
    {
      text: "Before you withdraw, open the protocol's own points or rewards page " +
        "and claim only from the link it publishes.",
      cost: "no fee to check, and never pay to claim",
      time: "10 minutes",
    },
    {
      text: "Write the wallet, the dates and every transaction in a farm log, and plan the exit: " +
        "unwind in two steps and never pay a fee to claim.",
      cost: "nothing but the log",
      time: "5 minutes",
    },
  ];
}

export function parseSnapshot(text: string): Snap {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError("snapshot.json is not JSON");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new SnapshotError("snapshot.json is not a JSON object");
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError("snapshot.json has no as_of date");
  }
  if (typeof o.source !== "string") {
    throw new SnapshotError("snapshot.json has no source");
  }
  if (typeof o.floor_usd !== "number" || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError("snapshot.json has no floor_usd");
  }
  if (!Array.isArray(o.protocols)) {
    throw new SnapshotError("snapshot.json has no protocols array");
  }
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== "string")) {
    throw new SnapshotError("snapshot.json has no watchlist of slugs");
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      throw new SnapshotError("snapshot.json's protocol " + i + " is not an object");
    }
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== "string" || typeof p.name !== "string" || typeof p.tvl_usd !== "number" || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError("snapshot.json's protocol " + i + " lacks a slug, a name or a TVL");
    }
    const slug = p.slug;
    const name = p.name;
    const category = typeof p.category === "string" ? p.category : null;
    const chains = Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === "string") : [];
    const tvl_usd = p.tvl_usd;
    const change_7d = typeof p.change_7d === "number" && Number.isFinite(p.change_7d) ? p.change_7d : null;
    const mcap_usd = typeof p.mcap_usd === "number" && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null;
    const listed_at = typeof p.listed_at === "string" ? p.listed_at : null;
    const gecko_id = typeof p.gecko_id === "string" ? p.gecko_id : null;
    const symbol = typeof p.symbol === "string" ? p.symbol : null;
    return { slug, name, category, chains, tvl_usd, change_7d, mcap_usd, listed_at, gecko_id, symbol };
  });
  const as_of = o.as_of;
  const source = o.source;
  const floor_usd = o.floor_usd;
  const watchlist = o.watchlist as string[];
  return { as_of, source, floor_usd, protocols, watchlist };
}

export function boardIssue(board: Row[], snap: Snap): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snap.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return "the board misses " + missing.length + " watchlist slug" + (missing.length === 1 ? "" : "s") + ": " + missing.slice(0, 5).join(", ");
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) {
      return "rank " + (i + 1) + " is " + ranks[i];
    }
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return "row " + (i + 1) + " outranks row " + i + " on implied value";
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return "all " + board.length + " rows share the same implied value $" + board[0]!.implied_value_usd + ": a board that ranks nothing by value is not a ranking";
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) {
      return r.slug + " has " + steps.length + " farm steps";
    }
    for (const s of steps) {
      if (s.length < 20 || s.length > 600) {
        return r.slug + " has a farm step of " + s.length + " characters";
      }
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return r.slug + " has implied value " + r.implied_value_usd;
    }
  }
  return null;
}

export function dataScript(radar: Radar): string {
  return "window.RADAR=" + JSON.stringify(radar) + ";\n";
}
