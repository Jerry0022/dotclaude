import { describe, test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanWorkflowText, scanWorkflows } from "./workflow-hygiene.js";

const rules = (text) => scanWorkflowText(text).map((f) => f.rule).sort();

describe("scanWorkflowText", () => {
  test("bare upload step on a PR workflow → all three findings", () => {
    const yml = [
      "name: CI",
      "on:",
      "  pull_request:",
      "jobs:",
      "  test:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - name: Upload report",
      "        if: ${{ !cancelled() }}",
      "        uses: actions/upload-artifact@v4",
      "        with:",
      "          name: report",
      "          path: out/",
    ].join("\n");
    expect(rules(yml)).toEqual(["pr-concurrency", "upload-artifact-fatal", "upload-artifact-retention"]);
  });

  test("a hardened workflow is clean", () => {
    const yml = [
      "on: [push, pull_request]",
      "concurrency:",
      "  group: ci-${{ github.ref }}",
      "  cancel-in-progress: true",
      "jobs:",
      "  t:",
      "    steps:",
      "      - name: Upload",
      "        if: failure()",
      "        continue-on-error: true",
      "        uses: actions/upload-artifact@v4",
      "        with:",
      "          retention-days: 3",
      "      - name: Next step",
      "        run: echo hi",
    ].join("\r\n");
    expect(rules(yml)).toEqual([]);
  });

  test("a later step's continue-on-error does not count for the upload", () => {
    const yml = [
      "on:",
      "  push:",
      "jobs:",
      "  t:",
      "    steps:",
      "      - if: failure()",
      "        uses: actions/upload-artifact@v4",
      "        with:",
      "          retention-days: 1",
      "      - run: flaky",
      "        continue-on-error: true",
    ].join("\n");
    expect(rules(yml)).toEqual(["upload-artifact-fatal"]);
  });

  test("a hand-off upload (no failure/always guard) stays fatal — retention only", () => {
    const yml = "on:\n  push:\njobs:\n  b:\n    steps:\n      - uses: actions/upload-artifact@v4\n        with:\n          name: dist\n";
    expect(rules(yml)).toEqual(["upload-artifact-retention"]);
  });

  test("push/schedule-only workflows need no concurrency group", () => {
    expect(rules("on:\n  schedule:\n    - cron: '0 2 * * *'\njobs: {}\n")).toEqual([]);
  });
});

describe("scanWorkflows", () => {
  test("reports file + line, and tolerates a repo without workflows", () => {
    const root = mkdtempSync(join(tmpdir(), "wfh-"));
    expect(scanWorkflows(root).findings).toEqual([]);
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    writeFileSync(join(root, ".github", "workflows", "ci.yml"),
      "on:\n  push:\njobs:\n  t:\n    steps:\n      - if: always()\n        uses: actions/upload-artifact@v4\n");
    writeFileSync(join(root, ".github", "workflows", "README.md"), "- uses: actions/upload-artifact@v4\n");
    const { findings } = scanWorkflows(root);
    expect(findings.map((f) => `${f.file}:${f.line}:${f.rule}`)).toEqual([
      ".github/workflows/ci.yml:7:upload-artifact-fatal",
      ".github/workflows/ci.yml:7:upload-artifact-retention",
    ]);
  });
});
