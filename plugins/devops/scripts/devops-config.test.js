import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { invalidEntries } = require("./devops-config.js");

/** AUD-C053: a hand-edited "autoClean": "false" (string) silently resolved to true. */
describe("devops-config CLI — wrong-typed hand edits are named, never silent", () => {
  test("a string boolean is reported with its strict fix; a real boolean is not", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "dc-home-"));
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), "dc-proj-"));
    try {
      fs.mkdirSync(path.join(proj, ".claude"));
      fs.writeFileSync(path.join(proj, ".claude", "devops-config.json"),
        JSON.stringify({ cleanup: { autoClean: "false", nudgeThreshold: "80" } }));
      fs.mkdirSync(path.join(home, ".claude"));
      fs.writeFileSync(path.join(home, ".claude", "devops-config.json"), JSON.stringify({ cleanup: { autoClean: false } }));
      const bad = invalidEntries(proj, { home });
      const auto = bad.find((e) => e.key === "cleanup.autoClean");
      expect(auto).toMatchObject({ scope: "project", raw: "false", fix: false });
      expect(bad.find((e) => e.key === "cleanup.nudgeThreshold")).toMatchObject({ raw: "80", fix: 80 });
      expect(bad.some((e) => e.scope === "global")).toBe(false);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(proj, { recursive: true, force: true });
    }
  });

  test("an unparseable value is reported without a fix", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "dc-home-"));
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), "dc-proj-"));
    try {
      fs.mkdirSync(path.join(proj, ".claude"));
      fs.writeFileSync(path.join(proj, ".claude", "devops-config.json"), JSON.stringify({ cleanup: { autoClean: "maybe" } }));
      const [e] = invalidEntries(proj, { home });
      expect(e).toMatchObject({ key: "cleanup.autoClean", raw: "maybe", fix: null });
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(proj, { recursive: true, force: true });
    }
  });
});
