import { describe, test, expect } from "vitest";
import { hasPluginSignal } from "./prompt.plugin.scope.js";

describe("hasPluginSignal — plugin-topic detector", () => {
  test("names the plugin or its repo", () => {
    expect(hasPluginSignal("der dotclaude ship flow ist kaputt")).toBe(true);
    expect(hasPluginSignal("das devops-plugin rendert die Karte doppelt")).toBe(true);
    expect(hasPluginSignal("die devops skill triggert nicht")).toBe(true);
  });

  test("references a plugin slash command", () => {
    expect(hasPluginSignal("/ship bricht beim preflight ab")).toBe(true);
    expect(hasPluginSignal("nach /promote fehlt die Karte")).toBe(true);
    expect(hasPluginSignal("/setup-issue nimmt das Milestone nicht")).toBe(true);
    expect(hasPluginSignal("/tune-harden läuft ins Leere")).toBe(true);
    expect(hasPluginSignal("/claude-learn schreibt in die falsche Datei")).toBe(true);
  });

  test("references a hook file or the completion card", () => {
    expect(hasPluginSignal("stop.flow.guard.js blockt jeden Turn")).toBe(true);
    expect(hasPluginSignal("ss.git.sync.js hängt")).toBe(true);
    expect(hasPluginSignal("die completion card fehlt am Ende")).toBe(true);
    expect(hasPluginSignal("completion-card wird nicht gerendert")).toBe(true);
  });

  test("references the install trees, POSIX and Windows spelling", () => {
    expect(hasPluginSignal("fix das im plugin cache")).toBe(true);
    expect(hasPluginSignal("liegt unter ~/.claude/plugins/cache/dotclaude")).toBe(true);
    expect(hasPluginSignal("C:\\Users\\Jerem\\.claude\\plugins\\cache\\dotclaude ist stale")).toBe(true);
    expect(hasPluginSignal("%USERPROFILE%\\.claude\\plugins\\marketplaces")).toBe(true);
  });

  test("hook filenames with hyphenated action segments still signal", () => {
    expect(hasPluginSignal("prompt.flow.silent-turn.js schluckt meinen Turn")).toBe(true);
    expect(hasPluginSignal("pre.worktree.split-guard.js meldet falsch")).toBe(true);
    expect(hasPluginSignal("prompt.worktree.branch-guard.js nervt")).toBe(true);
  });

  test("a project's own slash commands do NOT signal", () => {
    // A /(setup|run|auto)-\w+ wildcard would swallow these.
    expect(hasPluginSignal("/run-tests schlägt fehl")).toBe(false);
    expect(hasPluginSignal("/setup-db neu aufsetzen")).toBe(false);
    expect(hasPluginSignal("/auto-format über das repo laufen lassen")).toBe(false);
    expect(hasPluginSignal("/tune-cache anpassen")).toBe(false);
  });

  test("ordinary project work does NOT signal (false-positive guard)", () => {
    expect(hasPluginSignal("fix den Bug in src/auth.ts")).toBe(false);
    expect(hasPluginSignal("add a skill dropdown to the settings page")).toBe(false);
    expect(hasPluginSignal("our webhook handler drops events")).toBe(false);
    expect(hasPluginSignal("write an agent that summarizes tickets")).toBe(false);
    expect(hasPluginSignal("the plugin system in our app needs a registry")).toBe(false);
  });

  test("a project's own git hook file does not look like a devops hook", () => {
    // Devops hooks match {event}.{domain}.{action}.js — a bare name must not.
    expect(hasPluginSignal("update scripts/build.js")).toBe(false);
    expect(hasPluginSignal("post.js needs a rewrite")).toBe(false);
  });

  test("a slash command that is not a plugin command does not signal", () => {
    expect(hasPluginSignal("/help")).toBe(false);
    expect(hasPluginSignal("/clear the context")).toBe(false);
  });

  test("empty / non-string input → false", () => {
    expect(hasPluginSignal("")).toBe(false);
    expect(hasPluginSignal(null)).toBe(false);
    expect(hasPluginSignal(undefined)).toBe(false);
    expect(hasPluginSignal(42)).toBe(false);
  });
});
