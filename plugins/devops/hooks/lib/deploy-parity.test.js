import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const P = require("./deploy-parity.js");

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "parity-test-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function write(rel, content) {
  const f = join(dir, rel);
  mkdirSync(join(f, ".."), { recursive: true });
  writeFileSync(f, typeof content === "string" ? content : JSON.stringify(content, null, 2));
}

describe("detectBuildPlan — deploy hosts first", () => {
  test("vercel.json buildCommand/installCommand win", () => {
    write("vercel.json", { buildCommand: "bash scripts/host-build.sh", installCommand: "npm ci --omit=optional", framework: "vite" });
    write("package.json", { scripts: { build: "vite build" } });
    const p = P.detectBuildPlan(dir);
    expect(p).toMatchObject({ detector: "vercel", host: "vercel", build: "bash scripts/host-build.sh", install: "npm ci --omit=optional" });
    expect(p.env).toEqual({ VERCEL: "1" });
  });

  test("vercel.json without buildCommand prefers vercel-build, then build, with lifecycle hooks and lockfile install", () => {
    write("vercel.json", {});
    write("package-lock.json", "{}");
    write("package.json", { scripts: { build: "vite build", prebuild: "node guard.js", "vercel-build": "x" } });
    let p = P.detectBuildPlan(dir);
    expect(p).toMatchObject({ host: "vercel", build: "npm run vercel-build", install: "npm ci", lifecycle: [] });
    write("package.json", { scripts: { build: "vite build", prebuild: "node guard.js", postbuild: "node post.js" } });
    p = P.detectBuildPlan(dir);
    expect(p).toMatchObject({ build: "npm run build", lifecycle: ["prebuild", "postbuild"] });
  });

  test("netlify.toml [build] command and base", () => {
    write("netlify.toml", "[build]\n  base = \"site\"\n  command = \"npm run build:site\"\n  publish = \"dist\"\n\n[dev]\n  command = \"nope\"\n");
    expect(P.detectBuildPlan(dir)).toMatchObject({ host: "netlify", build: "npm run build:site", dir: "site" });
  });

  test("wrangler.toml [build] command, jsonc variant, and fallback to the package build", () => {
    write("wrangler.toml", "name = \"w\"\n[build]\ncommand = 'npm run build:worker'\n");
    expect(P.detectBuildPlan(dir)).toMatchObject({ host: "cloudflare", build: "npm run build:worker" });
    rmSync(join(dir, "wrangler.toml"));
    write("wrangler.jsonc", "{\n // comment\n \"name\": \"w\"\n}");
    write("pnpm-lock.yaml", "");
    write("package.json", { scripts: { build: "astro build" } });
    expect(P.detectBuildPlan(dir)).toMatchObject({ host: "cloudflare", source: "wrangler.jsonc", build: "pnpm run build", install: "pnpm install --frozen-lockfile" });
  });

  test("render.yaml buildCommand + rootDir, multiple services noted", () => {
    write("render.yaml", "services:\n  - type: web\n    rootDir: api\n    buildCommand: \"pip install -r requirements.txt\"\n  - type: web\n    buildCommand: npm run build\n");
    const p = P.detectBuildPlan(dir);
    expect(p).toMatchObject({ host: "render", build: "pip install -r requirements.txt", dir: "api" });
    expect(p.note).toMatch(/2 services/);
  });

  test("firebase.json hosting predeploy", () => {
    write("firebase.json", { hosting: { predeploy: ["npm run lint", "npm run build"] } });
    expect(P.detectBuildPlan(dir)).toMatchObject({ host: "firebase", build: "npm run lint && npm run build" });
  });

  test("fly.toml: prebuilt image → nothing to build; Dockerfile → docker build", () => {
    write("fly.toml", "app = \"a\"\n[build]\n  image = \"registry/x:1\"\n");
    expect(P.detectBuildPlan(dir)).toMatchObject({ host: "fly", build: null });
    write("fly.toml", "app = \"a\"\n");
    write("Dockerfile", "FROM node\n");
    expect(P.detectBuildPlan(dir)).toMatchObject({ host: "fly", build: "docker build -f \"Dockerfile\" .", requires: "docker" });
  });

  test("GitHub Pages workflow: install and build run lines", () => {
    write(".github/workflows/pages.yml", [
      "jobs:", "  build:", "    steps:", "      - uses: actions/checkout@v4",
      "      - run: npm ci", "      - run: npm test", "      - run: npm run build",
      "      - run: |", "          echo multi", "      - uses: actions/upload-pages-artifact@v3",
    ].join("\n"));
    expect(P.detectBuildPlan(dir)).toMatchObject({ host: "github-pages", install: "npm ci", build: "npm run build" });
  });

  test("a workflow without a pages action is not a host", () => {
    write(".github/workflows/ci.yml", "jobs:\n  t:\n    steps:\n      - run: npm test\n");
    expect(P.detectBuildPlan(dir).detector).toBe(null);
  });
});

