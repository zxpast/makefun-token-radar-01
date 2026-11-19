// Token Radar, round 5 — entrypoint.
//
// Reads the sealed snapshot, builds the board with lib/model.ts, and writes
// /output/board.json, /output/data.js, the dashboard, the screenshots and
// /output/dossier.json. Node 22, standard library only. Deterministic: the
// same input bytes always produce the same output bytes (seeded generators,
// no wall-clock reads, ties broken by slug).
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//   (the grader runs: node /bot/main.ts with /input/snapshot.json and /output)

import { readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBoard, type BuiltBoard, type Snapshot } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const TEXT_MAX_BYTES = 65536;

function argValue(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1]! : fallback;
}

/** The gate's own rules, checked here before anything is written. */
function validateBoard(built: BuiltBoard, snapshot: Snapshot): void {
  const rows = built.rows;
  if (rows.length < 100 || rows.length > 4000) throw new Error(`board has ${rows.length} rows, gate needs 100-4000`);
  const slugs = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.rank !== i + 1) throw new Error(`row ${r.slug} has rank ${r.rank}, expected ${i + 1}`);
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      throw new Error(`row ${r.slug} has a bad implied value ${r.implied_value_usd}`);
    }
    if (i > 0 && r.implied_value_usd > rows[i - 1]!.implied_value_usd) {
      throw new Error(`board rises at rank ${r.rank}: values must not rise as rank ascends`);
    }
    if (slugs.has(r.slug)) throw new Error(`duplicate slug ${r.slug}`);
    slugs.add(r.slug);
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      throw new Error(`row ${r.slug} has ${r.farm_steps.length} farm steps, gate needs 3-12`);
    }
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) throw new Error(`row ${r.slug} has a farm step of ${t.length} chars, gate needs 20-600`);
    }
  }
  const snapSlugs = new Set(snapshot.protocols.map((p) => p.slug));
  for (const s of slugs) if (!snapSlugs.has(s)) throw new Error(`row ${s} is not a snapshot protocol`);
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) throw new Error(`watchlist not covered: ${missing.join(", ")}`);
  const nonWatch = rows.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  if (nonWatch < 60) throw new Error(`only ${nonWatch} non-watchlist rows, gate needs >= 60`);
  const allSame = rows.every((r) => r.implied_value_usd === rows[0]!.implied_value_usd);
  if (allSame) throw new Error("all implied values are equal: not a ranking");
}

function main(): void {
  const inputPath = argValue("--input", "/input/snapshot.json");
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "./out";
  const snapshot = JSON.parse(readFileSync(inputPath, "utf8")) as Snapshot;
  const built = buildBoard(snapshot);

  // The accounting must add up to the snapshot, or the board is wrong.
  const a = built.accounting;
  const accounted =
    a.ranked +
    a.withToken +
    a.byCategory.reduce((s, c) => s + c.n, 0) +
    a.versioned +
    a.wrapped +
    a.exchangeNamed +
    a.kin;
  if (accounted !== a.total) {
    throw new Error(`accounting sums to ${accounted}, snapshot holds ${a.total}`);
  }
  validateBoard(built, snapshot);
  if (built.compCheck.violations > 0) {
    throw new Error(`${built.compCheck.violations} board rows sit outside their own 12-comp ratio range by > 1 dex`);
  }

  mkdirSync(outDir, { recursive: true });
  const boardRows = built.rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
    tvl_usd: r.tvl_usd,
    category: r.category,
    verdict: r.verdict,
    net_usd: Math.round(r.netUsd * 100) / 100,
  }));
  writeFileSync(join(outDir, "board.json"), JSON.stringify({ rows: boardRows }, null, 2) + "\n");
  const payload = {
    meta: built.meta,
    watchlist: snapshot.watchlist,
    rows: built.rows,
    backtest: built.backtest,
    fiveFoldShipped: built.fiveFoldShipped,
    fiveFoldV2Half: built.fiveFoldV2Half,
    accounting: built.accounting,
    launchOdds: built.launchOdds,
    totals: built.totals,
    r2check: built.r2check,
    compCheck: built.compCheck,
  };
  writeFileSync(join(outDir, "data.js"), `window.RADAR = ${JSON.stringify(payload)};\n`);

  cpSync(join(REPO_ROOT, "dashboard"), join(outDir, "dashboard"), { recursive: true });
  cpSync(join(REPO_ROOT, "screenshots"), join(outDir, "screenshots"), { recursive: true });
  const dossier = buildDossier(outDir, { text_max_bytes: TEXT_MAX_BYTES });
  writeFileSync(join(outDir, "dossier.json"), dossier);

  const doc = JSON.parse(Buffer.from(dossier).toString("utf8")) as { text: string };
  const shipped = built.backtest[3]!;
  console.log(`board: ${built.rows.length} rows, total implied $${built.totals.totalImplied.toLocaleString("en-US")}`);
  console.log(`top 5: ${built.rows.slice(0, 5).map((r) => `${r.slug} $${(r.implied_value_usd / 1e6).toFixed(1)}M`).join(", ")}`);
  console.log(
    `fit: log10(mcap) = ${built.meta.fit.intercept.toFixed(4)} + ${built.meta.fit.slope.toFixed(4)} log10(TVL), live n=${built.meta.liveN}`,
  );
  console.log(
    `shipped LOO ${shipped.loo.rmse.toFixed(4)} dex, median miss x${shipped.loo.medMissX.toFixed(2)}, within-3x ${(shipped.loo.within3x * 100).toFixed(0)}%, ` +
      `R2oos ${shipped.loo.r2oos.toFixed(3)}, Spearman ${shipped.loo.spearman.toFixed(3)}; 5-fold ${built.fiveFoldShipped.mean.toFixed(4)}`,
  );
  console.log(
    `farm: ${built.totals.farm} FARM / ${built.totals.thin} THIN / ${built.totals.skip} SKIP, median net $${built.totals.medianNet.toFixed(2)}, ` +
      `best/hour $${built.totals.bestPerHour.toFixed(2)} (${built.totals.bestPerHourSlug})`,
  );
  console.log(
    `r2check: top-10 overlap full ${built.r2check.top10OverlapFull}/10, shared ${built.r2check.top10OverlapShared}/10, ` +
      `median shift shared ${built.r2check.medianShiftShared}; comp violations ${built.compCheck.violations}, max log gap ${built.compCheck.maxLogGap.toFixed(3)}`,
  );
  console.log(`dossier: ${dossier.length} bytes, text ${Buffer.byteLength(doc.text, "utf8")} bytes (cap ${TEXT_MAX_BYTES})`);
}

main();
