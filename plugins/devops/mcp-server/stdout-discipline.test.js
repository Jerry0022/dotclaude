import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Stdout discipline for every MCP server module (#324).
 *
 * On a stdio MCP server, stdout IS the JSON-RPC wire. A single stray
 * `console.log` interleaves non-protocol bytes into the framing and the client
 * either drops the connection or reports a parse error — a failure mode that is
 * invisible in unit tests and catastrophic at session start, because it looks
 * exactly like a boot timeout.
 *
 * Rule: nothing under mcp-server/ writes to stdout except the transport itself.
 * Logging goes to stderr (`console.error` / `process.stderr.write`).
 *
 * Escape hatch: a line carrying the marker `// stdout-ok` is allowed. It exists
 * for the one legitimate case — `index.js --render-card`, a CLI entry point
 * that prints the card and exits before any transport is created. Requiring the
 * marker per line keeps the exception explicit and reviewable instead of
 * maintaining a path allow-list that silently widens.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MARKER = "// stdout-ok";
const FORBIDDEN = [
  { name: "console.log(", re: /\bconsole\s*\.\s*log\s*\(/ },
  { name: "process.stdout.write(", re: /\bprocess\s*\.\s*stdout\s*\.\s*write\s*\(/ },
];

/** All non-test .js files under mcp-server/, node_modules excluded. */
function collect(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".js") && !entry.name.endsWith(".test.js")) {
      out.push(full);
    }
  }
  return out;
}

const files = collect(HERE);

describe("mcp-server stdout discipline", () => {
  test("the walk finds the real server modules (guards against an empty pass)", () => {
    const rel = files.map((f) => path.relative(HERE, f).split(path.sep).join("/"));
    expect(rel).toContain("index.js");
    expect(rel).toContain("ship/index.js");
    expect(rel).toContain("issues/index.js");
    expect(files.length).toBeGreaterThan(10);
  });

  test("no unmarked stdout write outside the transport", () => {
    const violations = [];
    for (const file of files) {
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (line.includes(MARKER)) return;
        for (const { name, re } of FORBIDDEN) {
          if (re.test(line)) {
            violations.push(`${path.relative(HERE, file)}:${i + 1} → ${name}`);
          }
        }
      });
    }
    expect(violations).toEqual([]);
  });

  test("the escape hatch is used at most where the CLI renderer needs it", () => {
    const marked = [];
    for (const file of files) {
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!line.includes(MARKER)) return;
        if (FORBIDDEN.some(({ re }) => re.test(line))) {
          marked.push(path.relative(HERE, file).split(path.sep).join("/") + ":" + (i + 1));
        }
      });
    }
    // One exception, in the offline card renderer. Adding another must be a
    // deliberate edit of this expectation, not a silent drive-by.
    expect(marked.map((m) => m.split(":")[0])).toEqual(["index.js"]);
  });
});
