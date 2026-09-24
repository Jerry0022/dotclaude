import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  ALIAS_MAP,
  HOOK_OWNED_MODES,
  SINGLE_WORD_ALLOWLIST,
  PHRASE_DENYLIST,
  detectAliasMentions,
  detectAliasHits,
  buildWordTriggerCorpus,
  matchWordTriggers,
  stripCodeAndQuotes,
  looksLikeBugReport,
  capAndDedupe,
  routeMessage,
} = require("./skill-trigger-router.js");
const { loadAllSkills } = require("./skill-meta.js");
const path = require("node:path");

const REAL_SKILLS = loadAllSkills(path.join(process.cwd(), "plugins", "devops", "skills"));

function skillSet(overrides) {
  return {
    "auto-fix": { name: "auto-fix", triggers: { en: ["error", "crash", "this is broken", "doesn't work"], de: ["funktioniert nicht"] } },
    "do-ship": { name: "do-ship", triggers: { en: ["ship it", "push and merge", "release", "promote", "promotion", "promote to beta"] } },
    "do-run": { name: "do-run", triggers: { en: ["/run-burn", "backlog runner"], de: ["festgefahren"] } },
    "do-batch": { name: "do-batch", triggers: { en: ["batch mode"], de: ["sammelmodus"] } },
    "claude-strict": { name: "claude-strict", triggers: { en: ["strict"], de: ["strikt"] } },
    "auto-polish": { name: "auto-polish", triggers: { en: ["polish", "design pass"], de: ["feinschliff"] } },
    "auto-harden": { name: "auto-harden", triggers: { de: ["härten"] } },
    "auto-graph": { name: "auto-graph", triggers: { en: ["knowledge graph", "graphify"] } },
    "auto-guide": { name: "auto-guide", triggers: { en: ["guide me through"], de: ["führe mich durch"] } },
    "do-learn": { name: "do-learn", triggers: { en: ["capture learning", "/devops-learn", "/do-learn"], de: ["lerne das", "学习这个"] } },
    ...overrides,
  };
}

const routedSkills = (msg) => routeMessage(msg, REAL_SKILLS).map((e) => e.skill);

describe("ALIAS_MAP — old names → the skill that owns them after PR 2", () => {
  test("every 1:1 rename maps to its new skill without a mode", () => {
    const expected = {
      ship: "do-ship", "claude-learn": "do-learn", "claude-batch": "do-batch", concept: "auto-concept",
      fix: "auto-fix", "setup-issue": "auto-issue", "tune-polish": "auto-polish", "tune-harden": "auto-harden",
      "web-guide": "auto-guide", "claude-extend-skill": "auto-extend", "run-agents": "auto-agents",
    };
    for (const [oldName, skill] of Object.entries(expected)) {
      expect(ALIAS_MAP[oldName], oldName).toEqual({ skill, mode: null });
    }
  });

  test("every folded skill maps to its owner AND its mode", () => {
    expect(ALIAS_MAP["run-backlog"]).toEqual({ skill: "do-run", mode: "backlog" });
    expect(ALIAS_MAP["run-autonomous"]).toEqual({ skill: "do-run", mode: "autonomous" });
    expect(ALIAS_MAP["run-burn"]).toEqual({ skill: "do-run", mode: "burn" });
    expect(ALIAS_MAP["tune-rethink"]).toEqual({ skill: "do-run", mode: "rethink" });
    expect(ALIAS_MAP["tune-audit"]).toEqual({ skill: "do-run", mode: "audit" });
    expect(ALIAS_MAP.promote).toEqual({ skill: "do-ship", mode: "promote" });
  });

  test("new names are real skills, not aliases (the inline-mention path owns them)", () => {
    for (const n of ["do-run", "do-ship", "auto-fix", "auto-agents", "auto-update"]) {
      expect(ALIAS_MAP[n], n).toBeUndefined();
    }
  });
});

