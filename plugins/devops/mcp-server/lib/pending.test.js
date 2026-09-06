import { describe, it, expect } from "vitest";
import {
  normalizePending, hasPending, pendingWhat, renderPendingLine, renderPendingBlock,
  NAME_MAX, normalizeConcept, hasConcept, conceptWhat,
} from "./pending.js";

describe("normalizePending", () => {
  it("accepts bare strings as agents", () => {
    expect(normalizePending(["devops:frontend"]))
      .toEqual([{ kind: "agent", name: "devops:frontend", doing: "" }]);
  });

  it("defaults kind to agent and keeps doing", () => {
    expect(normalizePending([{ name: "qa", doing: "runs the suite" }]))
      .toEqual([{ kind: "agent", name: "qa", doing: "runs the suite" }]);
  });

  it("keeps an explicit task kind", () => {
    expect(normalizePending([{ name: "npm test", kind: "task" }])[0].kind).toBe("task");
  });

  it("keeps an explicit workflow kind", () => {
    expect(normalizePending([{ name: "harden-pass", kind: "workflow" }])[0].kind)
      .toBe("workflow");
  });

  it("falls back to agent for an unknown kind", () => {
    expect(normalizePending([{ name: "x", kind: "teammate" }])[0].kind).toBe("agent");
  });

  it("drops unusable entries rather than throwing", () => {
    expect(normalizePending([null, "", { }, 42, { name: "  " }])).toEqual([]);
  });

  it("returns [] for a non-array", () => {
    expect(normalizePending(undefined)).toEqual([]);
    expect(normalizePending("devops:qa")).toEqual([]);
  });

  it("keeps hyphens and colons — real names are slugs", () => {
    expect(normalizePending([{ name: "verify-geopolitics-spec" }])[0].name)
      .toBe("verify-geopolitics-spec");
    expect(normalizePending(["devops:frontend"])[0].name).toBe("devops:frontend");
  });

  it("strips characters that would break the card's markdown", () => {
    // A name is model-authored text landing inside an inline code span.
    const raw = "a" + String.fromCharCode(96) + "b|c<d>e\nf";
    expect(normalizePending([{ name: raw }])[0].name).toBe("abcde f");
  });

  it("clamps an overlong name so the card line cannot become a wall of text", () => {
    const long = "w".repeat(300);
    expect(normalizePending([{ name: long }])[0].name.length).toBe(NAME_MAX);
  });
});

describe("hasPending", () => {
  it("is false for absent / empty / unusable input", () => {
    expect(hasPending(undefined)).toBe(false);
    expect(hasPending([])).toBe(false);
    expect(hasPending([null, ""])).toBe(false);
  });

  it("is true as soon as one usable item exists", () => {
    expect(hasPending(["devops:frontend"])).toBe(true);
  });
});

describe("pendingWhat — the CTA slot", () => {
  it("names the single agent instead of just counting it", () => {
    expect(pendingWhat(["devops:frontend"], "de")).toBe("Agent `devops:frontend` arbeitet");
    expect(pendingWhat(["devops:frontend"], "en")).toBe("agent `devops:frontend` is working");
  });

  it("names a single workflow with its own noun", () => {
    expect(pendingWhat([{ name: "harden-pass", kind: "workflow" }], "de"))
      .toBe("Workflow `harden-pass` läuft");
    expect(pendingWhat([{ name: "harden-pass", kind: "workflow" }], "en"))
      .toBe("workflow `harden-pass` is running");
  });

  it("counts instead of naming from two items on — the names go on the line", () => {
    expect(pendingWhat(["devops:frontend", "devops:qa"], "de")).toBe("2 Agenten arbeiten");
    expect(pendingWhat(["a", "b", "c", "d"], "de")).toBe("4 Agenten arbeiten");
  });

  it("counts workflows as their own class — a workflow is not one agent", () => {
    expect(pendingWhat([
      { name: "a", kind: "workflow" }, { name: "b", kind: "workflow" },
    ], "de")).toBe("2 Workflows laufen");
    expect(pendingWhat([
      { name: "a", kind: "workflow" }, { name: "b", kind: "workflow" },
    ], "en")).toBe("2 workflows are running");
  });

  it("uses task wording for backgrounded tasks", () => {
    expect(pendingWhat([{ name: "npm test", kind: "task" }], "de")).toBe("Task `npm test` läuft");
    expect(pendingWhat([{ name: "npm test", kind: "task" }], "en")).toBe("task `npm test` is running");
  });

  it("reports mixed work biggest unit first", () => {
    expect(pendingWhat([{ name: "devops:qa" }, { name: "npm test", kind: "task" }], "de"))
      .toBe("1 Agent + 1 Task laufen");
    expect(pendingWhat([
      { name: "wf", kind: "workflow" }, { name: "a" }, { name: "b" },
      { name: "t", kind: "task" },
    ], "de")).toBe("1 Workflow + 2 Agenten + 1 Task laufen");
  });

  it("falls back to a plain count when nothing carries a name", () => {
    expect(pendingWhat([{ doing: "something" }], "de")).toBe("1 Agent arbeitet");
  });

  it("is empty when nothing is pending", () => {
    expect(pendingWhat([], "de")).toBe("");
  });

  it("falls back to German for an unknown language", () => {
    expect(pendingWhat(["x"], "fr")).toBe("Agent `x` arbeitet");
  });
});

