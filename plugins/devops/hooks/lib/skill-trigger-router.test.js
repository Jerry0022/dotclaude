import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  ALIAS_MAP,
  SINGLE_WORD_ALLOWLIST,
  PHRASE_DENYLIST,
  detectAliasMentions,
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
    fix: { name: "fix", triggers: { en: ["error", "crash", "this is broken", "doesn't work"], de: ["funktioniert nicht"] } },
    ship: { name: "ship", triggers: { en: ["ship it", "push and merge"] } },
    promote: { name: "promote", triggers: { en: ["release", "promote", "promotion", "promote to beta"] } },
    "claude-batch": { name: "claude-batch", triggers: { en: ["batch mode"], de: ["sammelmodus"] } },
    "claude-strict": { name: "claude-strict", triggers: { en: ["strict"], de: ["strikt"] } },
    "tune-polish": { name: "tune-polish", triggers: { en: ["polish", "design pass"], de: ["feinschliff"] } },
    "tune-harden": { name: "tune-harden", triggers: { de: ["härten"] } },
    "run-burn": { name: "run-burn", triggers: { en: ["/run-burn"] } },
    "auto-graph": { name: "auto-graph", triggers: { en: ["knowledge graph", "graphify"] } },
    "web-guide": { name: "web-guide", triggers: { en: ["guide me through"], de: ["führe mich durch"] } },
    "claude-learn": { name: "claude-learn", triggers: { en: ["capture learning", "/devops-learn", "/claude-learn"], de: ["lerne das", "学习这个"] } },
    ...overrides,
  };
}

const routedSkills = (msg) => routeMessage(msg, REAL_SKILLS).map((e) => e.skill);

describe("ALIAS_MAP", () => {
  test("maps every PR-2 rename with a 1:1 current equivalent", () => {
    expect(ALIAS_MAP["do-ship"]).toBe("ship");
    expect(ALIAS_MAP["do-learn"]).toBe("claude-learn");
    expect(ALIAS_MAP["do-batch"]).toBe("claude-batch");
    expect(ALIAS_MAP["auto-concept"]).toBe("concept");
    expect(ALIAS_MAP["auto-fix"]).toBe("fix");
    expect(ALIAS_MAP["auto-issue"]).toBe("setup-issue");
    expect(ALIAS_MAP["auto-polish"]).toBe("tune-polish");
    expect(ALIAS_MAP["auto-harden"]).toBe("tune-harden");
    expect(ALIAS_MAP["auto-guide"]).toBe("web-guide");
    expect(ALIAS_MAP["auto-extend"]).toBe("claude-extend-skill");
    expect(ALIAS_MAP["auto-update"]).toBe("auto-update");
  });

  test("names without a 1:1 current equivalent are absent (do-run, auto-agents)", () => {
    expect(ALIAS_MAP["do-run"]).toBeUndefined();
    expect(ALIAS_MAP["auto-agents"]).toBeUndefined();
  });
});