describe("detectAliasMentions / detectAliasHits", () => {
  test("/claude-learn maps to do-learn, /fix to auto-fix", () => {
    expect(detectAliasMentions("bitte /claude-learn das hier")).toEqual(["do-learn"]);
    expect(detectAliasMentions("mach das mit /fix")).toEqual(["auto-fix"]);
  });

  test("a folded old name carries its mode", () => {
    expect(detectAliasHits("bitte /run-backlog heute")).toEqual([{ skill: "do-run", mode: "backlog", alias: "run-backlog" }]);
    expect(detectAliasHits("und dann /tune-audit")).toEqual([{ skill: "do-run", mode: "audit", alias: "tune-audit" }]);
  });

  test("1:1 aliases of skills owned by a dedicated hook emit nothing (/ship, /claude-batch)", () => {
    expect(detectAliasMentions("bitte /ship jetzt")).toEqual([]);
    expect(detectAliasMentions("/claude-batch an")).toEqual([]);
  });

  // Skill restructure PR 2: promote is do-ship's target channel now, parsed
  // by prompt.ship.detect (lib/ship-intent.js) — the router must not add a
  // second, conflicting mandate (args "promote" next to the hook's "stable").
  test("/promote belongs to prompt.ship.detect — the router emits nothing for it", () => {
    expect(detectAliasHits("jetzt /promote stable")).toEqual([]);
    expect(HOOK_OWNED_MODES.has("do-ship")).toBe(true);
  });

  test("dedupes by skill and keeps order of first appearance", () => {
    expect(detectAliasMentions("/fix dann /fix nochmal, danach /tune-polish")).toEqual([
      "auto-fix",
      "auto-polish",
    ]);
    expect(detectAliasHits("/run-backlog und /tune-rethink")).toEqual([
      { skill: "do-run", mode: "backlog", alias: "run-backlog" },
    ]);
  });

  test("an alias inside code or quotes is not a mention", () => {
    expect(detectAliasMentions("the hook says `/fix` there")).toEqual([]);
    expect(detectAliasMentions('the doc names "/fix" as the old name')).toEqual([]);
    expect(detectAliasMentions("```\n/fix\n```")).toEqual([]);
  });

  test("new names and unknown slashes are not aliases", () => {
    expect(detectAliasMentions("/do-run bitte")).toEqual([]);
    expect(detectAliasMentions("/auto-fix bitte")).toEqual([]);
    expect(detectAliasMentions("/oder so")).toEqual([]);
  });
});

describe("stripCodeAndQuotes", () => {
  test("removes fenced code blocks", () => {
    expect(stripCodeAndQuotes("before ```\nTypeError: error\n``` after")).not.toContain("TypeError");
  });

  test("removes inline code spans and straight quotes", () => {
    expect(stripCodeAndQuotes("run `error()` please")).not.toContain("error()");
    expect(stripCodeAndQuotes('the log said "error" once')).not.toContain("error");
    expect(stripCodeAndQuotes("she said 'ship' loudly")).not.toContain("ship");
  });

  test("removes typographic quotes (German „…“, English “…”, guillemets)", () => {
    expect(stripCodeAndQuotes("er schrieb „feinschliff“ dazu")).not.toContain("feinschliff");
    expect(stripCodeAndQuotes("she wrote “concept” there")).not.toContain("concept");
    expect(stripCodeAndQuotes("»härten« stand da")).not.toContain("härten");
  });

  test("apostrophes inside words are not quotes", () => {
    const s = stripCodeAndQuotes("it doesn't work and it's broken");
    expect(s).toContain("doesn't work");
    expect(s).toContain("it's broken");
  });

  test("non-string input yields ''", () => {
    expect(stripCodeAndQuotes(null)).toBe("");
  });
});

