#!/usr/bin/env node
/**
 * @module ship/hygiene-bg
 * @description Detached SessionStart hygiene run (#573), spawned by
 *   hooks/session-start/ss.git.hygiene.js. Runs the same auto-clean a ship
 *   runs (trigger "session": removes, never nudges) and writes the card lines
 *   to DEVOPS_HYGIENE_RESULT_FILE — only when there is something to show, and
 *   atomically, so the next SessionStart never reads a half-written file.
 *   Repos in file-only mode or owned by an ancestor directory are skipped.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { detectRepoMode, refusesGitWrites } from "./lib/repo-mode.js";
import { runHygiene } from "./lib/hygiene.js";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const config = require(path.join(here, "..", "..", "hooks", "lib", "devops-config.js"));

const cwd = process.cwd();
const out = process.env.DEVOPS_HYGIENE_RESULT_FILE;
const lang = process.env.DEVOPS_HYGIENE_LANG === "en" ? "en" : "de";

try {
  const mode = detectRepoMode(cwd);
  if (mode === "unknown" || refusesGitWrites(mode)) process.exit(0);
  const { values } = config.load(cwd);
  const res = runHygiene({
    cwd, trigger: "session", lang, stateKey: config.mainCheckoutRoot(cwd),
    settings: { ...values.cleanup, nudge: false },
  });
  const card = (res && res.card) || {};
  if (out && (card.tests || card.risk)) {
    const tmp = `${out}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ at: new Date().toISOString(), repo: path.basename(config.mainCheckoutRoot(cwd)), card }));
    fs.renameSync(tmp, out);
  }
} catch {
  // best effort — a failed background run leaves no result and retries tomorrow
}
