#!/usr/bin/env node
/**
 * @script gen-project-map
 * @version 0.1.0
 * @plugin devops
 * @description Generates .claude/project-map.md from git-tracked files.
 *   Produces a compact directory tree with file counts and key-file highlights.
 *   Called by ship_build and project-setup; can also be run standalone.
 *
 *   Usage: node scripts/gen-project-map.js [project-root]
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";

const projectRoot = process.argv[2] || process.cwd();

// ── Well-known directory descriptions ──────────────────────────────────────

const DIR_HINTS = {
  src: "Source code",
  lib: "Library code",
  app: "Application code",
  apps: "Application packages",
  packages: "Monorepo packages",
  components: "UI components",
  pages: "Page routes",
  views: "View templates",
  routes: "Route handlers",
  api: "API endpoints",
  services: "Service layer",
  utils: "Utilities",
  helpers: "Helper functions",
  hooks: "Hooks / lifecycle",
  middleware: "Middleware",
  models: "Data models",
  types: "Type definitions",
  interfaces: "Interfaces",
  config: "Configuration",
  scripts: "Build / utility scripts",
  test: "Tests",
  tests: "Tests",
  __tests__: "Tests",
  spec: "Test specs",
  fixtures: "Test fixtures",
  mocks: "Test mocks",
  docs: "Documentation",
  doc: "Documentation",
  public: "Static assets (public)",
  static: "Static assets",
  assets: "Assets (images, fonts, etc.)",
  styles: "Stylesheets",
  css: "Stylesheets",
  templates: "Templates",
  migrations: "Database migrations",
  seeds: "Database seeds",
  prisma: "Prisma schema & migrations",
  ".claude": "Claude Code config",
  ".github": "GitHub workflows & config",
  ".vscode": "VS Code settings",
  plugins: "Plugins",
  agents: "Agent definitions",
  skills: "Skill definitions",
  "deep-knowledge": "Reference docs",
  dist: "Build output",
  build: "Build output",
  out: "Build output",
  bin: "Executables",
  cmd: "CLI commands",
  internal: "Internal packages",
  pkg: "Packages",
  vendor: "Vendored dependencies",
};

// ── Well-known key files ───────────────────────────────────────────────────

const KEY_FILES = [
  "package.json",
  "tsconfig.json",
  "vite.config.ts",
  "vite.config.js",
  "next.config.js",
  "next.config.ts",
  "nuxt.config.ts",
  "webpack.config.js",
  "rollup.config.js",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "requirements.txt",
  "Pipfile",
  "Gemfile",
  "pom.xml",
  "build.gradle",
  "CMakeLists.txt",
  "Makefile",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  ".env.example",
  "CLAUDE.md",
  ".claudeignore",
  "CHANGELOG.md",
];

// ── Helpers ────────────────────────────────────────────────────────────────

function gitFiles(cwd) {
  try {
    const out = execSync("git ls-files", {
      cwd,
      encoding: "utf8",
      timeout: 15_000,
    });
    return out
      .trim()
      .split("\n")
      .filter((f) => f);
  } catch {
    return [];
  }
}

function buildTree(files) {
  // dir → { files: [basename], subdirs: Set<string> }
  const dirs = new Map();

  for (const f of files) {
    const dir = dirname(f) === "." ? "." : dirname(f);
    if (!dirs.has(dir)) dirs.set(dir, { files: [], subdirs: new Set() });
    dirs.get(dir).files.push(basename(f));

    // register parent chain
    const parts = dir.split("/");
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join("/");
      const child = parts[i];
      if (!dirs.has(parent))
        dirs.set(parent, { files: [], subdirs: new Set() });
      dirs.get(parent).subdirs.add(child);
    }
    // root knows top-level dirs
    if (parts.length >= 1 && dir !== ".") {
      if (!dirs.has(".")) dirs.set(".", { files: [], subdirs: new Set() });
      dirs.get(".").subdirs.add(parts[0]);
    }
  }

  return dirs;
}

function totalFilesUnder(dirs, prefix) {
  let count = 0;
  for (const [dir, data] of dirs) {
    if (dir === prefix || dir.startsWith(prefix + "/")) {
      count += data.files.length;
    }
  }
  return count;
}

function hintFor(dirName) {
  return DIR_HINTS[dirName] || null;
}

function renderTree(dirs, maxDepth = 3) {
  const lines = [];

  function walk(prefix, depth, indent) {
    if (depth > maxDepth) return;
    const entry = dirs.get(prefix);
    if (!entry) return;

    const sortedSubs = [...entry.subdirs].sort();
    for (const sub of sortedSubs) {
      const fullPath = prefix === "." ? sub : `${prefix}/${sub}`;
      const count = totalFilesUnder(dirs, fullPath);
      if (count === 0) continue;

      const hint = hintFor(sub);
      const desc = hint ? ` — ${hint}` : "";
      lines.push(`${indent}${sub}/  (${count})${desc}`);
      walk(fullPath, depth + 1, indent + "  ");
    }
  }

  walk(".", 1, "");
  return lines;
}

function detectKeyFiles(files) {
  const rootFiles = files.filter((f) => !f.includes("/"));
  return KEY_FILES.filter((kf) => rootFiles.includes(kf));
}

function detectEntryPoints(files) {
  const candidates = [
    "src/index.ts",
    "src/index.js",
    "src/main.ts",
    "src/main.js",
    "src/app.ts",
    "src/app.js",
    "src/App.tsx",
    "src/App.vue",
    "app/page.tsx",
    "app/layout.tsx",
    "pages/index.tsx",
    "pages/index.js",
    "main.go",
    "cmd/main.go",
    "src/main.rs",
    "src/lib.rs",
    "app.py",
    "main.py",
    "manage.py",
  ];
  return candidates.filter((c) => files.includes(c));
}

// ── Main ───────────────────────────────────────────────────────────────────

function generate() {
  const files = gitFiles(projectRoot);
  if (!files.length) {
    console.error("[gen-project-map] No git-tracked files found in", projectRoot);
    process.exit(1);
  }

  const dirs = buildTree(files);
  const tree = renderTree(dirs);
  const keyFiles = detectKeyFiles(files);
  const entryPoints = detectEntryPoints(files);

  const sections = [
    "<!-- AUTO-GENERATED by scripts/gen-project-map.js — do not edit manually -->",
    `# Project Map — ${basename(projectRoot)}`,
    "",
    `${files.length} tracked files.`,
    "",
    "## Structure",
    "```",
    ...tree,
    "```",
  ];

  if (keyFiles.length) {
    sections.push("", "## Key Files", ...keyFiles.map((f) => `- \`${f}\``));
  }

  if (entryPoints.length) {
    sections.push(
      "",
      "## Entry Points",
      ...entryPoints.map((f) => `- \`${f}\``),
    );
  }

  sections.push("");

  const content = sections.join("\n");

  // Write to .claude/project-map.md
  const claudeDir = join(projectRoot, ".claude");
  if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });

  const outPath = join(claudeDir, "project-map.md");
  const existing = (() => {
    try {
      return readFileSync(outPath, "utf8");
    } catch {
      return null;
    }
  })();

  if (existing === content) {
    console.error("[gen-project-map] project-map.md is up-to-date");
    return false;
  }

  writeFileSync(outPath, content, "utf8");
  console.error(
    `[gen-project-map] project-map.md generated (${files.length} files, ${tree.length} dirs)`,
  );
  return true;
}

generate();