describe("buildWordTriggerCorpus — what the router acts on", () => {
  const corpus = buildWordTriggerCorpus(skillSet());
  const phrases = (skill) => corpus.filter((e) => e.skill === skill).map((e) => e.phrase);

  test("generic single words are NOT routed (error, crash, polish, promote, strict …)", () => {
    expect(phrases("auto-fix")).not.toContain("error");
    expect(phrases("auto-fix")).not.toContain("crash");
    expect(phrases("auto-polish")).not.toContain("polish");
    expect(phrases("do-ship")).not.toContain("promote");
    expect(phrases("do-ship")).not.toContain("promotion");
  });

  test("allowlisted single words are routed", () => {
    expect(phrases("auto-polish")).toContain("feinschliff");
    expect(phrases("auto-harden")).toContain("härten");
  });

  test("bare 'concept' is not routed; the router-only verb-object phrases are (R1)", () => {
    const c = buildWordTriggerCorpus({ "auto-concept": { name: "auto-concept", triggers: { en: ["concept", "concept page"] } } });
    const p = c.map((e) => e.phrase);
    expect(p).not.toContain("concept");
    expect(p).toContain("concept page");
    expect(p).toEqual(expect.arrayContaining(["ein concept", "concept für", "als concept", "concept-seite"]));
  });

  test("multi-word phrases are routed; denylisted ones are not", () => {
    expect(phrases("auto-fix")).toContain("this is broken");
    expect(phrases("do-ship")).not.toContain("release");
    expect(phrases("auto-graph")).not.toContain("graphify");
  });

  test("a slash form that is not a skill directory is routed; a real skill name is not", () => {
    expect(phrases("do-learn")).toContain("/devops-learn");
    expect(phrases("do-learn")).not.toContain("/do-learn");
    expect(phrases("do-run")).toContain("/run-burn");
  });

  test("dedicated-hook skills never enter the corpus — do-ship not even with its promote mode", () => {
    for (const s of ["do-batch", "claude-strict", "do-ship"]) {
      expect(corpus.some((e) => e.skill === s)).toBe(false);
    }
  });

  test("a folded mode's phrase carries the mode", () => {
    expect(corpus.find((e) => e.phrase === "backlog runner")).toMatchObject({ skill: "do-run", mode: "backlog" });
    expect(corpus.find((e) => e.phrase === "festgefahren")).toMatchObject({ skill: "do-run", mode: "rethink" });
  });

  test("a CJK phrase of 3+ characters counts as a phrase", () => {
    expect(phrases("do-learn")).toContain("学习这个");
  });

  test("generic consumer-project phrases are denied for the router only", () => {
    const c = buildWordTriggerCorpus(REAL_SKILLS);
    const p = (skill) => c.filter((e) => e.skill === skill).map((e) => e.phrase.toLowerCase());
    for (const x of ["update plugin", "plugin updaten", "self update"]) expect(p("auto-update")).not.toContain(x);
    expect(p("setup-readme")).not.toContain("update the readme");
    expect(p("auto-concept")).not.toContain("visualize this");
    expect(p("auto-guide")).not.toContain("guide me through");
    // the frontmatter itself keeps them (trigger preservation)
    const fm = (skill) => Object.values(REAL_SKILLS[skill].triggers).flat().map((x) => x.toLowerCase());
    expect(fm("auto-update")).toEqual(expect.arrayContaining(["update plugin", "plugin updaten", "self update"]));
    expect(fm("setup-readme")).toContain("update the readme");
    expect(fm("auto-concept")).toContain("visualize this");
    expect(fm("auto-guide")).toContain("guide me through");
  });

  test("denylist phrases all exist in the real frontmatter (no dead entries)", () => {
    for (const [skill, phrases] of Object.entries(PHRASE_DENYLIST)) {
      const all = Object.values(REAL_SKILLS[skill].triggers).flat().map((p) => p.toLowerCase());
      for (const w of phrases) expect(all).toContain(w);
    }
  });

  test("allowlist words all exist in the real frontmatter (no dead entries)", () => {
    for (const [skill, words] of Object.entries(SINGLE_WORD_ALLOWLIST)) {
      const all = Object.values(REAL_SKILLS[skill].triggers).flat().map((p) => p.toLowerCase());
      for (const w of words) expect(all).toContain(w);
    }
  });
});