describe("detectAliasMentions", () => {
  test("/do-learn maps to claude-learn", () => {
    expect(detectAliasMentions("bitte /do-learn das hier")).toEqual(["claude-learn"]);
  });

  test("aliases of skills owned by a dedicated hook emit nothing (do-ship, do-batch)", () => {
    expect(detectAliasMentions("bitte /do-ship jetzt")).toEqual([]);
    expect(detectAliasMentions("/do-batch an")).toEqual([]);
  });

  test("dedupes and keeps order of first appearance", () => {
    expect(detectAliasMentions("/auto-fix dann /auto-fix nochmal, danach /auto-polish")).toEqual([
      "fix",
      "tune-polish",
    ]);
  });

  test("an alias inside code or quotes is not a mention", () => {
    expect(detectAliasMentions("the hook says `/auto-fix` there")).toEqual([]);
    expect(detectAliasMentions('the doc names "/auto-fix" as the new name')).toEqual([]);
    expect(detectAliasMentions("```\n/auto-fix\n```")).toEqual([]);
  });

  test("unknown alias is ignored", () => {
    expect(detectAliasMentions("/do-run bitte")).toEqual([]);
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
    expect(phrases("fix")).not.toContain("error");
    expect(phrases("fix")).not.toContain("crash");
    expect(phrases("tune-polish")).not.toContain("polish");
    expect(phrases("promote")).not.toContain("promote");
    expect(phrases("promote")).not.toContain("promotion");
  });

  test("allowlisted single words are routed", () => {
    expect(phrases("tune-polish")).toContain("feinschliff");
    expect(phrases("tune-harden")).toContain("härten");
  });

  test("bare 'concept' is not routed; the router-only verb-object phrases are (R1)", () => {
    const c = buildWordTriggerCorpus({ concept: { name: "concept", triggers: { en: ["concept", "concept page"] } } });
    const p = c.map((e) => e.phrase);
    expect(p).not.toContain("concept");
    expect(p).toContain("concept page");
    expect(p).toEqual(expect.arrayContaining(["ein concept", "concept für", "als concept", "concept-seite"]));
  });

  test("multi-word phrases are routed; denylisted ones are not", () => {
    expect(phrases("fix")).toContain("this is broken");
    expect(phrases("promote")).toContain("promote to beta");
    expect(phrases("promote")).not.toContain("release");
    expect(phrases("auto-graph")).not.toContain("graphify");
  });

  test("a slash form that is not a skill directory is routed; a real skill name is not", () => {
    expect(phrases("claude-learn")).toContain("/devops-learn");
    expect(phrases("claude-learn")).not.toContain("/claude-learn");
    expect(phrases("run-burn")).toEqual([]);
  });

  test("dedicated-hook skills never enter the corpus", () => {
    for (const s of ["ship", "claude-batch", "claude-strict"]) {
      expect(corpus.some((e) => e.skill === s)).toBe(false);
    }
  });

  test("a CJK phrase of 3+ characters counts as a phrase", () => {
    expect(phrases("claude-learn")).toContain("学习这个");
  });

  test("generic consumer-project phrases are denied for the router only", () => {
    const c = buildWordTriggerCorpus(REAL_SKILLS);
    const p = (skill) => c.filter((e) => e.skill === skill).map((e) => e.phrase.toLowerCase());
    for (const x of ["update plugin", "plugin updaten", "self update"]) expect(p("auto-update")).not.toContain(x);
    expect(p("setup-readme")).not.toContain("update the readme");
    expect(p("concept")).not.toContain("visualize this");
    expect(p("web-guide")).not.toContain("guide me through");
    // the frontmatter itself keeps them (trigger preservation)
    const fm = (skill) => Object.values(REAL_SKILLS[skill].triggers).flat().map((x) => x.toLowerCase());
    expect(fm("auto-update")).toEqual(expect.arrayContaining(["update plugin", "plugin updaten", "self update"]));
    expect(fm("setup-readme")).toContain("update the readme");
    expect(fm("concept")).toContain("visualize this");
    expect(fm("web-guide")).toContain("guide me through");
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
      { skill: "fix", phrase: "funktioniert nicht" },
    ]);
  });

  test("apostrophe phrase matches (doesn't work)", () => {
    expect(matchWordTriggers("the login doesn't work since yesterday", corpus)).toEqual([
      { skill: "fix", phrase: "doesn't work" },
    ]);
  });

  test("a quoted multi-word phrase is suppressed too", () => {
    expect(matchWordTriggers('she typed "this is broken" in chat', corpus)).toEqual([]);
  });

  test("umlaut allowlisted word matches as a standalone token", () => {
    expect(matchWordTriggers("wir sollten das jetzt härten", corpus)).toEqual([
      { skill: "tune-harden", phrase: "härten" },
    ]);
  });

  test("identifier/path glue blocks a match", () => {
    expect(matchWordTriggers("see HÄRTEN_FLAG and docs/feinschliff.md", corpus)).toEqual([]);
  });

  test("sentence punctuation does not block a match", () => {
    expect(matchWordTriggers("Zeit für Feinschliff.", corpus)).toEqual([
      { skill: "tune-polish", phrase: "feinschliff" },
    ]);
  });

  test("CJK phrase matches via substring", () => {
    const r = matchWordTriggers("请帮我学习这个东西", corpus);
    expect(r.some((m) => m.skill === "claude-learn")).toBe(true);
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
      { skill: "fix", reason: "a" },
      { skill: "fix", reason: "b" },
      { skill: "concept", reason: "c" },
    ];
    expect(capAndDedupe(entries)).toEqual([
      { skill: "fix", reason: "a" },
      { skill: "concept", reason: "c" },
    ]);
  });

  test("caps the list to the given size", () => {
    const entries = ["a", "b", "c", "d", "e"].map((skill) => ({ skill, reason: "x" }));
    expect(capAndDedupe(entries, 3)).toHaveLength(3);
  });
});

