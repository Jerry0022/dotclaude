import { describe, test, expect, vi, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Spawns the real hook; see post.flow.completion.test.js for why the timeout
// is generous under a full parallel run.
vi.setConfig({ testTimeout: 30_000 });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "post.concept.gate.js");

// A minimal live-bridge page (every marker the gate requires) with a slot for
// extra body content.
const page = extra => `<!doctype html><html data-template="free">
<body>
<script type="application/json" id="concept-decisions">{"submitted":false}</script>
<div id="panel-ready"><div class="iteration-tabs"></div>
  <button id="submit-iterate-btn">Zur nächsten Iteration</button>
  <button id="submit-implement-btn">Mit Feedback implementieren</button>
  <div id="connection-status" data-state="connecting"></div></div>
${extra}
<script>function pollHeartbeat(){}</script>
</body></html>`;

const spec = extra => JSON.stringify({
  items: [{ id: "a", label: "A" }],
  axes: [{ id: "x", label: "X", columns: [{ id: "c1", label: "C1" }] }],
  proposal: [["a", "x.c1"]],
  ...extra,
});
const mapping = (id, s) => `<section data-mapping="${id}" id="${id}"><script type="application/json" data-mapping-spec>${s}</script></section>`;

const projects = [];
afterAll(() => {
  for (const dir of projects) fs.rmSync(dir, { recursive: true, force: true });
});

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "concept-gate-"));
  projects.push(dir);
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } })
  );
  fs.mkdirSync(path.join(dir, "docs", "concepts"), { recursive: true });
  return dir;
}

function runHook(dir, html) {
  const file = path.join(dir, "docs", "concepts", "2026-09-13-x.html");
  fs.writeFileSync(file, html);
  for (let attempt = 0; ; attempt++) {
    const res = spawnSync(process.execPath, [HOOK], {
      cwd: dir,
      input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: file, content: html }, cwd: dir }),
      encoding: "utf8",
    });
    if (res.status !== null || attempt >= 3) {
      if (res.status === null) throw new Error(`hook never started after ${attempt + 1} attempts: ${res.error}`);
      return res;
    }
  }
}

describe("post.concept.gate (hook)", () => {
  test("a valid page with a live mapping passes (exit 0)", () => {
    const res = runHook(project(), page(`<section data-iteration="1" data-active>${mapping("m1", spec())}</section>`));
    expect(res.status).toBe(0);
    expect(res.stderr).toBe("");
  });

  test("a frozen mapping without submitted blocks (exit 2) and names the rule", () => {
    const html = page(
      `<section data-iteration="1">${mapping("m1", spec())}</section>` +
      `<section data-iteration="2" data-active>${mapping("m2", spec())}</section>`
    );
    const res = runHook(project(), html);
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/BLOCKED/);
    expect(res.stderr).toMatch(/Mapping spec problems/);
    expect(res.stderr).toMatch(/frozen-without-submitted: mapping "m1"/);
    expect(res.stderr).not.toMatch(/"m2"/);
  });

  test("a frozen mapping WITH a complete submitted passes", () => {
    const html = page(
      `<section data-iteration="1">${mapping("m1", spec({ submitted: { cells: { x: [["a", "x.c1"]] } } }))}</section>` +
      `<section data-iteration="2" data-active>${mapping("m2", spec())}</section>`
    );
    expect(runHook(project(), html).status).toBe(0);
  });
});