describe("matchWordTriggers", () => {
  const corpus = buildWordTriggerCorpus(skillSet());

  test("German multi-word phrase matches", () => {
    expect(matchWordTriggers("das funktioniert nicht mehr", corpus)).toEqual([
      { skill: "auto-fix", phrase: "funktioniert nicht" },
    ]);
  });

  test("apostrophe phrase matches (doesn't work)", () => {
    expect(matchWordTriggers("the login doesn't work since yesterday", corpus)).toEqual([
      { skill: "auto-fix", phrase: "doesn't work" },
    ]);
  });

  test("a quoted multi-word phrase is suppressed too", () => {
    expect(matchWordTriggers('she typed "this is broken" in chat', corpus)).toEqual([]);
  });

  test("umlaut allowlisted word matches as a standalone token", () => {
    expect(matchWordTriggers("wir sollten das jetzt härten", corpus)).toEqual([
      { skill: "auto-harden", phrase: "härten" },
    ]);
  });

  test("identifier/path glue blocks a match", () => {
    expect(matchWordTriggers("see HÄRTEN_FLAG and docs/feinschliff.md", corpus)).toEqual([]);
  });

  test("sentence punctuation does not block a match", () => {
    expect(matchWordTriggers("Zeit für Feinschliff.", corpus)).toEqual([
      { skill: "auto-polish", phrase: "feinschliff" },
    ]);
  });

  test("CJK phrase matches via substring", () => {
    const r = matchWordTriggers("请帮我学习这个东西", corpus);
    expect(r.some((m) => m.skill === "do-learn")).toBe(true);
  });
});

describe("looksLikeBugReport — error-pattern routing", () => {
  test("JS stack frame routes to fix", () => {
    expect(looksLikeBugReport("it crashes:\nat handleClick (App.tsx:42:11)")).toBe(true);
  });

  test("Python traceback routes to fix", () => {
    const msg = 'Traceback (most recent call last):\n  File "app.py", line 10, in <module>';
    expect(looksLikeBugReport(msg)).toBe(true);
  });

  test("named Error/Exception class routes to fix", () => {
    expect(looksLikeBugReport("Uncaught TypeError: cannot read properties of undefined")).toBe(true);
    expect(looksLikeBugReport("caused by: NullPointerException: foo")).toBe(true);
  });

  test("HTTP 4xx/5xx needs an HTTP context word, an error word AND a bug phrase", () => {
    expect(looksLikeBugReport("the API responds with HTTP 503 error on every call, login is broken")).toBe(true);
    expect(looksLikeBugReport("POST /login returns 401 unauthorized, geht nicht")).toBe(true);
    expect(looksLikeBugReport("the API returns 503 error on every request, broken")).toBe(false);
    // R6: no bug phrase → no route, however HTTP-ish
    expect(looksLikeBugReport("the API responds with HTTP 503 error on every call")).toBe(false);
    expect(looksLikeBugReport("POST /login returns 401 unauthorized")).toBe(false);
  });

  test.each([
    ["feature request with a status (de)", "Bei GET auf eine unbekannte Route soll 404 not found kommen"],
    ["retry spec with a status", "retry when the request failed with status 503"],
    ["fenced code with a bare Error class + refactor", "refactor this\n```py\ntry:\n    load()\nexcept ValueError:\n    pass\n```"],
    ["fenced HTTP handling code", "clean this up\n```js\nif (res.status === 500) throw new Error('failed')\n```"],
  ])("R6 negative: %s → no fix route", (_name, msg) => {
    expect(looksLikeBugReport(msg)).toBe(false);
  });

  test("a stack frame inside a fence still routes", () => {
    expect(looksLikeBugReport("```\nTypeError: x\n    at f (a.js:1:2)\n```")).toBe(true);
  });

  test("an issue/PR number is not an HTTP status", () => {
    expect(looksLikeBugReport("PR #471 failed CI")).toBe(false);
    expect(looksLikeBugReport("issue #404 status: failed")).toBe(false);
  });

  test("bare HTTP status without an error word does not route", () => {
    expect(looksLikeBugReport("the endpoint returns status 201 on success")).toBe(false);
  });

  test("a question about an error class does not route", () => {
    expect(looksLikeBugReport("what does TypeError mean?")).toBe(false);
    expect(looksLikeBugReport("why does NullPointerException exist as a concept in Java?")).toBe(false);
  });

  test("a question in the prose around a pasted trace does not route …", () => {
    const msg = "kannst du mir erklären, was hier passiert?\n```\nTypeError: x is undefined\n    at f (a.js:1:2)\n```";
    expect(looksLikeBugReport(msg)).toBe(false);
  });

  test("… unless the prose also carries a bug phrase", () => {
    const msg = "warum crasht das?\n```\nTypeError: x is undefined\n    at f (a.js:1:2)\n```";
    expect(looksLikeBugReport(msg)).toBe(true);
  });

  test("a `?` inside a URL is not a question", () => {
    expect(looksLikeBugReport("GET /api?x=1 gives HTTP 500 error, broken since today")).toBe(true);
  });
});

