/**
 * Pins the do-run question contract (spec § "do-run questions",
 * docs/superpowers/specs/2026-09-24-skill-restructure-design.md):
 *
 * - ONE base AskUserQuestion call with the four spec questions, fixed option
 *   order, the agnostic recommendation first (the only single-select option
 *   labelled "(Recommended)"), parallel short labels, never "Ja"/"Nein".
 * - "Budget verbrennen" is last in Q4, conditional on weekly usage > 80 %
 *   (get_usage) and never recommended.
 * - An empty Q4 answer means the recommended set, so click-through is a run.
 * - The follow-up obeys the same label rules, and the questions the folded
 *   skills used to ask are gone from their mode files.
 *
 * The router renders its questions from fenced blocks in SKILL.md; this test
 * parses those blocks the same way a reader of the skill would.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(join(here, "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
const mode = (name) => readFileSync(join(here, "modes", `${name}.md`), "utf8").replace(/\r\n/g, "\n");

const REC = " (Recommended)";

function section(text, startHeading, endHeading) {
  const start = text.indexOf(startHeading);
  expect(start, `heading not found: ${startHeading}`).toBeGreaterThan(-1);
  const end = endHeading ? text.indexOf(endHeading, start + 1) : -1;
  return text.slice(start, end === -1 ? text.length : end);
}

/** Parse the first fenced block of a section into questions with options. */
function parseQuestions(sectionText) {
  const fence = sectionText.match(/```\n([\s\S]*?)```/);
  expect(fence, "fenced question block").toBeTruthy();
  const questions = [];
  for (const line of fence[1].split("\n")) {
    const q = line.match(/^([QF]\d)\s+header: "([^"]+)"\s+multiSelect: (true|false)/);
    if (q) {
      questions.push({ id: q[1], header: q[2], multi: q[3] === "true", options: [], dataDriven: false });
      continue;
    }
    const cur = questions[questions.length - 1];
    if (!cur) continue;
    if (/^\s+options = /.test(line)) cur.dataDriven = true;
    const o = line.match(/^\s+(\d+)\. "([^"]+)"\s+—\s+(.*)$/);
    if (o) {
      const raw = o[2];
      cur.options.push({
        n: Number(o[1]),
        raw,
        label: raw.endsWith(REC) ? raw.slice(0, -REC.length) : raw,
        recommended: raw.endsWith(REC),
        note: o[3],
      });
    }
  }
  return questions;
}

const base = parseQuestions(section(skill, "## Step 3 — Base call", "## Step 4"));
const followUp = parseQuestions(section(skill, "## Step 4 — Follow-up", "## Step 5"));
const byId = (list, id) => list.find((q) => q.id === id);

