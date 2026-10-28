import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSkill } from "./skill-source.js";
import { readTemplates } from "./templates-source.js";

// The final-report panel used to be four independent buttons — Shippen,
// Issues erstellen, Concept beenden, Iterationen ansehen — each POSTing its
// own action. The order between them was implicit and "I want three of these"
// had no expression: the first click submitted and ended the round. A guided
// wizard fixed that and added its own confusion (a "Weiter" that might
// already have committed something, the consequence list buried on step 4).
// It is now a to-do inbox (🧭 / 🧪 / 👉, pre-selected) with two buttons that
// are the ship answer — both submit one `finalize`.
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
const md = readTemplates();
const skill = readSkill();
const gate = ["validation-gate.md", "validation-gate-phase2.md"].map((f) => fs.readFileSync(path.join(DK, f), "utf8")).join("");

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

describe("final-report close-out sheet", () => {
  test("the panel offers exactly one submit, and it is finalize", () => {
    expect(jsSource).toContain("action: 'finalize'");
    for (const gone of ["submitCreateIssues", "submitShip", "submitDisposeConcept"]) {
      expect(jsSource, gone).not.toContain(gone + "(");
    }
    for (const gone of ["ship-btn", "create-issues-btn", "dispose-concept-btn", "panel-create-issues"]) {
      expect(htmlSource, gone).not.toContain(`id="${gone}"`);
    }
  });

  test("the finalize payload carries every decision at once, 🧪/👉 included", () => {
    const fn = jsSource.slice(jsSource.indexOf("async function submitFinalize"));
    for (const key of ["issues:", "implement:", "ship:", "tests: collectTodos('tests')", "handoffs: collectTodos('handoffs')", "disposition:"]) {
      expect(fn.slice(0, 2500), key).toContain(key);
    }
    // The ship answer is which button was clicked — nothing else.
    expect(fn.slice(0, 600)).toContain("const ship = shipRun === true;");
    expect(fn.slice(0, 2500)).toContain("ship: { run: ship }");
  });

  test("two buttons are the ship answer — no ship row, no accordion, no progress, no Weiter", () => {
    expect(htmlSource).toMatch(/id="closeout-ship"[^>]*data-closeout-go="yes"/);
    expect(htmlSource).toMatch(/id="closeout-noship"[^>]*data-closeout-go="no"/);
    expect(htmlSource).toContain('data-label="{{final.closeout_ship_go}}"');
    expect(htmlSource).toContain('data-label="{{final.closeout_noship_go}}"');
    for (const gone of ['name="closeout-ship"', 'id="closeout-execute"', 'id="closeout-progress"', "data-closeout-block=", "data-closeout-row"]) {
      expect(htmlSource, gone).not.toContain(gone);
    }
    for (const gone of ["function closeoutButtonClick", "function openCloseoutRow", "function isCloseoutRowLocked", "function layoutCloseoutRowHeads", "closeout_next", "closeout_progress"]) {
      expect(md, gone).not.toContain(gone);
    }
    const row = (k) => md.split("\n").find((l) => l.startsWith("| `" + k + "`"));
    expect(row("final.closeout_ship_go")).toContain("Abschließen & shippen");
    expect(row("final.closeout_noship_go")).toContain("Nur abschließen, nicht shippen");
    // The ship button is the warning FILL, without a ⚠ glyph.
    expect(htmlSource).toContain('data-icon="🏁🚀"');
    const rule = cssSource.slice(cssSource.indexOf(".closeout-sheet #closeout-ship {"));
    expect(rule.slice(0, 200)).toContain("background: var(--warning-color");
  });

  test("the inbox has the three groups in order, then the 🤖 group under the divider", () => {
    const at = (s) => htmlSource.indexOf(s);
    const order = [
      'data-closeout-group="decide"',
      'data-closeout-group="tests"',
      'data-closeout-group="handoffs"',
      'class="closeout-foot"',
      "{{final.group_claude}}",
      "data-dispose-summary",
      'id="closeout-ship"',
      'id="closeout-noship"',
    ];
    for (let i = 1; i < order.length; i++) expect(at(order[i]), order[i]).toBeGreaterThan(at(order[i - 1]));
    expect(htmlSource).toContain("<span aria-hidden=\"true\">👉</span> {{final.group_handoffs}}");
    expect(htmlSource).not.toContain("✋");
    expect(jsSource).toContain("const CLOSEOUT_GROUP_MAX = 3;");
  });

  test("the sheet is actually wired, not just defined", () => {
    expect(jsSource).toContain("sheet?.addEventListener('click', closeoutSheetClick)");
    expect(jsSource).toContain("refreshCloseout({ reset: true })");
    const click = jsSource.slice(jsSource.indexOf("function closeoutSheetClick"));
    expect(click.slice(0, 600)).toContain("submitFinalize(go.dataset.closeoutGo === 'yes')");
  });

  test("a finalize cannot be delivered twice", () => {
    expect(jsSource).toContain("submission_id: newSubmissionId()");
    const retry = jsSource.slice(jsSource.indexOf("async function retryPendingSubmission"));
    expect(retry.slice(0, 3200)).toContain("seen.submission_id === id");
  });

  test("a finalize participates in the submit-state machine", () => {
    const fn = jsSource.slice(jsSource.indexOf("async function submitFinalize"), jsSource.indexOf("async function restoreInFlightCloseout"));
    for (const v of ["_submittedAt = Date.now()", "_submittedReloadCounter", "_submittedAction = 'finalize'", "body.durable !== false"]) {
      expect(fn, v).toContain(v);
    }
  });

  test("the panel-reset safety net knows the final report has no ready panel", () => {
    const fn = jsSource.slice(jsSource.indexOf("function restorePanelToReady"));
    expect(fn.slice(0, 900)).toContain("hasAttribute('data-final-report')");
    expect(fn.slice(0, 900)).toContain("restoreCloseoutToReady");
  });

  test("the submitted sheet is frozen, scoped to its own controls", () => {
    expect(jsSource).toContain("setCloseoutFrozen(true)");
    const fn = jsSource.slice(jsSource.indexOf("function setCloseoutFrozen"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toContain("sheet.querySelectorAll");
    expect(body).not.toContain("data-open-questions");
  });

  test("rows are rebuilt by item set, never by count", () => {
    const fn = jsSource.slice(jsSource.indexOf("function renderGroup"));
    expect(fn.slice(0, 600)).toContain("host.dataset.itemKey !== sig");
  });

  test("no choice on the sheet is restored from storage", () => {
    expect(jsSource).toContain("const _closeoutChoices = { route: {}, mode: {} };");
    expect(jsSource).toContain("input.dataset.noPersist = ''");
    expect(jsSource).toContain("if (el.dataset.noPersist !== undefined) return;");
    const block = md.slice(md.indexOf('// --- Final-report close-out sheet'), md.indexOf("// --- Offline Submit Queue ---"));
    expect(block).not.toMatch(/\b(localStorage|sessionStorage)\s*\./);
  });

  test("the UI never says 'nicht führbar'", () => {
    const rows = md.split("\n").filter((l) => l.startsWith("| `final."));
    expect(rows.filter((l) => /nicht führbar|not guidable/i.test(l))).toEqual([]);
    expect(htmlSource).not.toMatch(/nicht führbar/i);
  });

  test("Claude-side execution order is pinned issues → implement → ship → cleanup", () => {
    const a = skill.indexOf("### A · Issues");
    const b = skill.indexOf("### B · Implement the selected follow-ups");
    const c = skill.indexOf("### C · Ship");
    const d = skill.indexOf("### D · Close out");
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(d).toBeGreaterThan(c);
    // A blocked ship must not fall through to a `discard` that deletes the
    // concept the user still needs.
    expect(skill).toMatch(/part C does \*\*NOT\*\* run|does NOT run/);
  });

  test("the legacy actions map onto the parts that DO the same thing", () => {
    // The letters shifted when the implement part was inserted. A `ship`
    // mapped to "part B" would build follow-ups instead of releasing; worse,
    // a `dispose-concept` mapped to "part C" would run the ship pipeline —
    // a release nobody authorised, from a page whose only button said
    // "Concept beenden".
    const legacy = skill.slice(
      skill.indexOf("### Legacy final-report actions"),
      skill.indexOf("**Critical invariant:**")
    );
    const partOf = (name) => {
      const m = new RegExp("\\| `" + name + "` \\| ([^|]+)\\|").exec(legacy);
      expect(m, name).toBeTruthy();
      return m[1];
    };
    expect(partOf("create-issues")).toMatch(/part A/);
    expect(partOf("ship")).toMatch(/part C/);
    expect(partOf("dispose-concept")).toMatch(/part D/);
    // …and the headings those letters point at still say what the mapping
    // claims they say.
    expect(skill).toMatch(/### A · Issues/);
    expect(skill).toMatch(/### C · Ship/);
    expect(skill).toMatch(/### D · Close out/);
    expect(partOf("dispose-concept"), "a close-out must never reach the ship pipeline")
      .not.toMatch(/ship/i);
  });

  test("every place that names the order names the same four parts", () => {
    // Three documents state it — SKILL.md, the reference JS's own hand-off
    // note, and § One submission. A reader who only sees one of them must not
    // be able to drop a part.
    const order = [/issues/i, /implement/i, /ship/i, /clean|close/i];
    const spots = [
      skill.slice(skill.indexOf("**Fixed execution order"), skill.indexOf("**Checkpoint each part")),
      md.slice(md.indexOf("- `finalize` → Step 5b finalize branch"), md.indexOf("- `create-issues` / `ship`")),
      md.slice(md.indexOf("### One submission, four consequences"), md.indexOf("## Design System")),
    ];
    for (const [i, spot] of spots.entries()) {
      expect(spot, "spot " + i).toBeTruthy();
      let at = -1;
      for (const re of order) {
        const m = re.exec(spot.slice(at + 1));
        expect(m, `spot ${i} · ${re}`).toBeTruthy();
        at = at + 1 + m.index;
      }
    }
  });

  test("the resume mandate describes the same four parts the skill executes", () => {
    const resume = fs.readFileSync(
      path.join(__dirname, "..", "..", "hooks", "session-start", "ss.concept.resume.js"),
      "utf8"
    );
    // A mandate that names three parts makes a resumed run skip the one the
    // user explicitly asked for — the follow-ups it was told to build.
    expect(resume).toContain("FOUR parts in fixed order");
    for (const key of ["issues", "implement", "ship", "disposition"]) {
      expect(resume, key).toContain("\\`" + key + "\\`");
    }
  });

  test("finalize checkpoints are namespaced per part", () => {
    // A bare `ship` checkpoint is indistinguishable from a legacy stand-alone
    // ship submission, so a resumed run verifies the release and never runs
    // the cleanup part.
    for (const ns of ["finalize:issues", "finalize:implement", "finalize:ship", "finalize:cleanup"]) {
      expect(skill, ns).toContain(ns);
    }
    const resume = fs.readFileSync(
      path.join(__dirname, "..", "..", "hooks", "session-start", "ss.concept.resume.js"),
      "utf8"
    );
    expect(resume).toContain("Full checkpoint trail");
    expect(resume).toContain("startsWith('finalize')");
  });

  test("a discard concept is excluded locally before the ship and released after (#931)", () => {
    // Untracked concept files fail ship_preflight's clean-tree check; deleting
    // them before the ship would kill the page that reports the result.
    const c = skill.slice(skill.indexOf("### C · Ship"), skill.indexOf("### D · Close out"));
    expect(c).toContain("info/exclude");
    expect(c).toContain('"/docs/concepts/{date}-{slug}/"');
    expect(c).toMatch(/never\s+a glob/);
    const close = skill.slice(skill.indexOf("**Drop the local exclude lines (#931).**"));
    expect(close.length).toBeGreaterThan(0);
    expect(close.slice(0, 1200)).toContain("info/exclude");
    expect(close.slice(0, 1200)).toContain("filter(l=>!p.includes(");
    // Git Bash path-converts a leading-slash argument for node — no `/docs/`.
    expect(close.slice(0, 1200)).toContain('"docs/concepts/{date}-{slug}/"');
  });

  test("a discard close-out does not reload the browser onto a deleted file", () => {
    const c = skill.slice(skill.indexOf("### D · Close out"), skill.indexOf("### Legacy final-report actions"));
    expect(c).toContain("no `/reload`");
  });

  test("the implement part is delegated to the devops agents, not done inline", () => {
    const b = skill.slice(
      skill.indexOf("### B · Implement the selected follow-ups"),
      skill.indexOf("### C · Ship")
    );
    expect(b).toMatch(/devops role agents/i);
    // auto-agents is the single execution path of every implementing skill.
    expect(b).toContain("`auto-agents` skill");
    expect(b).toContain("--from=auto-concept");
    expect(b).toContain("never inline");
    // The item shape is the same one part A files as issues, so the brief an
    // agent gets is the body Claude wrote for the issue.
    expect(b).toContain("part-A item shape");
  });

  test("legacy one-at-a-time actions stay documented as legacy, not current", () => {
    expect(skill).toContain("### Legacy final-report actions");
    for (const legacy of ["create-issues", "dispose-concept"]) {
      expect(skill, legacy).toContain(legacy);
    }
  });

  test("the validation gate checks the sheet, not the old buttons", () => {
    for (const pattern of ["refreshCloseout", "renderCloseout", "collectIssueItems", "collectImplementItems", "submitFinalize", "closeout-sheet"]) {
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
    // Pseudo-elements (the 💬 FAB's speech tail) are separate boxes, not the
    // FAB's own shape, so they may size themselves.
    const solo = (rest.match(/^\.(?:panel|feedback)-fab[^,{]*\{[^}]*\}/gm) || [])
      .filter((rule) => !/^[^{]*::/.test(rule));
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
