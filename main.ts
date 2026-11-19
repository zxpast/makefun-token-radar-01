// Token Radar, round 4 — entrypoint.
//
// Reads the sealed snapshot, scores the board under the V2_half model,
// writes board.json + data.js, copies the dashboard and the screenshots,
// and builds the dossier the judge reads. Run from the repo root:
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
//
// The output directory is created, never deleted: the grader runs this as
// an unprivileged user with a root-owned output directory, and removing the
// directory itself fails with EPERM there. Files are overwritten in place.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard, buildRadar, boardIssue, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** The directory this file lives in: dashboard/ and screenshots/ are copied from beside it, not from the caller's cwd. */
const here = fileURLToPath(new URL('.', import.meta.url));

/** The CLI flags this entrypoint accepts. */
interface Args {
  input: string;
  output: string;
}

function parseArgs(argv: string[]): Args {
  let input = '/input/snapshot.json';
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? 'out';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--input' && i + 1 < argv.length) input = argv[++i]!;
    else if (arg === '--output' && i + 1 < argv.length) output = argv[++i]!;
    else if (arg.startsWith('--input=')) input = arg.slice('--input='.length);
    else if (arg.startsWith('--output=')) output = arg.slice('--output='.length);
  }
  if (existsSync(input) && statSync(input).isDirectory()) input = join(input, 'snapshot.json');
  return { input, output };
}

/** Copy every file in a directory, flat, into the output directory. */
function copyFlatDir(fromDir: string, toDir: string): string[] {
  const copied: string[] = [];
  if (!existsSync(fromDir)) return copied;
  mkdirSync(toDir, { recursive: true });
  for (const name of readdirSync(fromDir).sort()) {
    const from = join(fromDir, name);
    if (!statSync(from).isFile()) continue;
    copyFileSync(from, join(toDir, name));
    copied.push(name);
  }
  return copied;
}

function money(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

function main(): void {
  const started = Date.now();
  const { input, output } = parseArgs(process.argv.slice(2));
  const raw = JSON.parse(readFileSync(input, 'utf8')) as unknown;
  const snapshot = parseSnapshot(raw);
  const { board, watchlistCount, earlyCount } = buildBoard(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) {
    console.error(`board issue: ${issue}`);
    process.exit(1);
  }
  const radar = buildRadar(snapshot);
  const totalImplied = board.reduce((sum, row) => sum + row.implied_value_usd, 0);

  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'board.json'), `${JSON.stringify({ rows: board }, null, 2)}\n`, 'utf8');
  writeFileSync(join(output, 'data.js'), dataScript(radar), 'utf8');
  const dashboardFiles = copyFlatDir(join(here, 'dashboard'), join(output, 'dashboard'));
  const screenshotFiles = copyFlatDir(join(here, 'screenshots'), join(output, 'screenshots'));
  const dossier = buildDossier(output, {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 524288 },
    dashboard: { max_files: 400, max_bytes: 4194304 },
  });
  writeFileSync(join(output, 'dossier.json'), dossier, 'utf8');

  const v2 = radar.validation.loo.find((m) => m.name === 'V2_half (shipped)')!;
  console.log(`board rows: ${board.length} (${watchlistCount} watchlist + ${earlyCount} early)`);
  console.log(`total implied value: ${money(totalImplied)}`);
  console.log('top 5:');
  for (const row of board.slice(0, 5)) {
    console.log(`  ${row.rank}. ${row.slug} ${money(row.implied_value_usd)}`);
  }
  console.log(`fitted line: log10(mcap) = ${radar.validation.fitted_intercept} + ${radar.validation.fitted_slope} * log10(TVL)  (live n=${radar.validation.live_n}, flat median x${radar.validation.flat_median_ratio})`);
  console.log(`V2_half LOO RMSE: ${v2.loo_rmse}  rep-5-fold: ${v2.fivefold_rmse}  R2oos: ${v2.r2oos}  Spearman: ${v2.spearman}`);
  console.log(`dashboard files copied: ${dashboardFiles.join(', ')}`);
  console.log(`screenshots copied: ${screenshotFiles.join(', ')}`);
  console.log(`dossier: ${dossier.length} bytes`);
  console.log(`done in ${Date.now() - started} ms`);
}

main();