describe("base call: the four spec questions in one AskUserQuestion", () => {
  test("exactly four questions (the tool maximum), Q1–Q4 in order", () => {
    expect(base.map((q) => q.id)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
  });

  test("headers match the spec table", () => {
    expect(base.map((q) => q.header)).toEqual(["Was?", "Ablauf?", "Umfang?", "Durchgänge?"]);
  });

  test("only Q4 is multi-select", () => {
    expect(base.map((q) => q.multi)).toEqual([false, false, false, true]);
  });

  test("the skill says ONE call and at most one follow-up", () => {
    expect(skill).toMatch(/Base call: four questions, one `AskUserQuestion`/);
    expect(skill).toMatch(/Follow-up: at most one more call/);
  });
});

describe("base call: fixed option order", () => {
  const EXPECTED = {
    Q1: ["Prompt umsetzen", "Audit", "Backlog"],
    Q2: ["Interaktiv · Ship manuell", "Interaktiv · Ship automatisch", "Autonom · Ship manuell", "Autonom · Ship automatisch"],
    Q3: ["Flexibel", "Strikt"],
    Q4: ["Harden danach", "Polish danach", "Rethink vorher", "Budget verbrennen"],
  };

  test.each(Object.entries(EXPECTED))("%s options in spec order", (id, labels) => {
    const q = byId(base, id);
    expect(q.options.map((o) => o.label)).toEqual(labels);
    expect(q.options.map((o) => o.n)).toEqual(labels.map((_, i) => i + 1));
  });

  test("the skill forbids reordering and names click-through as a valid run", () => {
    expect(skill).toMatch(/nothing ever moves one/);
    expect(skill).toMatch(/Click-through is a valid run/);
  });
});

describe("base call: recommendation", () => {
  test.each(["Q1", "Q2", "Q3"])("%s: first option is the only one marked (Recommended)", (id) => {
    const q = byId(base, id);
    expect(q.options[0].recommended).toBe(true);
    expect(q.options.slice(1).some((o) => o.recommended)).toBe(false);
  });

  test("Q4: Harden + Polish recommended; Rethink only conditionally; Budget never", () => {
    const [harden, polish, rethink, budget] = byId(base, "Q4").options;
    expect(harden.recommended).toBe(true);
    expect(polish.recommended).toBe(true);
    expect(rethink.recommended).toBe(false);
    expect(rethink.note).toMatch(/\(Recommended\)" when the prompt reads stuck/);
    expect(budget.recommended).toBe(false);
    expect(budget.note).toMatch(/never recommended/);
  });

  test("Q2's recommended option keeps ship manual (the user's 'ship nein default')", () => {
    expect(byId(base, "Q2").options[0].label).toBe("Interaktiv · Ship manuell");
  });
});

describe("base call: conditional options", () => {
  test("Backlog is Q1's last option and only shown when open issues exist", () => {
    const q1 = byId(base, "Q1");
    expect(q1.options.at(-1).label).toBe("Backlog");
    expect(q1.options.at(-1).note).toMatch(/only when open issues exist/);
    expect(skill).toMatch(/gh issue list --state open --limit 1/);
    expect(skill).toMatch(/omit it silently/);
  });

  test("Budget verbrennen is last, gated on get_usage weekly > 80 %", () => {
    const q4 = byId(base, "Q4");
    const budget = q4.options.at(-1);
    expect(budget.label).toBe("Budget verbrennen");
    expect(budget.note).toMatch(/weekly usage > 80 %/);
    expect(skill).toMatch(/get_usage/);
    expect(skill).toMatch(/weekly\.pct > 80/);
  });

  test("Q1 is skipped when started from do-batch", () => {
    expect(skill).toMatch(/`--from=do-batch` \| Q1 dropped/);
  });
});

describe("base call: Q3 default = last choice, without reordering", () => {
  test("the last choice is a description suffix, never a marker or position change", () => {
    expect(skill).toMatch(/" · zuletzt gewählt"/);
    expect(skill).toMatch(/Label, marker and order stay unchanged/);
  });

  test("Strikt arms the existing strict machinery, not a reimplementation", () => {
    const umfang = section(skill, "## Step 5 — Umfang", "## Step 6");
    expect(umfang).toMatch(/hooks\/lib\/strict-state\.js/);
    // One CLI call that arms AND prints the contract only on success — no
    // `node -e` with process.env.CLAUDE_PLUGIN_ROOT (red-team R6).
    expect(umfang).toContain('node "${CLAUDE_PLUGIN_ROOT}/hooks/lib/strict-state.js" inline');
    expect(umfang).not.toMatch(/node -e/);
    expect(umfang).toMatch(/non-zero exit means strict is NOT on/);
    expect(umfang).toContain("deep-knowledge/strict.md");
    expect(umfang).not.toContain("skills/claude-strict");
  });
});

describe("base call: empty multi-select answer", () => {
  test("nothing ticked in Q4 = the recommended set; 'keine' = no passes", () => {
    const reading = section(skill, "**Reading Q4", "## Step 4");
    expect(reading).toMatch(/Nothing ticked\*\* → the recommended set/);
    expect(reading).toMatch(/"keine" \/ "none"/);
  });

  test("Q4's question names the set an empty answer runs (no pre-tick exists)", () => {
    expect(skill).toMatch(/Leer lassen = Harden \+ Polish\)/);
    expect(skill).toMatch(/no pre-selection: an option can be\s+marked, never pre-ticked/);
  });
});

describe("label rules (base call and follow-up)", () => {
  const all = [...base, ...followUp].flatMap((q) => q.options.map((o) => [q.id, o.label]));

  test("fixtures parsed", () => {
    expect(all.length).toBeGreaterThan(15);
    expect(followUp.map((q) => q.id)).toEqual(["F1", "F2", "F3", "F4", "F5", "F6"]);
  });

  test.each(all)("%s %j is never a Ja/Nein answer", (_id, label) => {
    expect(label).not.toMatch(/^(ja|nein|yes|no)\b/i);
  });

  test.each(all)("%s %j is short (≤ 4 words, ≤ 30 chars)", (_id, label) => {
    const words = label.split(/\s+/).filter((w) => w !== "·");
    expect(words.length).toBeLessThanOrEqual(4);
    // 30, not shorter: "Interaktiv · Ship automatisch" — the user chose
    // words that explain themselves over a terser label.
    expect(label.length).toBeLessThanOrEqual(30);
  });

  test("headers fit the tool's 12-character chip", () => {
    for (const q of [...base, ...followUp]) expect(q.header.length, q.header).toBeLessThanOrEqual(12);
  });

  test("Q2 labels share one shape: <presence> · Ship <how>", () => {
    for (const o of byId(base, "Q2").options) {
      expect(o.label).toMatch(/^(Interaktiv|Autonom) · Ship (manuell|automatisch)$/);
    }
  });

  test("Q4 labels share one shape: <noun> <when/verb>", () => {
    for (const o of byId(base, "Q4").options) {
      expect(o.label).toMatch(/^\S+ (danach|vorher|verbrennen)$/);
    }
  });

  test("F2 and F6 labels share one shape each", () => {
    for (const o of byId(followUp, "F2").options) expect(o.label).toMatch(/ prüfen$/);
    for (const o of byId(followUp, "F6").options) expect(o.label).toMatch(/^PC (an|aus) · (mit|ohne) Resume$/);
  });

  test("F6 never pairs shutdown with resume (autonomous HARD GATE by construction)", () => {
    const labels = byId(followUp, "F6").options.map((o) => o.label);
    expect(labels).not.toContain("PC aus · mit Resume");
    expect(labels[0]).toBe("PC an · mit Resume");
  });

  test("follow-up single-selects: first option is the recommendation", () => {
    for (const q of followUp.filter((x) => !x.multi && !x.dataDriven)) {
      expect(q.options[0].recommended, q.id).toBe(true);
      // F2 may move the marker to option 2 only when option 1 is hidden.
      const extra = q.options.slice(1).filter((o) => o.recommended);
      expect(extra, q.id).toEqual([]);
    }
  });
});

describe("folded questions are answered by the router, not asked by the modes", () => {
  test("backlog: no ship-mandate or budget-mode question left", () => {
    const b = mode("backlog");
    expect(b).not.toMatch(/header: "Ship-Mandat"/);
    expect(b).not.toMatch(/"Ja, mit Ship-Mandat"/);
    expect(b).not.toMatch(/"Ja, Budget-Modus/);
    expect(b).toMatch(/answered by the do-run router/);
  });

  test("burn: no confirm question left", () => {
    const b = mode("burn");
    expect(b).not.toMatch(/"Ja, burn starten"/);
    expect(b).toMatch(/Answered by the do-run router — do not ask/);
  });

  test("autonomous: no analyse-vs-implement question left, HARD GATE kept", () => {
    const a = mode("autonomous");
    expect(a).not.toMatch(/Nur analysieren oder auch implementieren/);
    expect(a).toMatch(/HARD GATE/);
    expect(a).toMatch(/Answered by the do-run router — do not ask/);
    expect(a).toMatch(/## Step 6\.5 — Passes and ship \(do-run router\)/);
  });

  test("resume is asked by the router before the base call, not by the modes", () => {
    expect(skill).toMatch(/## Step 2 — Resume before anything else/);
    expect(mode("autonomous")).not.toMatch(/"Ja, fortsetzen/);
    expect(mode("burn")).not.toMatch(/Options: `\["Fortsetzen", "Neu starten"\]`/);
  });

  test("implementation goes through auto-agents", () => {
    expect(skill).toMatch(/Skill\("devops:auto-agents"\)/);
    expect(skill).toMatch(/--from=do-run --mode=<interactive\|background> --ship=<auto\|manual>/);
  });
});

describe("Step 7 ship lockout (red-team R5)", () => {
  const step7 = () => section(skill, "## Step 7", "## Rules");

  test("arms the do-run lockout and clears it on every exit path", () => {
    const s = step7();
    expect(s).toContain('autonomous-lockout.js" arm do-run');
    expect(s).toMatch(/clear runs on every\s+exit/);
    for (const exit of ["ship succeeded", "ship blocked", "ship aborted"]) expect(s, exit).toContain(exit);
  });

  test("names the TTL fallback for a lockout a crash leaves behind", () => {
    expect(step7()).toMatch(/stale after 6 h/);
  });
});
