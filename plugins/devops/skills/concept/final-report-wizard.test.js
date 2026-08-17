import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The final-report panel used to be four independent buttons — Shippen,
// Issues erstellen, Concept beenden, Iterationen ansehen — each POSTing its
// own action. The order between them was implicit and "I want three of these"
// had no expression: the first click submitted and ended the round. It is now
// a guided wizard ending in ONE `finalize` submit.
//
// The same reference also pins the design-template chrome: two FABs that are
// one component with two positions, and a feedback dock with exactly two
// sizes that starts collapsed. Both regressed by hand-tuning in the past —
// the FABs drifted to 56px vs 64px, the dock alternated between a box too
// small to type in and a full-width bar whose textareas never wrap.
//
// These invariants live only in prose and reference code that Claude copies
// verbatim into generated pages, so nothing but a test keeps them true.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DK = path.join(__dirname, "deep-knowledge");
const md = fs.readFileSync(path.join(DK, "templates.md"), "utf8");
const skill = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8");
const gate = fs.readFileSync(path.join(DK, "validation-gate.md"), "utf8");

function blocks(lang) {
  const re = new RegExp("```(?:" + lang + ")\\n([\\s\\S]*?)```", "g");
  const out = [];
  let m;
  while ((m = re.exec(md))) out.push(m[1]);
  return out;
}

const htmlSource = blocks("html").join("\n");
const jsSource = blocks("javascript|js").join("\n");
const cssSource = blocks("css").join("\n");

