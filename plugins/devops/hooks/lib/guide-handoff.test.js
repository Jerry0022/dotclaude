import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  detectWebHandoff,
  matchService,
  hasNumberedUiSteps,
  hasArrowChain,
  isExcludedUrl,
  containsCompletionCard,
  webGuideInvokedThisTurn,
  writePendingHandoff,
  consumePendingHandoff,
  buildPendingHint,
  IMPERATIVE_RE,
} from "./guide-handoff.js";

const CARD = "✨✨✨";

describe("detectWebHandoff — must trigger (real session examples)", () => {
  test("Upstash 5-Klicks heading + numbered steps", () => {
    const text = [
      "**Upstash anbinden — 5 Klicks, dann kannst du schlafen:**",
      "",
      "1. Auf upstash.com einloggen",
      "2. Neue Redis-Datenbank anlegen",
      "3. Connection-String kopieren",
    ].join("\n");
    expect(detectWebHandoff(text)).toEqual({ service: "Upstash" });
  });

  test("numbered heading step alone, service named earlier", () => {
    const text = ["Um Supabase Storage einzurichten:", "", "**1. Storage-Tab öffnen**"].join("\n");
    expect(detectWebHandoff(text)).toEqual({ service: "Supabase" });
  });

  test("numbered step with an external URL", () => {
    const text =
      "3. Die unten erzeugte URL im Browser öffnen → deinen Server wählen → autorisieren.\n" +
      "(https://discord.com/oauth2/authorize?client_id=123)";
    expect(detectWebHandoff(text)).toEqual({ service: "external URL" });
  });

  test("≥2 arrows + a named service (no numbered list)", () => {
    const text = "In Vercel: Project → Settings → Environment Variables, dort den Key setzen.";
    expect(detectWebHandoff(text)).toEqual({ service: "Vercel" });
  });

  test("English numbered steps", () => {
    const text = "Set up Stripe:\n1. Open the Stripe dashboard\n2. Click Developers\n3. Copy the secret key";
    expect(detectWebHandoff(text)).toEqual({ service: "Stripe" });
  });
});

describe("detectWebHandoff — must NOT trigger", () => {
  test("local CLI cleanup, no external service", () => {
    expect(detectWebHandoff("Worktree manuell aufräumen: `git worktree remove --force ./wt`")).toBeNull();
  });

  test("verification bullet inside the completion card is out of scope", () => {
    const text =
      "Alles erledigt.\n\n" +
      `### **${CARD} Deploy fertig ${CARD}**\n\n` +
      "1. Produktion (x.vercel.app) nach dem Deploy öffnen: Ankunft sichtbar\n\n---";
    expect(detectWebHandoff(text)).toBeNull();
  });

  test("comma-chained prose (no numbered list, no arrows) is not a hand-off", () => {
    const text =
      'Zeigt das „Needs authentication", dann in der Session `/mcp` öffnen, ' +
      '`supabase` wählen, „Authenticate" und den Browser-Login durchlaufen.';
    expect(detectWebHandoff(text)).toBeNull();
  });

  test("a card turn with a GitHub PR URL and arrows is not a hand-off", () => {
    const text =
      "PR https://github.com/Jerry0022/dotclaude/pull/472 → CI grün → gemergt.\n" +
      "1. Öffne den PR für Details\n\n" +
      `### **${CARD} Ship fertig ${CARD}**`;
    expect(detectWebHandoff(text)).toBeNull();
  });

  test("GitHub issue / commit links and localhost are excluded", () => {
    expect(detectWebHandoff("1. Open https://github.com/a/b/issues/12 and read it")).toBeNull();
    expect(detectWebHandoff("1. Open https://github.com/a/b/commit/abc123")).toBeNull();
    expect(detectWebHandoff("1. Open http://localhost:3000 in the browser")).toBeNull();
  });

  test("≥2 arrows with only a bare URL (no named service) is not enough", () => {
    expect(detectWebHandoff("Flow: https://example.com/a → login → dashboard")).toBeNull();
  });

  test("plain prose with neither service nor steps", () => {
    expect(detectWebHandoff("Anhören musst du sie also selbst")).toBeNull();
  });

  test("service named but no step language at all", () => {
    expect(detectWebHandoff("Supabase ist eine gute Wahl für dieses Projekt.")).toBeNull();
  });

  test("numbered list without a UI verb", () => {
    expect(detectWebHandoff("Supabase-Stand:\n1. Tabellen migriert\n2. RLS aktiv")).toBeNull();
  });

  test("step language but no service named", () => {
    expect(detectWebHandoff("1. Terminal öffnen\n2. npm install ausführen")).toBeNull();
  });

  test("non-string input", () => {
    expect(detectWebHandoff(null)).toBeNull();
    expect(detectWebHandoff(42)).toBeNull();
  });
});

describe("IMPERATIVE_RE — Unicode word boundaries", () => {
  test("öffnen / öffne match after a space (JS \\b is ASCII-only)", () => {
    expect(IMPERATIVE_RE.test("den Tab öffnen")).toBe(true);
    expect(IMPERATIVE_RE.test("öffne den Tab")).toBe(true);
  });

  test("not inside a longer word", () => {
    expect(IMPERATIVE_RE.test("Eröffnung")).toBe(false);
    expect(IMPERATIVE_RE.test("reopened")).toBe(false);
  });
});

