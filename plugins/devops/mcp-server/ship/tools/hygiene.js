/**
 * @tool ship_hygiene
 * @description After a successful ship or promote: remove old leftovers that
 *   provably landed (only once the age gate opens, after a ship only) and
 *   decide whether the card suggests the cleanup page. Returns ready-made card
 *   lines (`card.tests`, `card.open`) for do-ship Step 6. Logic:
 *   ../lib/hygiene.js; settings: hooks/lib/devops-config.js (`cleanup`).
 */

import { z } from "zod";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { detectRepoMode, refusesGitWrites, probeTimeoutError } from "../lib/repo-mode.js";
import { runHygiene } from "../lib/hygiene.js";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const config = require(path.join(here, "..", "..", "..", "hooks", "lib", "devops-config.js"));

export const schema = z.object({
  cwd: z.string().describe("Working directory of the target repo (required — the same cwd the other ship tools got)"),
  trigger: z.enum(["ship", "promote"]).describe("'ship' after a merged ship (auto-clean + nudge), 'promote' after a promotion-only run (nudge only, removes nothing)"),
  lang: z.enum(["de", "en"]).default("de").describe("Language of the ready-made card lines"),
});

export async function handler(params) {
  const { cwd, trigger, lang = "de" } = params;
  if (!cwd) throw new Error("cwd is required — MCP server runs in the plugin directory, not the target repo");
  const mode = detectRepoMode(cwd);
  if (mode === "unknown") {
    return { success: false, reason: "git-probe-timeout", error: probeTimeoutError(cwd), card: {} };
  }
  if (refusesGitWrites(mode)) {
    return { success: true, skipped: true, reason: mode === "none" ? "file-only-mode" : "foreign-repo-root", card: {} };
  }
  const { values } = config.load(cwd);
  return runHygiene({ cwd, trigger, lang, settings: values.cleanup, stateKey: config.mainCheckoutRoot(cwd) });
}
