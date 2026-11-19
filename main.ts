// Token Radar's entrypoint: the sealed snapshot in, the board and the dashboard out.
//
// Run it from the repository root, with the snapshot beside it:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
//
// Inside the grader's container the snapshot sits at /input/snapshot.json and the output
// goes to /output. Either way the program is a pure function of the snapshot: it scores the
// board, writes board.json and the dashboard's data.js, copies dashboard/ and screenshots/
// across, and writes dossier.json last, from the vendored library, so the scorer can rebuild
// the same bytes from the same files. Nothing here reaches the network, and nothing here
// reads anything but the snapshot and this repository.

import { buildDossier } from "./vendor/makefun-board.ts";
import { boardIssue, buildRadar, dataScript, parseSnapshot } from "./lib/model.ts";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

const TEXT_CAP = 65536;
const SHOT_CAP = { max: 4, max_bytes: 524288 };
const DASH_CAP = { max_files: 400, max_bytes: 4194304 };
const SHOT_NAME = new RegExp("^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$");

function flagValue(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--" + name && i + 1 < argv.length) {
      return argv[i + 1]!;
    }
    if (a.startsWith("--" + name + "=")) {
      return a.slice(name.length + 3);
    }
  }
  return fallback;
}

function fail(message: string, code: number): never {
  process.stderr.write("token radar: " + message + "\n");
  process.exit(code);
}

const inputArg = flagValue("input", "/input");
const inputFile = inputArg.endsWith(".json") ? inputArg : join(inputArg, "snapshot.json");
if (!existsSync(inputFile)) {
  fail("no snapshot at " + inputFile + ": pass --input <snapshot.json|directory> or mount the sealed /input", 2);
}
const out = flagValue("output", process.env.MAKEFUN_OUTPUT_DIR ?? "/output");

const snap = parseSnapshot(readFileSync(inputFile, "utf8"));
const { board, radar } = buildRadar(snap);
const issue = boardIssue(board, snap);
if (issue !== null) {
  fail("the model wrote a board the gate refuses: " + issue, 1);
}

const again = buildRadar(snap).board;
if (JSON.stringify({ rows: again }) !== JSON.stringify({ rows: board })) {
  fail("the board is not deterministic across builds", 1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "board.json"), JSON.stringify({ rows: board }) + "\n");
writeFileSync(join(out, "data.js"), dataScript(radar));

function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) {
    return [];
  }
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith(".")) {
      continue;
    }
    const path = join(from, name);
    if (!statSync(path).isFile()) {
      continue;
    }
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyDir(join(here, "dashboard"), join(out, "dashboard"));
const shots = copyDir(join(here, "screenshots"), join(out, "screenshots"));
if (shots.length < 3) {
  fail("screenshots/ holds " + shots.length + " image" + (shots.length === 1 ? "" : "s") + ": hand in 3, the board, a detail view and a filtered view", 1);
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) {
    fail("screenshots/" + name + ": a name is letters, digits and . _ -, 1 to 128 characters", 1);
  }
}

writeFileSync(
  join(out, "dossier.json"),
  buildDossier(out, { text_max_bytes: TEXT_CAP, screenshots: SHOT_CAP, dashboard: DASH_CAP }),
);

process.stdout.write(
  "token radar: " +
    snap.protocols.length +
    " protocols, " +
    snap.watchlist.length +
    " on the watchlist, " +
    board.length +
    " rows scored (" +
    radar.early_size +
    " early, " +
    radar.live_size +
    " live set aside)\n" +
    "token radar: model " +
    radar.model_version +
    ", base x" +
    radar.calibration.base_multiple.toFixed(4) +
    " calibrated from " +
    radar.calibration.live_protocols +
    " live-token protocols (median mcap/TVL " +
    radar.calibration.median_mcap_tvl.toFixed(4) +
    "), total implied $" +
    radar.total_implied_usd.toLocaleString("en-US") +
    "\n" +
    "token radar: wrote " +
    join(out, "board.json") +
    ", " +
    join(out, "data.js") +
    ", " +
    join(out, "dashboard") +
    " (" +
    dashFiles.length +
    " files), " +
    join(out, "screenshots") +
    " (" +
    shots.length +
    " images) and " +
    join(out, "dossier.json") +
    "\n",
);
