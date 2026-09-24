import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * #476: the doc generators are ES modules in a package without "type". As
 * .js, node parsed each one as CommonJS, failed, reparsed it as ESM and
 * printed a MODULE_TYPELESS_PACKAGE_JSON warning on every ship. As .mjs the
 * type is declared by the extension.
 */
describe("doc generators run without a module-type warning", () => {
  for (const [name, args] of [
    ["gen-dk-index.mjs", [join(__dirname, "..", "deep-knowledge")]],
    ["gen-readme-sections.mjs", ["--check", join(__dirname, "..", "..", "..")]],
  ]) {
    test(name, () => {
      const r = spawnSync(process.execPath, [join(__dirname, name), ...args], { encoding: "utf8" });
      expect(r.status).toBe(0);
      expect(r.stderr).not.toMatch(/Module type|MODULE_TYPELESS/);
    }, 30_000);
  }
});