describe("detectBuildPlan — ecosystem fallbacks", () => {
  test("package.json build with yarn berry / bun / npm without lockfile", () => {
    write("package.json", { scripts: { build: "tsc" }, packageManager: "yarn@4.1.0" });
    expect(P.detectBuildPlan(dir)).toMatchObject({ detector: "node", host: null, build: "yarn run build", install: "yarn install --immutable" });
    write("package.json", { scripts: { build: "tsc" } });
    write("bun.lock", "");
    expect(P.detectBuildPlan(dir)).toMatchObject({ build: "bun run build", install: "bun install --frozen-lockfile" });
    rmSync(join(dir, "bun.lock"));
    expect(P.detectBuildPlan(dir)).toMatchObject({ build: "npm run build", install: "npm install" });
  });

  test("package.json without build falls through to Dockerfile, Makefile, cargo, go, python", () => {
    write("package.json", { scripts: { test: "vitest" } });
    write("pyproject.toml", "[build-system]\nrequires = []\n");
    expect(P.detectBuildPlan(dir)).toMatchObject({ detector: "python", build: "python -m build" });
    write("go.mod", "module x\n");
    expect(P.detectBuildPlan(dir)).toMatchObject({ detector: "go", build: "go build ./..." });
    write("Cargo.toml", "[package]\n");
    write("Cargo.lock", "");
    expect(P.detectBuildPlan(dir)).toMatchObject({ detector: "cargo", build: "cargo build --release --locked" });
    write("Makefile", "build:\n\techo hi\n");
    expect(P.detectBuildPlan(dir)).toMatchObject({ detector: "make", build: "make build" });
    write("Dockerfile", "FROM scratch\n");
    expect(P.detectBuildPlan(dir)).toMatchObject({ detector: "docker", requires: "docker" });
  });

  test("nothing recognisable → no build, with a note (skip, never fail)", () => {
    write("README.md", "# hi");
    const p = P.detectBuildPlan(dir);
    expect(p.build).toBe(null);
    expect(p.note).toMatch(/no deploy host config/);
  });

  test("the table is extensible: a custom detector list is honoured, a throwing detector is skipped", () => {
    const detectors = [
      { id: "boom", match() { throw new Error("x"); } },
      { id: "custom", match: () => ({ host: "acme", source: "acme.yml", install: null, build: "acme build" }) },
    ];
    expect(P.detectBuildPlan(dir, { detectors })).toMatchObject({ detector: "custom", build: "acme build" });
  });
});

describe("parsers", () => {
  test("tomlValue reads only the named section", () => {
    const t = "[dev]\ncommand = \"a\"\n[build]\n# c\ncommand = \"b \\\"q\\\"\"\n";
    expect(P.tomlValue(t, "build", "command")).toBe("b \"q\"");
    expect(P.tomlValue(t, "build", "base")).toBe(null);
  });
  test("yamlScalar ignores block scalars", () => {
    expect(P.yamlScalar("buildCommand: |\n  x\n", "buildCommand")).toBe(null);
    expect(P.yamlScalar("  - buildCommand: 'make' # c\n", "buildCommand")).toBe("make");
  });
  test("dotenvNames returns names only", () => {
    expect(P.dotenvNames("# c\nexport A_KEY=1\nB=\n bad line\n")).toEqual(["A_KEY", "B"]);
  });
  test("toolOf skips leading env assignments", () => {
    expect(P.toolOf("NODE_ENV=production pnpm run build")).toBe("pnpm");
    expect(P.toolOf("\"docker\" build .")).toBe("docker");
  });
});

describe("buildEnv", () => {
  test("allowlists plumbing, withholds secrets and unknowns, honours passEnv, adds CI and host markers", () => {
    const { env, withheld } = P.buildEnv(
      { PATH: "/bin", HOME: "/h", LC_ALL: "C", STRIPE_SECRET_KEY: "s", GITHUB_TOKEN: "t", NEXT_PUBLIC_URL: "u", XDG_SESSION_TOKEN: "x" },
      ["next_public_url"],
      { VERCEL: "1" },
    );
    expect(env).toEqual({ PATH: "/bin", HOME: "/h", LC_ALL: "C", NEXT_PUBLIC_URL: "u", CI: "1", VERCEL: "1" });
    expect(withheld.sort()).toEqual(["GITHUB_TOKEN", "STRIPE_SECRET_KEY", "XDG_SESSION_TOKEN"]);
  });
});