describe("renderPendingLine — the dim line next to the CTA", () => {
  it("names the first three, workflows first", () => {
    expect(renderPendingLine([
      { name: "devops:qa" },
      { name: "verify-spec", kind: "workflow" },
      { name: "harden-pass", kind: "workflow" },
    ], "de")).toBe("⏳ `verify-spec`, `harden-pass`, `devops:qa`");
  });

  it("collapses the rest into a +N tail that counts unnamed items too", () => {
    expect(renderPendingLine([
      { name: "a", kind: "workflow" }, { name: "b", kind: "workflow" },
      { name: "c" }, { doing: "unnamed" }, { name: "t", kind: "task" },
    ], "de")).toBe("⏳ `a`, `b`, `c` +2");
  });

  it("is empty for a single item — the CTA already names it", () => {
    expect(renderPendingLine([{ name: "harden-pass", kind: "workflow" }], "de")).toBe("");
    expect(renderPendingLine([], "de")).toBe("");
    expect(renderPendingLine(undefined, "de")).toBe("");
  });

  it("is empty when no item carries a name", () => {
    expect(renderPendingLine([{ doing: "a" }, { doing: "b" }], "de")).toBe("");
  });
});

describe("renderPendingBlock", () => {
  it("renders one bullet per item with its work description", () => {
    const block = renderPendingBlock(
      [{ name: "devops:frontend", doing: "Farbstil auf Tokens umstellen" }], "de",
    );
    expect(block).toContain("⏳ **LÄUFT NOCH — nicht abgeschlossen:**");
    expect(block).toContain("* `devops:frontend` — Farbstil auf Tokens umstellen");
  });

  it("labels a name-less item by its kind", () => {
    expect(renderPendingBlock([{ kind: "workflow", doing: "läuft durch" }], "de"))
      .toContain("* Workflow — läuft durch");
  });

  it("states that the card predates those results", () => {
    expect(renderPendingBlock(["a"], "de")).toContain("_Diese Card berichtet den Stand VOR diesen Ergebnissen._");
    expect(renderPendingBlock(["a"], "en")).toContain("_This card reports the state BEFORE those results._");
  });

  it("caps the bullets at the same three as the line, so the tails agree", () => {
    const items = ["a", "b", "c", "d", "e", "f"];
    const block = renderPendingBlock(items, "de");
    expect(block).toContain("* +3");
    expect(block.split("\n").filter(l => l.startsWith("* ")).length).toBe(4);
    // Both "+N" on the card count the same remainder.
    expect(renderPendingLine(items, "de")).toContain("+3");
  });

  it("is empty when nothing is pending", () => {
    expect(renderPendingBlock([], "de")).toBe("");
    expect(renderPendingBlock(undefined, "de")).toBe("");
  });
});

describe("concept layer", () => {
  it("normalizes a phase string and a { phase } object alike", () => {
    expect(normalizeConcept("implementing")).toEqual({ phase: "implementing" });
    expect(normalizeConcept({ phase: "iterating" })).toEqual({ phase: "iterating" });
    expect(normalizeConcept({ phase: " Waiting " })).toEqual({ phase: "waiting" });
  });

  it("an open concept with an unknown or missing phase defaults to waiting", () => {
    expect(normalizeConcept({})).toEqual({ phase: "waiting" });
    expect(normalizeConcept({ phase: "done" })).toEqual({ phase: "waiting" });
    expect(normalizeConcept(true)).toEqual({ phase: "waiting" });
  });

  it("nothing open → null, and hasConcept follows", () => {
    expect(normalizeConcept(undefined)).toBeNull();
    expect(normalizeConcept(null)).toBeNull();
    expect(normalizeConcept("")).toBeNull();
    expect(hasConcept(undefined)).toBe(false);
    expect(hasConcept("waiting")).toBe(true);
  });

  it("states the phase alone when no content work is running", () => {
    expect(conceptWhat("waiting", [], "de")).toBe("Warte auf deine Entscheidungen auf der Seite");
    expect(conceptWhat("iterating", undefined, "de")).toBe("Arbeite an der nächsten Iteration");
    expect(conceptWhat("implementing", [], "de")).toBe("Arbeite an der Implementierung");
    expect(conceptWhat("implementing", [], "en")).toBe("Working on the implementation");
  });

  it("folds a single content agent into the implementing sentence by name", () => {
    expect(conceptWhat("implementing", [{ name: "devops:frontend" }], "de"))
      .toBe("Arbeite an der Implementierung mit Agent `devops:frontend`");
    expect(conceptWhat("implementing", [{ name: "devops:frontend" }], "en"))
      .toBe("Working on the implementation with agent `devops:frontend`");
  });

  it("folds several items in as counts per class, biggest unit first", () => {
    const mix = [
      { name: "devops:frontend" }, { name: "devops:core" },
      { name: "harden-pass", kind: "workflow" }, { name: "npm test", kind: "task" },
    ];
    expect(conceptWhat("iterating", mix, "de"))
      .toBe("Arbeite an der nächsten Iteration mit 1 Workflow + 2 Agenten + 1 Task");
    expect(conceptWhat("iterating", mix, "en"))
      .toBe("Working on the next iteration with 1 workflow + 2 agents + 1 task");
  });

  it("while waiting, open work is its own clause rather than 'with'", () => {
    expect(conceptWhat("waiting", [{ name: "devops:research" }], "de"))
      .toBe("Warte auf deine Entscheidungen auf der Seite · Agent `devops:research` arbeitet");
  });

  it("returns nothing when no concept is open", () => {
    expect(conceptWhat(undefined, [{ name: "x" }], "de")).toBe("");
  });
});