describe("capAndDedupe", () => {
  test("dedupes by skill, first occurrence wins", () => {
    const entries = [
      { skill: "auto-fix", reason: "a" },
      { skill: "auto-fix", reason: "b" },
      { skill: "auto-concept", reason: "c" },
    ];
    expect(capAndDedupe(entries)).toEqual([
      { skill: "auto-fix", reason: "a" },
      { skill: "auto-concept", reason: "c" },
    ]);
  });

  test("caps the list to the given size", () => {
    const entries = ["a", "b", "c", "d", "e"].map((skill) => ({ skill, reason: "x" }));
    expect(capAndDedupe(entries, 3)).toHaveLength(3);
  });
});

describe("routeMessage — combined router", () => {
  test("alias + phrase for the same skill are deduped; the alias is marked explicit", () => {
    const out = routeMessage("/tune-polish und danach feinschliff", skillSet());
    expect(out.filter((e) => e.skill === "auto-polish")).toEqual([
      { skill: "auto-polish", reason: "alias /tune-polish", explicit: true },
    ]);
  });

  test("a folded alias and a folded phrase carry their mode", () => {
    expect(routeMessage("bitte /run-backlog", skillSet())).toEqual([
      { skill: "do-run", reason: "alias /run-backlog (mode backlog)", explicit: true, mode: "backlog" },
    ]);
    expect(routeMessage("ich bin festgefahren", skillSet())).toEqual([
      { skill: "do-run", reason: 'trigger phrase "festgefahren" (mode rethink)', phrase: true, mode: "rethink" },
    ]);
    // promote phrases are prompt.ship.detect's (HOOK_OWNED_MODES)
    expect(routeMessage("jetzt promote to beta bitte", skillSet())).toEqual([]);
  });

  test("error pattern only fires when 'auto-fix' exists in the skill set", () => {
    const out = routeMessage("Traceback (most recent call last):", skillSet({ "auto-fix": undefined }));
    expect(out.some((e) => e.skill === "auto-fix")).toBe(false);
  });

  test("empty / non-string message routes nothing", () => {
    expect(routeMessage("", skillSet())).toEqual([]);
    expect(routeMessage(null, skillSet())).toEqual([]);
  });

  test("null skills map routes nothing and does not throw", () => {
    expect(routeMessage("ich bin festgefahren", null)).toEqual([]);
  });
});

// The user's own style and the red-team list: none of these may force a
// mandatory skill load through the router.
const NEGATIVE_PROMPTS = [
  "ship",
  // promote is do-ship's target channel — prompt.ship.detect owns these
  "promote to stable bitte",
  "jetzt /promote",
  "auf stable heben",
  "weiter",
  "fix auch X und dann ship",
  "merge main hierrein",
  "und dann ship!",
  "prüf alles nochmal",
  "check ob es fehler gibt, fix diese",
  "add error handling to the parser",
  "remove the debug logs before merging",
  "npm audit shows 3 vulnerabilities",
  "the promotion banner is misaligned",
  "the spinner is stuck on mobile",
  "lade die neue Version der Datei hoch",
  "polish language support fehlt noch",
  "rethink the naming later",
  "PR #471 failed CI",
  "make the TS config strict",
  "graphify the repo later",
  "release notes are missing",
  "that's a new issue after the merge",
  "keep the token budget low",
  "use agents for this",
  "open docs/concept-page.md",
  "AUTONOMOUS_RESUME: continue the run",
  // R1: bare "concept" in everyday talk
  "concept A passt",
  "der concept skill schreibt den port zu spät",
  "im concept fehlt X",
  // R2 denylist mirrors
  "das ist ein neues Issue nach dem Merge",
  "lint und fix, dann ship",
  // R6
  "Bei GET auf eine unbekannte Route soll 404 not found kommen",
  "retry when the request failed with status 503",
  "fix den error und dann ship",
  "mach weiter und push das",
  "kurz: crash beim Start, schau mal",
  "can you debug this quickly and ship",
  // generic consumer-project phrases (router-only denylist)
  "update plugin settings for eslint",
  "das vite plugin updaten",
  "implement X and update the readme",
  "visualize this as a bar chart",
  "guide me through this code",
];