describe("classifyFailure — failed vs. inconclusive", () => {
  const base = { step: "build", code: 1, output: "" };
  test("exit 0 passes", () => {
    expect(P.classifyFailure({ ...base, code: 0 }).status).toBe("passed");
  });
  test("a guard script failing is a real failure", () => {
    expect(P.classifyFailure({ ...base, output: "email guard: found git@host:org/repo.git in docs/setup.md" }))
      .toMatchObject({ status: "failed", reason: "build failed (exit 1)" });
  });
  test("a withheld variable named in the output → inconclusive with the name", () => {
    const v = P.classifyFailure({ ...base, output: "Error: SUPABASE_SERVICE_KEY is required", withheld: ["SUPABASE_SERVICE_KEY", "DEBUG"] });
    expect(v).toMatchObject({ status: "inconclusive", needsEnv: ["SUPABASE_SERVICE_KEY"] });
  });
  test("short/generic withheld names do not count", () => {
    expect(P.classifyFailure({ ...base, output: "DEBUG output: boom", withheld: ["DEBUG"] }).status).toBe("failed");
  });
  test("a generic missing-env message → inconclusive; a JS undefined error is not", () => {
    expect(P.classifyFailure({ ...base, output: "Missing required environment variable" }).status).toBe("inconclusive");
    expect(P.classifyFailure({ ...base, output: "TypeError: Cannot read properties of undefined (reading 'token')" }).status).toBe("failed");
  });
  test("the step's own tool missing → inconclusive; a binary missing inside the build → failed", () => {
    expect(P.classifyFailure({ ...base, code: 127, tool: "pnpm", output: "sh: pnpm: command not found" }).status).toBe("inconclusive");
    expect(P.classifyFailure({ ...base, code: 127, tool: "npm", output: "sh: vite: command not found" }).status).toBe("failed");
    expect(P.classifyFailure({ ...base, tool: "npm", output: "npm ERR! 404 Not Found - GET https://registry/x" }).status).toBe("failed");
  });
  test("install network / registry auth → inconclusive; the same text in build → failed", () => {
    expect(P.classifyFailure({ ...base, step: "install", output: "npm ERR! code E401" }).status).toBe("inconclusive");
    expect(P.classifyFailure({ ...base, output: "npm ERR! code E401" }).status).toBe("failed");
  });
  test("timeout → inconclusive", () => {
    expect(P.classifyFailure({ ...base, code: null, timedOut: true, timeoutSec: 5 }))
      .toMatchObject({ status: "inconclusive", reason: "build exceeded the 5 s budget" });
  });
});

// ---------------------------------------------------------------------------
// runDeployParity against a real repo — clean checkout, lifecycle, cleanup
// ---------------------------------------------------------------------------

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function initRepo(files) {
  for (const [rel, content] of Object.entries(files)) write(rel, content);
  git(["init", "-q", "-b", "main"], dir);
  git(["config", "user.email", "t@example.com"], dir);
  git(["config", "user.name", "t"], dir);
  git(["config", "commit.gpgsign", "false"], dir);
  git(["add", "-A"], dir);
  git(["commit", "-q", "-m", "init"], dir);
}

const noInstall = { installCmd: "" };