describe("routeMessage — combined router", () => {
  test("alias + phrase for the same skill are deduped; the alias is marked explicit", () => {
    const out = routeMessage("/auto-polish und danach feinschliff", skillSet());
    expect(out.filter((e) => e.skill === "tune-polish")).toEqual([
      { skill: "tune-polish", reason: "alias mention", explicit: true },
    ]);
  });

  test("error pattern only fires when 'fix' exists in the skill set", () => {
    const out = routeMessage("Traceback (most recent call last):", skillSet({ fix: undefined }));
    expect(out.some((e) => e.skill === "fix")).toBe(false);
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
  ["mach mir dazu ein concept", "concept"],
  ["ich bin festgefahren", "tune-rethink"],
  ["wir drehen uns im Kreis", "tune-rethink"],
  ["kannst du das härten", "tune-harden"],
  ["Zeit für Feinschliff", "tune-polish"],
  ["bitte einmal auditieren", "tune-audit"],
  ["der button funktioniert nicht", "fix"],
  ["TypeError: Cannot read properties of undefined (reading 'map')\n    at Foo (bar.js:12:5)\ngeht nicht", "fix"],
  ["Traceback (most recent call last):\n  File \"app.py\", line 3, in <module>\ncrash beim Start", "fix"],
  ["/do-learn das hier", "claude-learn"],
  ["/devops-learn remember the port", "claude-learn"],
  ["/auto-fix bitte", "fix"],
  ["führe mich durch das Supabase Setup", "web-guide"],
  ["show me this as a page", "concept"],
  ["kannst du das als concept aufbereiten", "concept"],
  ["ein concept für die neue Navigation bitte", "concept"],
  ["bau mir eine concept-seite dazu", "concept"],
];

describe("routeMessage — positive table (real skill set)", () => {
  test.each(POSITIVE_PROMPTS)("%s → %s", (prompt, skill) => {
    expect(routedSkills(prompt)).toContain(skill);
  });
});

describe("routeMessage — meta-word proximity (R2)", () => {
  const byskill = (msg) => Object.fromEntries(routeMessage(msg, REAL_SKILLS).map((e) => [e.skill, e]));

  test("a meta word next to the phrase marks the entry nearMeta", () => {
    expect(byskill("der web guide hint nervt")["web-guide"]).toMatchObject({ phrase: true, nearMeta: true });
    expect(byskill("the backlog runner hook parks too early")["run-backlog"]).toMatchObject({ nearMeta: true });
  });

  test("no meta word nearby → a plain phrase entry", () => {
    const e = byskill("bitte arbeite den backlog ab")["run-backlog"];
    expect(e).toMatchObject({ phrase: true });
    expect(e.nearMeta).toBeUndefined();
  });

  test("a meta word further than the window away does not count", () => {
    const e = byskill("skill eins zwei drei vier ich bin festgefahren")["tune-rethink"];
    expect(e.nearMeta).toBeUndefined();
  });

  test("alias and error-pattern entries never carry phrase/nearMeta", () => {
    const out = routeMessage("/auto-fix the fix hook\nTypeError: x\n  at f (a.js:1:2)", REAL_SKILLS);
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