describe("routeMessage — negative table (real skill set)", () => {
  test.each(NEGATIVE_PROMPTS)("%s → no mandatory load", (prompt) => {
    expect(routedSkills(prompt)).toEqual([]);
  });
});

const POSITIVE_PROMPTS = [
  ["mach mir dazu ein concept", "auto-concept"],
  ["ich bin festgefahren", "do-run"],
  ["wir drehen uns im Kreis", "do-run"],
  ["kannst du das härten", "auto-harden"],
  ["Zeit für Feinschliff", "auto-polish"],
  ["bitte einmal auditieren", "do-run"],
  ["arbeite den backlog ab", "do-run"],
  ["der button funktioniert nicht", "auto-fix"],
  ["TypeError: Cannot read properties of undefined (reading 'map')\n    at Foo (bar.js:12:5)\ngeht nicht", "auto-fix"],
  ["Traceback (most recent call last):\n  File \"app.py\", line 3, in <module>\ncrash beim Start", "auto-fix"],
  ["mach das mit /claude-learn", "do-learn"],
  ["/devops-learn remember the port", "do-learn"],
  ["bitte /fix", "auto-fix"],
  ["und dann /run-backlog", "do-run"],
  ["führe mich durch das Supabase Setup", "auto-guide"],
  ["show me this as a page", "auto-concept"],
  ["kannst du das als concept aufbereiten", "auto-concept"],
  ["ein concept für die neue Navigation bitte", "auto-concept"],
  ["bau mir eine concept-seite dazu", "auto-concept"],
];

describe("routeMessage — positive table (real skill set)", () => {
  test.each(POSITIVE_PROMPTS)("%s → %s", (prompt, skill) => {
    expect(routedSkills(prompt)).toContain(skill);
  });
});

describe("routeMessage — meta-word proximity (R2)", () => {
  const byskill = (msg) => Object.fromEntries(routeMessage(msg, REAL_SKILLS).map((e) => [e.skill, e]));

  test("a meta word next to the phrase marks the entry nearMeta", () => {
    expect(byskill("der web guide hint nervt")["auto-guide"]).toMatchObject({ phrase: true, nearMeta: true });
    expect(byskill("the backlog runner hook parks too early")["do-run"]).toMatchObject({ nearMeta: true });
  });

  test("no meta word nearby → a plain phrase entry", () => {
    const e = byskill("bitte arbeite den backlog ab")["do-run"];
    expect(e).toMatchObject({ phrase: true });
    expect(e.nearMeta).toBeUndefined();
  });

  test("a meta word further than the window away does not count", () => {
    const e = byskill("skill eins zwei drei vier ich bin festgefahren")["do-run"];
    expect(e.nearMeta).toBeUndefined();
  });

  test("alias and error-pattern entries never carry phrase/nearMeta", () => {
    const out = routeMessage("/fix the fix hook\nTypeError: x\n  at f (a.js:1:2)", REAL_SKILLS);
    for (const e of out) expect(e.phrase).toBeUndefined();
  });
});

describe("routeMessage — latency", () => {
  test("routing one prompt against the real skill set stays well under 10 ms", () => {
    const msg = "kannst du das bitte polish machen und dann ship, error in foo — ich bin festgefahren";
    routeMessage(msg, REAL_SKILLS); // warm-up
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 50; i++) routeMessage(msg, REAL_SKILLS);
    const perCallMs = Number(process.hrtime.bigint() - t0) / 1e6 / 50;
    expect(perCallMs).toBeLessThan(10);
  });
});
