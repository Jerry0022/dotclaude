import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isUiFile, parseUiRules } = require("./ui-files.js");
const { changedCounts } = require("./run-contract-qa.js");

describe("isUiFile — the one detection for the reminder and the run contract", () => {
  test.each(["src/App.tsx", "web/index.html", "styles/main.scss", "ui/Button.styled.ts", "app/foo.component.ts"])("%s is UI", (f) => {
    expect(isUiFile(f)).toBe(true);
  });

  test.each(["src/server.js", "README.md", "node_modules/x/a.css", ".claude/concept.html", "plugins/devops/skills/x/page.html"])("%s is not UI", (f) => {
    expect(isUiFile(f)).toBe(false);
  });

  test("an override `files:` glob opts plugin source back in", () => {
    const { files } = parseUiRules(["files: plugins/devops/skills/**/*.html  # concept templates"]);
    expect(isUiFile("plugins/devops/skills/x/page.html", files)).toBe(true);
  });
});

describe("changedCounts — one diff, code and UI counted", () => {
  const fake = (lists) => (_root, args) => {
    if (args[0] === "ls-files") return lists.untracked || [];
    return args[2] === "HEAD" ? lists.worktree || [] : lists.branch || [];
  };

  test("a JS-only change has no UI files", () => {
    expect(changedCounts(process.cwd(), "card", "main", fake({ branch: ["lib/a.js"] }))).toMatchObject({ ui: 0 });
  });

  test("an untracked stylesheet counts outside release", () => {
    expect(changedCounts(process.cwd(), "card", "main", fake({ branch: ["lib/a.js"], untracked: ["app.css"] }))).toMatchObject({ ui: 1 });
    expect(changedCounts(process.cwd(), "release", "main", fake({ branch: ["lib/a.js"], untracked: ["app.css"] }))).toMatchObject({ ui: 0 });
  });

  test("a git failure is unknown (null), never 0", () => {
    const boom = () => { throw new Error("git down"); };
    expect(changedCounts(process.cwd(), "card", "main", boom)).toBeNull();
  });
});