describe("runDeployParity", () => {
  test("passes on a clean checkout and removes the temp worktree", async () => {
    initRepo({ "package.json": { scripts: { build: "node -e \"require('fs').writeFileSync('out.txt','ok')\"" } } });
    const r = await P.runDeployParity({ cwd: dir, ...noInstall, timeoutSec: 60 });
    expect(r).toMatchObject({ status: "passed", detector: "node", plan: { build: "npm run build" } });
    expect(r.cleanup.removed).toBe(true);
    expect(existsSync(r.cleanup.path)).toBe(false);
    expect(git(["worktree", "list", "--porcelain"], dir).match(/^worktree /gm)).toHaveLength(1);
  }, 60_000);

  test("runs the prebuild lifecycle hook — a failing guard fails the ship", async () => {
    initRepo({
      "package.json": { scripts: { prebuild: "node guard.js", build: "node -e \"0\"" } },
      "guard.js": "console.error('guard: forbidden clone URL in docs'); process.exit(1);",
    });
    const r = await P.runDeployParity({ cwd: dir, ...noInstall, timeoutSec: 60 });
    expect(r.status).toBe("failed");
    expect(r.plan.lifecycle).toEqual(["prebuild"]);
    expect(r.outputTail).toMatch(/forbidden clone URL/);
    expect(existsSync(r.cleanup.path)).toBe(false);
  }, 60_000);

  test("an untracked file the local build relies on surfaces as a failure", async () => {
    initRepo({
      "package.json": { scripts: { build: "node -e \"require('fs').readFileSync('generated/icons.json')\"" } },
      ".gitignore": "generated/\n",
    });
    write("generated/icons.json", "{}");
    execSync("npm run build", { cwd: dir, stdio: "ignore" }); // green locally
    const r = await P.runDeployParity({ cwd: dir, ...noInstall, timeoutSec: 60 });
    expect(r.status).toBe("failed");
    expect(r.outputTail).toMatch(/ENOENT/);
  }, 60_000);

  test("a build that needs a withheld secret is inconclusive, not failed", async () => {
    initRepo({ "package.json": { scripts: { build: "node -e \"if(!process.env.ACME_API_TOKEN){console.error('ACME_API_TOKEN not set');process.exit(1)}\"" } } });
    const r = await P.runDeployParity({ cwd: dir, ...noInstall, timeoutSec: 60, env: { ...process.env, ACME_API_TOKEN: "secret" } });
    expect(r).toMatchObject({ status: "inconclusive", needsEnv: ["ACME_API_TOKEN"] });
    expect(JSON.stringify(r)).not.toMatch(/"secret"/);
  }, 60_000);

  test("passEnv releases a variable to the build", async () => {
    initRepo({ "package.json": { scripts: { build: "node -e \"process.exit(process.env.PUBLIC_SITE_URL?0:1)\"" } } });
    const r = await P.runDeployParity({ cwd: dir, ...noInstall, timeoutSec: 60, passEnv: ["PUBLIC_SITE_URL"], env: { ...process.env, PUBLIC_SITE_URL: "https://x" } });
    expect(r.status).toBe("passed");
  }, 60_000);

  test("names from a local-only .env file count as host-provided env", async () => {
    initRepo({
      "package.json": { scripts: { build: "node -e \"console.error('cannot connect: MAPS_BROWSER_KEY');process.exit(1)\"" } },
      ".gitignore": ".env.local\n",
    });
    write(".env.local", "MAPS_BROWSER_KEY=abc\n");
    const r = await P.runDeployParity({ cwd: dir, ...noInstall, timeoutSec: 60 });
    expect(r).toMatchObject({ status: "inconclusive", needsEnv: ["MAPS_BROWSER_KEY"] });
  }, 60_000);

  test("running out of the budget is inconclusive and still cleans up", async () => {
    initRepo({ "package.json": { scripts: { build: "node -e \"setTimeout(()=>{},60000)\"" } } });
    const r = await P.runDeployParity({ cwd: dir, ...noInstall, timeoutSec: 3 });
    expect(r.status).toBe("inconclusive");
    expect(r.reason).toMatch(/budget/);
    expect(existsSync(r.cleanup.path)).toBe(false);
  }, 60_000);

  test("buildCmd override, missing tool → inconclusive, nothing to build → skipped, docker absent → skipped", async () => {
    initRepo({ "README.md": "# x", "Dockerfile": "FROM scratch\n" });
    let r = await P.runDeployParity({ cwd: dir, timeoutSec: 30, hasDocker: () => false });
    expect(r).toMatchObject({ status: "skipped", detector: "docker" });
    r = await P.runDeployParity({ cwd: dir, timeoutSec: 30, buildCmd: "definitely-not-a-tool-xyz build" });
    expect(r).toMatchObject({ status: "inconclusive", detector: "custom" });
    expect(r.reason).toMatch(/definitely-not-a-tool-xyz is not installed/);
    rmSync(join(dir, "Dockerfile"));
    git(["commit", "-qam", "rm"], dir);
    r = await P.runDeployParity({ cwd: dir, timeoutSec: 30 });
    expect(r.status).toBe("skipped");
  }, 60_000);

  test("outside a git repo → skipped", async () => {
    const r = await P.runDeployParity({ cwd: dir, timeoutSec: 30 });
    expect(r.status).toBe("skipped");
    expect(r.reason).toMatch(/not a git repository/);
  });
});
