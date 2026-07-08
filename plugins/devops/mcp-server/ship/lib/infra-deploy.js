/**
 * @module ship/lib/infra-deploy
 * @description Detect out-of-band deploy artifacts in a branch diff (#243).
 *
 * A plain code merge to `main` does NOT apply DB migrations or deploy
 * serverless/edge functions — those are deployed out-of-band (a separate
 * `supabase db push`, a function deploy, a manual `apply_migration`). When a
 * ship's diff touches such paths, merging the code leaves it referencing infra
 * that was never applied: the change is silently NOT live even though ship
 * reported "all done". This module flags those paths so the pipeline can raise
 * a mandatory post-merge deploy gate instead of a clean completion card.
 *
 * Stack-agnostic by design: only the default globs mention Supabase paths.
 * Consumers override the globs via the project ship-extension `reference.md`.
 */

// Sensible, stack-agnostic defaults. `**/migrations/**` covers Rails/Django/
// Prisma/Supabase/Flyway layouts; the two `supabase/` entries cover the
// most common serverless target. Override per-project via reference.md.
export const DEFAULT_OUT_OF_BAND_GLOBS = [
  "**/migrations/**",
  "supabase/migrations/**",
  "supabase/functions/**",
];

/**
 * Compile a minimal path glob to a RegExp anchored at both ends.
 *
 * Supported syntax (POSIX-forward-slash paths, repo-root-relative):
 *   - `**` between slashes (`a/&#42;&#42;/b`) or leading (`&#42;&#42;/b`) matches zero or
 *     more full path segments.
 *   - `**` elsewhere (`a/&#42;&#42;`) matches the rest of the path, crossing slashes.
 *   - `*` matches within a single segment (no slash).
 *   - every other character is matched literally (regex metachars escaped).
 *
 * Backslashes are normalized to forward slashes so Windows-style diff paths
 * (rare, but git can emit them via some tooling) still match.
 */
export function globToRegExp(glob) {
  const g = String(glob).replace(/\\/g, "/");
  let re = "";
  let i = 0;
  while (i < g.length) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        // `**` — a globstar. When bounded by a slash on the right (or at the
        // start), it spans whole segments including zero: `(?:[^/]*/)*`.
        if (g[i + 2] === "/") {
          re += "(?:[^/]*/)*";
          i += 3;
        } else if (i + 2 === g.length && (i === 0 || g[i - 1] === "/")) {
          // trailing `/**` (or bare `**`) — match the remainder incl. slashes.
          re += ".*";
          i += 2;
        } else {
          // `**` not slash-delimited — treat as "cross anything".
          re += ".*";
          i += 2;
        }
      } else {
        // single `*` — within a segment only.
        re += "[^/]*";
        i += 1;
      }
    } else if (".+?^${}()|[]\\".includes(c)) {
      re += "\\" + c;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  return new RegExp("^" + re + "$");
}

/**
 * Categorize a matched path into a human-readable deploy kind. Generic keyword
 * heuristics only (no stack lock-in): the gate names WHAT needs deploying.
 */
function categorize(file) {
  const f = file.toLowerCase();
  if (f.includes("/migrations/") || f.startsWith("migrations/")) return "migration";
  if (f.includes("/functions/") || f.startsWith("functions/")) return "function";
  return "infra";
}

/**
 * Scan a list of branch-changed files for out-of-band deploy artifacts.
 *
 * @param {string[]} files - repo-root-relative paths changed on the branch.
 * @param {string[]} [globs] - override globs; falls back to the defaults.
 * @returns {{ detected: boolean, globs: string[], files: string[],
 *             matched: Array<{ file: string, glob: string, kind: string }>,
 *             kinds: string[] }}
 */
export function detectOutOfBandDeploys(files, globs = DEFAULT_OUT_OF_BAND_GLOBS) {
  const activeGlobs = Array.isArray(globs) && globs.length ? globs : DEFAULT_OUT_OF_BAND_GLOBS;
  const compiled = activeGlobs.map((glob) => ({ glob, re: globToRegExp(glob) }));
  const matched = [];
  for (const file of Array.isArray(files) ? files : []) {
    if (!file) continue;
    for (const { glob, re } of compiled) {
      if (re.test(file)) {
        matched.push({ file, glob, kind: categorize(file) });
        break;
      }
    }
  }
  const kinds = [...new Set(matched.map((m) => m.kind))];
  return {
    detected: matched.length > 0,
    globs: activeGlobs,
    files: matched.map((m) => m.file),
    matched,
    kinds,
  };
}
