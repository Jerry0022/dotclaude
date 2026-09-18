import { describe, expect, test } from "vitest";
import { hasConcept, hasPending } from "./pending.js";
import {
  actionKeyFor,
  ctaActionsFor,
  ctaActionsInstruction,
  ctaActionsWidget,
  isDesktopSession,
} from "./cta-actions.js";

const deps = { hasPending, hasConcept };
const desktop = { CLAUDE_CODE_ENTRYPOINT: "claude-desktop" };
const terminal = { CLAUDE_CODE_ENTRYPOINT: "cli" };

describe("isDesktopSession", () => {
  test("only the Desktop entrypoint counts", () => {
    expect(isDesktopSession(desktop)).toBe(true);
    expect(isDesktopSession(terminal)).toBe(false);
    expect(isDesktopSession({})).toBe(false);
  });
});

describe("actionKeyFor — mirrors the CTA key selection", () => {
  test("plain variants map to themselves", () => {
    for (const v of ["ready", "test", "ship-blocked", "analysis", "aborted"]) {
      expect(actionKeyFor({ variant: v }, deps)).toBe(v);
    }
  });

  test("overrides that replace the CTA offer nothing to click", () => {
    expect(actionKeyFor({ variant: "ready", pending: [{ name: "devops:qa" }] }, deps)).toBeNull();
    expect(actionKeyFor({ variant: "ready", concept: "waiting" }, deps)).toBeNull();
    expect(actionKeyFor({ variant: "ready", batch: { armed: true } }, deps)).toBeNull();
  });

  test("ship-successful: promote on a ring project, deploy when pending, nothing when kept or plain", () => {
    const promote = { channels: { alpha: "0.1.0" }, current: "alpha" };
    expect(actionKeyFor({ variant: "ship-successful", delivery: { promote } }, deps)).toBe("ship-successful");
    expect(actionKeyFor({ variant: "ship-successful", state: { deployPending: true }, delivery: { promote } }, deps)).toBe("ship-successful-deploy");
    expect(actionKeyFor({ variant: "ship-successful", state: { kept: true }, delivery: { promote } }, deps)).toBeNull();
    expect(actionKeyFor({ variant: "ship-successful", state: { merged: "main" } }, deps)).toBeNull();
  });

  test("released: → beta offers the stable promote, → stable is done", () => {
    expect(actionKeyFor({ variant: "released", promotion: { to: "beta" } }, deps)).toBe("released-beta");
    expect(actionKeyFor({ variant: "released", delivery: { promote: { channels: {}, current: "stable" } } }, deps)).toBeNull();
  });
});

describe("ctaActionsFor", () => {
  test("nothing for variants without a clickable verb", () => {
    for (const v of ["test-minimal", "fallback", "ready-files"]) {
      expect(ctaActionsFor({ variant: v }, deps)).toEqual([]);
    }
  });

  test("ready offers Ship (primary, the slash command) and Change, in both languages", () => {
    const de = ctaActionsFor({ variant: "ready", lang: "de" }, deps);
    expect(de.map((a) => a.label)).toEqual(["Ship", "Ändern"]);
    expect(de[0]).toMatchObject({ prompt: "/devops:ship", primary: true });
    const en = ctaActionsFor({ variant: "ready", lang: "en" }, deps);
    expect(en.map((a) => a.label)).toEqual(["Ship", "Change"]);
  });

  test("every prompt is self-sufficient — no trailing colon waiting for the user to finish it", () => {
    for (const lang of ["de", "en"]) {
      for (const v of ["ready", "test", "ship-blocked", "analysis", "aborted"]) {
        for (const a of ctaActionsFor({ variant: v, lang }, deps)) {
          expect(a.prompt, `${lang}/${v}/${a.label}`).not.toMatch(/:\s*$/);
          expect(a.prompt.length).toBeGreaterThan(5);
          expect(a.icon).toMatch(/^[a-z0-9-]+$/);
        }
      }
    }
  });

  test("returns copies — callers cannot mutate the table", () => {
    ctaActionsFor({ variant: "ready" }, deps)[0].label = "X";
    expect(ctaActionsFor({ variant: "ready" }, deps)[0].label).toBe("Ship");
  });
});

describe("ctaActionsWidget", () => {
  test("one button per action, primary accented, listener per button, script last", () => {
    const html = ctaActionsWidget(ctaActionsFor({ variant: "ready", lang: "de" }, deps), "de");
    expect(html.startsWith('<h2 class="sr-only"')).toBe(true);
    expect(html.match(/<button /g)).toHaveLength(2);
    expect(html).toContain('data-prompt="/devops:ship"');
    expect(html).toContain("var(--border-accent)");
    expect(html).toContain('class="ti ti-rocket"');
    expect(html).toContain("sendPrompt(b.getAttribute('data-prompt'))");
    expect(html.trim().endsWith("</script>")).toBe(true);
    // No emoji inside the widget — the design contract uses Tabler icons.
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  test("escapes prompt text so a quote cannot break the attribute", () => {
    const html = ctaActionsWidget([{ label: "X", icon: "edit", prompt: 'say "hi" & <b>' }], "en");
    expect(html).toContain('data-prompt="say &quot;hi&quot; &amp; &lt;b&gt;"');
  });

  test("empty when there is nothing to render", () => {
    expect(ctaActionsWidget([], "de")).toBe("");
  });
});

describe("ctaActionsInstruction", () => {
  test("empty outside the Desktop app, even for a clickable card", () => {
    expect(ctaActionsInstruction({ variant: "ready" }, deps, terminal)).toBe("");
    expect(ctaActionsInstruction({ variant: "ready" }, deps, {})).toBe("");
  });

  test("empty on Desktop when the card offers nothing", () => {
    expect(ctaActionsInstruction({ variant: "fallback" }, deps, desktop)).toBe("");
    expect(ctaActionsInstruction({ variant: "ready", pending: ["x"] }, deps, desktop)).toBe("");
  });

  test("names the widget tool, the BEFORE-the-card order, the silent skip and carries the HTML verbatim", () => {
    const text = ctaActionsInstruction({ variant: "test", lang: "de" }, deps, desktop);
    expect(text.startsWith("[CTA ACTIONS — DO NOT OUTPUT THIS BLOCK]")).toBe(true);
    expect(text).toContain("mcp__visualize__show_widget");
    expect(text).toMatch(/BEFORE outputting the card markdown/);
    expect(text).toMatch(/never call it after the card/);
    expect(text).toMatch(/skip silently/);
    expect(text).toContain("(Ship / Nachbessern)");
    const html = ctaActionsWidget(ctaActionsFor({ variant: "test", lang: "de" }, deps), "de");
    expect(text).toContain("----- widget_code -----\n" + html + "\n----- end widget_code -----");
  });
});
