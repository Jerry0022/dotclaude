import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

// The reality check diverts an `implement` submission into ONE extra round when
// the default branch moved under the concept. Everything here pins the two
// properties that keep that from becoming a trap:
//
//   1. It can happen at most once per implement attempt — the marker on the
//      section short-circuits the check, and the advancing baseline makes the
//      same drift unable to force a second round even if the marker is lost.
//   2. It never lies about what happened — no "Implementierung abgeschlossen"
//      over an empty diff, and no progress step for a check that did not run.
//
// The behavioural half runs the reference status-step JS out of templates.md on
// a DOM stub, the same way frozen-veil-bar.test.js runs showIteration().

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DK = path.join(__dirname, "deep-knowledge");
const md = fs.readFileSync(path.join(DK, "templates.md"), "utf8");
const gate = fs.readFileSync(path.join(DK, "validation-gate.md"), "utf8");
const iterRules = fs.readFileSync(path.join(DK, "iteration-rules.md"), "utf8");
const bridge = fs.readFileSync(path.join(DK, "bridge-server.md"), "utf8");
const realityDoc = fs.readFileSync(path.join(DK, "reality-check.md"), "utf8");
const skill = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8");

// Line-based scanner (same reason as panel-chrome.test.js): a lazy regex
// desynchronises on the first block whose body contains a fence.
function scanBlocks(src) {
  const lines = src.split("\n");
  const out = [];
  let open = null, body = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^```(.*)$/.exec(lines[i]);
    if (m) {
      if (open === null) { open = { info: m[1].trim(), start: i + 2 }; body = []; }
      else { out.push({ info: open.info, line: open.start, code: body.join("\n") }); open = null; }
      continue;
    }
    if (open) body.push(lines[i]);
  }
  return out;
}
const BLOCKS = scanBlocks(md);
const HTML_BLOCKS = BLOCKS.filter((b) => b.info === "html");
const cssSource = BLOCKS.filter((b) => b.info === "css").map((b) => b.code).join("\n");

function fnSource(name) {
  const m = md.match(new RegExp("function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}"));
  if (!m) throw new Error("function " + name + " not found in templates.md");
  return m[0];
}

describe("reality check — markup", () => {
  test("every skeleton with a progress list ships the reality-check step, hidden, before the implement step", () => {
    const skeletons = HTML_BLOCKS.filter((b) => b.code.includes('id="status-steps"'));
    expect(skeletons.length).toBe(2); // Common Structure + design overlay
    for (const b of skeletons) {
      const where = `html block at line ${b.line}`;
      expect(b.code, where).toContain('data-step="reality-check"');
      // Hidden in the markup: only updateStatusSteps may reveal it, so a check
      // that never ran never advertises itself.
      expect(b.code, where).toMatch(/<li data-step="reality-check" data-state="pending" hidden>/);
      expect(b.code, where).toContain("{{panel.step_reality_check}}");
      expect(b.code, where).toContain("{{panel.step_reality_check_active}}");
      // Order matters — the check happens before the code is written.
      expect(b.code.indexOf('data-step="reality-check"'), where)
        .toBeLessThan(b.code.indexOf('data-step="implemented"'));
    }
  });

  test("the tab bar reference carries a reality-check chip with the locale label", () => {
    const bar = HTML_BLOCKS.find((b) => b.code.includes('class="iteration-tabs"') && b.code.includes("{{iteration.final_tab}}"));
    expect(bar).toBeDefined();
    expect(bar.code).toContain("data-reality-check");
    expect(bar.code).toContain("{{iteration.reality_tab}}");
  });

  test("the explainer block is a reference skeleton, not a suggestion", () => {
    const banner = HTML_BLOCKS.find((b) => b.code.includes('class="reality-banner"'));
    expect(banner).toBeDefined();
    expect(banner.code).toContain("{{reality.headline}}");
    expect(banner.code).toContain("{{reality.intro}}");
    expect(banner.code).toContain("{{reality.reassure}}");
    // The evidence line is what makes a drift claim checkable.
    expect(banner.code).toContain("reality-evidence");
    // It lives on a marked section, and that section is a normal iteration.
    expect(banner.code).toMatch(/<section [^>]*data-iteration="\d+"[^>]*data-reality-check/);
    // The examined commit rides on the round itself, so a resumed session can
    // advance the baseline without having watched the check run.
    expect(banner.code).toMatch(/data-reality-head="[0-9a-f]{7,40}"/);
  });

  test("locale table carries every new string in en and de", () => {
    const keys = [
      "panel.step_reality_check",
      "panel.step_reality_check_active",
      "iteration.reality_tab",
      "reality.headline",
      "reality.intro",
      "reality.reassure",
      "reality.evidence",
      "reality.recommendation",
    ];
    for (const key of keys) {
      const row = md.split("\n").find((l) => l.startsWith("| `" + key + "`"));
      expect(row, key).toBeDefined();
      const cells = row.split("|").map((s) => s.trim()).filter(Boolean);
      expect(cells.length, key).toBe(3);
    }
  });
});

describe("reality check — CSS", () => {
  test("the tab chip is warning-toned, distinct from the final-report chip", () => {
    expect(cssSource).toMatch(/\.iteration-tab\[data-reality-check\] \{/);
    expect(cssSource).toMatch(/\.iteration-tab\[data-reality-check\]\[aria-selected="true"\] \{/);
    const rule = /\.iteration-tab\[data-reality-check\] \{([\s\S]*?)\}/.exec(cssSource)[1];
    expect(rule).toContain("--warning-color");
  });

  test("the explainer banner is styled, so it cannot render as an unstyled paragraph", () => {
    expect(cssSource).toMatch(/\.reality-banner \{/);
    expect(cssSource).toMatch(/\.reality-evidence \{/);
  });
});

// ── Behavioural run of the reference status-step JS against a DOM stub ──

function makeStub() {
  const mkEl = (step) => {
    const icon = { textContent: "○" };
    return {
      hidden: false,
      dataset: { state: "pending", step },
      querySelector: (sel) => (sel === ".step-icon" ? icon : null),
      _icon: icon,
    };
  };
  const steps = {
    submitted: mkEl("submitted"),
    received: mkEl("received"),
    "reality-check": mkEl("reality-check"),
    implemented: mkEl("implemented"),
  };
  const document = {
    querySelector: (sel) => {
      const m = /^#status-steps li\[data-step="([a-z-]+)"\]$/.exec(sel);
      return m ? steps[m[1]] || null : null;
    },
  };
  return { document, steps };
}

function loadRuntime(action) {
  const stub = makeStub();
  const ctx = {
    document: stub.document,
    _submittedAt: Date.now(),
    _submittedAction: action,
    console,
  };
  vm.createContext(ctx);
  const src = [
    fnSource("_stepEl"),
    fnSource("_setStep"),
    fnSource("resetStatusSteps"),
    fnSource("updateStatusSteps"),
    "globalThis.resetStatusSteps = resetStatusSteps;",
    "globalThis.updateStatusSteps = updateStatusSteps;",
  ].join("\n");
  new vm.Script(src, { filename: "templates.md#status-steps" }).runInContext(ctx);
  return { ...stub, reset: ctx.resetStatusSteps, update: ctx.updateStatusSteps };
}

describe("reality check — progress step behaviour (reference JS on a DOM stub)", () => {
  test("a fresh implement submission does NOT pre-arm the step", () => {
    const r = loadRuntime("implement");
    r.reset("implement");
    expect(r.steps["reality-check"].hidden).toBe(true);
    expect(r.steps.implemented.hidden).toBe(false);
  });

  test("an iterate submission arms neither the check nor the implement step", () => {
    const r = loadRuntime("iterate");
    r.reset("iterate");
    expect(r.steps["reality-check"].hidden).toBe(true);
    expect(r.steps.implemented.hidden).toBe(true);
  });

  test("pickup alone leaves the check step hidden — the common case is no drift", () => {
    const r = loadRuntime("implement");
    r.reset("implement");
    r.update({ _picked_up_at: 1 });
    expect(r.steps.received.dataset.state).toBe("done");
    expect(r.steps["reality-check"].hidden).toBe(true);
  });

  test("the reality-check phase reveals the step and marks it active", () => {
    const r = loadRuntime("implement");
    r.reset("implement");
    r.update({ _phase: "reality-check" });
    expect(r.steps["reality-check"].hidden).toBe(false);
    expect(r.steps["reality-check"].dataset.state).toBe("active");
    // Monotonic: a check implies the submission was picked up.
    expect(r.steps.received.dataset.state).toBe("done");
  });

  test("a check that ran is ticked when the implementation completes", () => {
    const r = loadRuntime("implement");
    r.reset("implement");
    r.update({ _phase: "reality-check" });
    r.update({ _phase: "implemented" });
    expect(r.steps["reality-check"].dataset.state).toBe("done");
    expect(r.steps.implemented.dataset.state).toBe("done");
  });

  test("a check that never ran does not pop into existence already ticked", () => {
    const r = loadRuntime("implement");
    r.reset("implement");
    r.update({ _phase: "implemented" });
    expect(r.steps["reality-check"].hidden).toBe(true);
    expect(r.steps["reality-check"].dataset.state).toBe("pending");
    expect(r.steps.implemented.dataset.state).toBe("done");
  });

  test("an iterate submission never shows a check step, whatever the server says", () => {
    const r = loadRuntime("iterate");
    r.reset("iterate");
    r.update({ _phase: "reality-check" });
    expect(r.steps["reality-check"].hidden).toBe(true);
  });
});

describe("reality check — the deadlock guard is written down, not implied", () => {
  test("SKILL.md runs the check as step 0 of implement, before any code", () => {
    expect(skill).toContain("Reality check — run this BEFORE writing anything");
    expect(skill).toContain("concept-drift.js");
    // The guard itself.
    expect(skill).toMatch(/Skip the check entirely.*data-reality-check/s);
  });

  test("SKILL.md forbids reporting an implementation that did not happen", () => {
    expect(skill).toMatch(/Do NOT post\s*\n?\s*`phase: "implemented"` — no code was written/);
  });

  test("SKILL.md routes the forced round through the normal append, not a special case", () => {
    expect(skill).toMatch(/append a \*\*regular\s*\n?iteration section carrying `data-reality-check`/);
    expect(skill).toContain("{{iteration.reality_tab}}");
  });

  test("answering a forced round advances the baseline — including via iterate", () => {
    // Without this, one ordinary round after a reality check brings the same
    // already-answered cards back on the next implement. That is the single
    // most likely way this feature could feel like a loop.
    expect(skill).toMatch(/If the submitted section carries `data-reality-check`, advance the\s*\n?\s*baseline/);
    expect(skill).toContain("data-reality-head");
    expect(realityDoc).toContain("data-reality-head");
  });

  test("the forced round's marker is verified on disk, not assumed", () => {
    expect(skill).toMatch(/Read the file back and confirm both attributes landed before `\/reload`/);
    expect(realityDoc).toMatch(/\*\*Read the file back after writing it\*\*/);
  });

  test("the equal-version shortcut in 5d consults /recovery first", () => {
    expect(skill).toContain("GET /recovery");
    expect(skill).toMatch(/reality-check-\*` checkpoint sits on that same `_version`/);
  });

  test("the baseline is captured at concept open, not at first implement", () => {
    expect(skill).toContain("--capture");
    expect(skill).toMatch(/Capture it at\s*\n?concept open, not at first implement/);
    expect(bridge).toContain("baseline_ref");
    expect(bridge).toContain("baseline_sha");
  });

  test("iteration-rules.md has the row and protects the marker through a freeze", () => {
    expect(iterRules).toContain("Implement submission diverted by the reality check");
    expect(iterRules).toMatch(/freeze removes `data-active` from the section and nothing else/);
    expect(iterRules).toContain("data-reality-check");
  });

  test("templates.md pins the same freeze rule where the freeze is specified", () => {
    expect(md).toMatch(/`data-active` is the ONLY attribute a freeze removes/);
  });

  test("the validation gate covers both halves and counts them", () => {
    expect(gate).toMatch(/\| 54 \| `data-step="reality-check"`/);
    expect(gate).toMatch(/\| 55 \| `iteration-tab\[data-reality-check\]`/);
    // The headline count is derived from the Phase 1 table itself (numeric
    // rows only — Phase 2 rows carry D/P prefixes), so adding an entry
    // without bumping the sentence fails here.
    const rows = (gate.match(/^\| \d+[a-z]? \| /gm) || []).length;
    expect(rows).toBeGreaterThan(54);
    expect(gate).toContain(`these ${rows} patterns`);
    // 54 is an engine entry, so a page generated before the gate existed gets
    // it re-synced on its next append instead of silently missing it forever.
    expect(gate).toMatch(/49–53 \(comment durability\),\s*54\s*\(reality-check\s*\n?\s*progress step\)/);
  });
});

