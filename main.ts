// token-radar-01 round 3: read the sealed snapshot, score the board with the
// fitted radar-3 model, and write the ranked board, the dashboard data, the
// dashboard, the screenshots and the dossier the judge reads.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// The program is a pure function of the snapshot: every coefficient is refit
// from the sealed input on every run, and the run is deterministic — the same
// snapshot always writes the same bytes.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnap } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The dossier's text cap and the screenshot caps, as the rules state them. */
const TEXT_CAP_BYTES = 65_536;
const SHOT_CAP = { max: 4, max_bytes: 524_288 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** A `--name <value>` argument, or the fallback when it is absent. */
function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

const inputGiven = flag('input', '/input');
const inputFile = inputGiven.endsWith('.json') ? inputGiven : join(inputGiven, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`radar-3: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const doc = parseSnap(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(doc);
const problem = boardIssue(board, doc);
if (problem !== null) {
  process.stderr.write(`radar-3: the model wrote a board the gate refuses: ${problem}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/** Copy a directory's regular files into `to`, skipping dot-names, and report what landed. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const landed: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    landed.push(name);
  }
  return landed;
}

const dashFiles = copyDir(join(here, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyDir(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`radar-3: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) {
    process.stderr.write(`radar-3: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: TEXT_CAP_BYTES, screenshots: SHOT_CAP, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

const top = board[0]!;
process.stdout.write(
  `radar-3: ${doc.protocols.length} protocols, ${doc.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `radar-3: fitted log10(mcap) = ${radar.fit_intercept} + ${radar.fit_slope} * log10(tvl) over ${radar.live_size} live protocols; ` +
    `blend LOO RMSE ${radar.validation[3]!.loo_rmse.toFixed(4)} dex vs flat ${radar.validation[0]!.loo_rmse.toFixed(4)}\n` +
    `radar-3: #1 ${top.slug} at $${top.implied_value_usd.toLocaleString('en-US')}, total implied $${radar.total_implied_usd.toLocaleString('en-US')}\n` +
    `radar-3: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (${dashFiles.length} files), ` +
    `${join(outDir, 'screenshots')} (${shots.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