describe("final-report close-out wizard", () => {
  test("the panel offers exactly one submit, and it is finalize", () => {
    expect(jsSource).toContain("action: 'finalize'");
    // Each of these used to be its own submit path from the same panel.
    for (const gone of ["submitCreateIssues", "submitShip", "submitDisposeConcept"]) {
      expect(jsSource, gone).not.toContain(gone + "(");
    }
    for (const gone of ["ship-btn", "create-issues-btn", "dispose-concept-btn", "panel-create-issues"]) {
      expect(htmlSource, gone).not.toContain(`id="${gone}"`);
    }
  });

  test("the finalize payload carries all three decisions at once", () => {
    const fn = jsSource.slice(jsSource.indexOf("async function submitFinalize"));
    expect(fn).toBeTruthy();
    for (const key of ["issues:", "ship:", "disposition:"]) {
      expect(fn.slice(0, 2000), key).toContain(key);
    }
  });

  test("only one wizard step renders at a time", () => {
    // Without this the panel is back to showing every control at once, which
    // is the exact defect the wizard replaced.
    expect(jsSource).toContain("sec.hidden = sec.dataset.wizardStep !== current");
  });

  test("the wizard is actually wired, not just defined", () => {
    // A defined-but-unwired handler renders a complete wizard where every
    // click is inert: no console error, no network request, nothing to see.
    expect(jsSource).toContain("addEventListener('click', submitFinalize)");
    expect(jsSource).toContain("getElementById('wizard-next')");
    expect(jsSource).toContain("getElementById('wizard-back')");
    expect(jsSource).toContain("refreshFinalizeWizard({ reset: true })");
  });

  test("a finalize cannot be delivered twice", () => {
    // POST /decisions has no version guard — a payload the bridge fsynced
    // before the response was lost is queued locally AND live on the server.
    // Re-POSTing it means a second `gh issue create` run and a second release.
    expect(jsSource).toContain("submission_id: newSubmissionId()");
    const retry = jsSource.slice(jsSource.indexOf("async function retryPendingSubmission"));
    expect(retry.slice(0, 1500)).toContain("seen.submission_id === id");
  });

  test("a finalize participates in the submit-state machine", () => {
    // pollProcessedState() bails on `!_submittedAt`, so without these the
    // status channel never advances and the 5-minute stuck-state recovery
    // can never fire for the longest action there is.
    const fn = jsSource.slice(jsSource.indexOf("async function submitFinalize"), jsSource.indexOf("addEventListener('click', submitFinalize)"));
    for (const v of ["_submittedAt = Date.now()", "_submittedReloadCounter", "_submittedAction = 'finalize'"]) {
      expect(fn, v).toContain(v);
    }
  });

  test("the panel-reset safety net knows the final report has no ready panel", () => {
    // Restoring #panel-ready over a final report would paint iterate/implement
    // onto a closed session and let the user submit against it.
    const fn = jsSource.slice(jsSource.indexOf("function restorePanelToReady"));
    expect(fn.slice(0, 900)).toContain("hasAttribute('data-final-report')");
    expect(fn.slice(0, 900)).toContain("restoreWizardToReady");
  });

  test("the submitted wizard is frozen, and unfreezing never re-arms routed issues", () => {
    expect(jsSource).toContain("setWizardFrozen(true)");
    const fn = jsSource.slice(jsSource.indexOf("function setWizardFrozen"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    // Scoped to the wizard's own controls: Claude disables the body's
    // open-question checkboxes as it routes each item, permanently.
    expect(body).toContain("wiz.querySelectorAll");
    expect(body).not.toContain("data-open-questions");
  });

  test("the issue mirrors are keyed by item id, never by count", () => {
    // Claude can route one item and append another in the same rewrite. A
    // count-keyed fast path then syncs each mirror to the WRONG body checkbox:
    // the user ticks a row labelled A and files an issue for B.
    const fn = jsSource.slice(jsSource.indexOf("function buildWizardIssueList"));
    expect(fn.slice(0, 1200)).toContain("host.dataset.itemKey === ids");
    expect(fn.slice(0, 1200)).not.toMatch(/host\.children\.length === boxes\.length/);
  });

  test("the open-questions listener is element-agnostic", () => {
    // openQuestionBoxes() and the documented gating contract both accept any
    // element carrying the attribute; a listener pinned to `section[...]`
    // silently stops updating the review plan on a div/ul report.
    expect(jsSource).toContain("t.matches('[data-open-questions] input[type=\"checkbox\"]')");
    expect(jsSource).not.toContain("section[data-open-questions] input[type=\"checkbox\"]");
  });

  test("the ship answer is never restored from storage", () => {
    // saveState() persists every named radio document-wide. A restored "yes"
    // would sail through a later wizard run and ship without re-authorisation.
    const shipRadios = htmlSource.match(/<input[^>]*name="wizard-ship"[^>]*>/g) || [];
    expect(shipRadios.length).toBe(2);
    for (const r of shipRadios) expect(r).toContain("data-no-persist");
    expect(jsSource).toContain("if (el.dataset.noPersist !== undefined) return;");
    expect(jsSource).toContain("el.dataset.noPersist === undefined");
    // And no `checked` default: the ship question must be answered, not skipped.
    for (const r of shipRadios) expect(r).not.toMatch(/\schecked\b/);
  });

  test("Claude-side execution order is pinned issues → ship → cleanup", () => {
    const a = skill.indexOf("### A · Issues");
    const b = skill.indexOf("### B · Ship");
    const c = skill.indexOf("### C · Close out");
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    // A blocked ship must not fall through to a `discard` that deletes the
    // concept the user still needs.
    expect(skill).toMatch(/part C does \*\*NOT\*\* run|does NOT run/);
  });

  test("finalize checkpoints are namespaced per part", () => {
    // A bare `ship` checkpoint is indistinguishable from a legacy stand-alone
    // ship submission, so a resumed run verifies the release and never runs
    // the cleanup part.
    expect(skill).toContain("finalize:issues");
    expect(skill).toContain("finalize:ship");
    const resume = fs.readFileSync(
      path.join(__dirname, "..", "..", "hooks", "session-start", "ss.concept.resume.js"),
      "utf8"
    );
    expect(resume).toContain("Full checkpoint trail");
    expect(resume).toContain("startsWith('finalize')");
  });

  test("a discard close-out does not reload the browser onto a deleted file", () => {
    const c = skill.slice(skill.indexOf("### C · Close out"), skill.indexOf("### Legacy final-report actions"));
    expect(c).toContain("no `/reload`");
  });

  test("legacy one-at-a-time actions stay documented as legacy, not current", () => {
    expect(skill).toContain("### Legacy final-report actions");
    for (const legacy of ["create-issues", "dispose-concept"]) {
      expect(skill, legacy).toContain(legacy);
    }
  });

  test("the validation gate checks the wizard, not the old buttons", () => {
    for (const pattern of ["refreshFinalizeWizard", "renderWizard", "collectIssueItems", "submitFinalize", "finalize-wizard"]) {
      expect(gate, pattern).toContain(pattern);
    }
    for (const gone of ["submitCreateIssues", "submitShip", "submitDisposeConcept", "updateCreateIssuesPanel"]) {
      expect(gate, gone).not.toContain(gone);
    }
  });
});

describe("design-template chrome — FABs and feedback dock", () => {
  test("both FABs get their shape from ONE rule", () => {
    // The shared rule is the only place size/shape may be declared. A
    // per-FAB override is how 56px-vs-64px came back last time.
    const sharedRe = /\.panel-fab,\s*\n\.feedback-fab\s*\{[^}]*\}/;
    expect(cssSource).toMatch(sharedRe);
    // Everything the two FABs declare separately, i.e. every chance to drift.
    const rest = cssSource.replace(sharedRe, "");
    const solo = rest.match(/^\.(?:panel|feedback)-fab[^,{]*\{[^}]*\}/gm) || [];
    for (const rule of solo) {
      for (const prop of ["width", "height", "border-radius", "font-size"]) {
        expect(rule, `per-FAB rule must not redeclare ${prop}`).not.toMatch(
          new RegExp("(^|[;{\\s])" + prop + "\\s*:")
        );
      }
    }
  });

  test("the FAB rule keeps them circular with a centred glyph", () => {
    const shared = cssSource.match(/\.panel-fab,\s*\n\.feedback-fab\s*\{([^}]*)\}/);
    expect(shared).toBeTruthy();
    const body = shared[1];
    // A bare width/height on a <button> still inherits UA padding and
    // baseline metrics — that is how "round" turns into "egg-shaped".
    for (const decl of ["box-sizing", "padding", "line-height", "border-radius", "align-items", "justify-content"]) {
      expect(body, decl).toContain(decl);
    }
    const width = body.match(/width:\s*(\d+)px/);
    const height = body.match(/height:\s*(\d+)px/);
    expect(width && height).toBeTruthy();
    expect(width[1]).toBe(height[1]);
  });

  test("the dock starts collapsed", () => {
    const dock = htmlSource.match(/<aside[^>]*id="feedback-dock"[^>]*>/);
    expect(dock).toBeTruthy();
    expect(dock[0]).toContain('data-open="false"');
    // The auto-open / auto-close-on-first-click machinery is gone with it.
    for (const gone of ["fireAutoClose", "autoCloseArmed", "autoCloseUsed"]) {
      expect(jsSource, gone).not.toContain(gone);
    }
    expect(md).not.toContain('data-auto-close-armed="true"');
  });

  test("the dock has exactly two sizes, both fixed", () => {
    expect(jsSource).toContain("function applyDockSize");
    expect(jsSource).toMatch(/dock\.dataset\.size = .*'compact' : 'wide'|'compact'\s*:\s*'wide'/);
    // Base rule = compact, one override = wide. No third variant, and no
    // viewport-proportional width outside the narrow-viewport media query.
    const variants = cssSource.match(/\.feedback-dock\[data-size="[a-z]+"\]/g) || [];
    expect([...new Set(variants)]).toEqual(['.feedback-dock[data-size="wide"]']);
    const base = cssSource.match(/^\.feedback-dock\s*\{([^}]*)\}/m);
    expect(base).toBeTruthy();
    expect(base[1]).toMatch(/width:\s*min\(\d+px/);
  });
});

describe("UI locale table stays in sync with the markup", () => {
  const used = new Set([...md.matchAll(/\{\{(final\.[a-z_]+)\}\}/g)].map((m) => m[1]));
  const declared = new Set(
    [...md.matchAll(/^\|\s*`(final\.[a-z_]+)`/gm)].map((m) => m[1])
  );

  test("every {{final.*}} placeholder has a locale row", () => {
    expect([...used].filter((k) => !declared.has(k))).toEqual([]);
  });

  test("every locale row is still referenced by the markup", () => {
    expect([...declared].filter((k) => !used.has(k))).toEqual([]);
  });
});