describe("matchService", () => {
  test("bare unambiguous names match as named services", () => {
    expect(matchService("Deploy via Vercel")).toEqual({ name: "Vercel", named: true });
  });

  test("ambiguous names require the qualifying phrase", () => {
    expect(matchService("Siehe GitHub Issue #12")).toBeNull();
    expect(matchService("In den GitHub Settings den Webhook anlegen")).toEqual({ name: "GitHub Settings", named: true });
  });

  test("a non-excluded URL is an unnamed service", () => {
    expect(matchService("see https://dash.example.com/keys")).toEqual({ name: "external URL", named: false });
  });

  test("github.com settings pages still count", () => {
    expect(isExcludedUrl("https://github.com/settings/tokens")).toBe(false);
    expect(isExcludedUrl("https://github.com/a/b/settings/secrets/actions")).toBe(false);
    expect(isExcludedUrl("https://github.com/a/b/pull/3")).toBe(true);
  });
});

describe("step shapes", () => {
  test("numbered list needs a UI verb on a list item", () => {
    expect(hasNumberedUiSteps("1. Click Save\n2. Done")).toBe(true);
    expect(hasNumberedUiSteps("1. Tests grün\n2. Build ok")).toBe(false);
    expect(hasNumberedUiSteps("Click here.\n1. Tests grün")).toBe(false);
  });

  test("arrow chain needs at least two arrows", () => {
    expect(hasArrowChain("A → B → C")).toBe(true);
    expect(hasArrowChain("A → B")).toBe(false);
  });

  test("CRLF text is handled", () => {
    expect(detectWebHandoff("Upstash:\r\n1. Datenbank anlegen\r\n2. Key kopieren\r\n")).toEqual({ service: "Upstash" });
  });
});

describe("containsCompletionCard", () => {
  test("terminal title and Desktop marker comment both count", () => {
    expect(containsCompletionCard(`### **${CARD} Fertig ${CARD}**`)).toBe(true);
    expect(containsCompletionCard(`[//]: # (${CARD} Fertig ${CARD})`)).toBe(true);
    expect(containsCompletionCard(`<!-- ${CARD} Fertig ${CARD} -->`)).toBe(true);
    expect(containsCompletionCard("no card")).toBe(false);
  });
});

describe("webGuideInvokedThisTurn", () => {
  const line = (entry) => JSON.stringify(entry);
  const user = (text) => line({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
  const skill = (name) => line({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Skill", input: { skill: name } }] } });
  const said = (text) => line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });

  test("web-guide this turn → true", () => {
    expect(webGuideInvokedThisTurn([user("connect upstash"), skill("web-guide")].join("\n"))).toBe(true);
  });

  test("namespaced devops:web-guide and the PR-2 name auto-guide → true", () => {
    expect(webGuideInvokedThisTurn([user("x"), skill("devops:web-guide")].join("\n"))).toBe(true);
    expect(webGuideInvokedThisTurn([user("x"), skill("devops:auto-guide")].join("\n"))).toBe(true);
  });

  test("no Skill call this turn → false", () => {
    expect(webGuideInvokedThisTurn([user("connect upstash"), said("1. open upstash.com")].join("\n"))).toBe(false);
  });

  test("web-guide invoked in an EARLIER turn does not count for this one", () => {
    const t = [skill("web-guide"), user("next task"), said("1. open vercel.com")].join("\n");
    expect(webGuideInvokedThisTurn(t)).toBe(false);
  });

  test("empty / malformed transcript → false", () => {
    expect(webGuideInvokedThisTurn("")).toBe(false);
    expect(webGuideInvokedThisTurn("not json\nnull\n42")).toBe(false);
  });
});

describe("pending hand-off (card turns)", () => {
  let tmp;
  let saved;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guide-pending-"));
    saved = { TMP: process.env.TMP, TEMP: process.env.TEMP, TMPDIR: process.env.TMPDIR };
    process.env.TMP = process.env.TEMP = process.env.TMPDIR = tmp;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("write → consume once → gone", () => {
    writePendingHandoff("s1", "Upstash");
    expect(consumePendingHandoff("s1")).toBe("Upstash");
    expect(consumePendingHandoff("s1")).toBeNull();
  });

  test("another session's record is not consumed", () => {
    writePendingHandoff("s1", "Upstash");
    expect(consumePendingHandoff("s2")).toBeNull();
    expect(consumePendingHandoff("s1")).toBe("Upstash");
  });

  test("a stale record is dropped", () => {
    writePendingHandoff("s1", "Upstash", Date.now() - 7 * 3600 * 1000);
    expect(consumePendingHandoff("s1")).toBeNull();
  });

  test("the hint is an offer, not a mandate", () => {
    const hint = buildPendingHint("Upstash");
    expect(hint).toContain("Upstash");
    expect(hint).toContain("web-guide");
    expect(hint).not.toMatch(/MANDATORY/);
  });
});