describe("reality check — the doctrine document", () => {
  test("both lines of defence are stated as independent", () => {
    expect(realityDoc).toContain("Line 1, the marker");
    expect(realityDoc).toContain("Line 2, the baseline");
    expect(realityDoc).toMatch(/Both lines have to fail simultaneously/);
  });

  test("every unresolvable condition fails safe, in writing", () => {
    expect(realityDoc).toMatch(/A network hiccup must never block an implement order/);
    expect(realityDoc).toMatch(/\*\*fails safe\*\*: implement proceeds/);
  });

  test("the baseline advances on BOTH submissions of a forced round", () => {
    expect(realityDoc).toMatch(/Advance it on every submission of a reality-check round — iterate as well as\s*\n?implement/);
  });

  test("completeness is a prohibition list, not an aspiration", () => {
    expect(realityDoc).toContain("we'll clarify this in the next round");
    expect(realityDoc).toContain("conditional cards");
    expect(realityDoc).toContain("catch-all");
  });

  test("no third button, and evidence is mandatory", () => {
    expect(realityDoc).toContain("**No third button.**");
    expect(realityDoc).toMatch(/No SHA, no\s*\n?card, no force/);
  });

  test("force classes name what must NOT force, so a routine commit cannot", () => {
    expect(realityDoc).toContain("**Never force**");
    expect(realityDoc).toMatch(/version bumps, CHANGELOG, docs, tests-only changes/);
  });

  test("resume replays a recorded verdict instead of re-deciding", () => {
    expect(realityDoc).toContain("reality-check-forced");
    expect(realityDoc).toContain("reality-check-clear");
    expect(realityDoc).toMatch(/\*\*Never re-decide\*\*/);
  });
});
