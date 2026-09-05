import { describe, it, expect } from "vitest";
import {
  normalizePending, hasPending, pendingWhat, renderPendingBlock,
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

  it("drops unusable entries rather than throwing", () => {
    expect(normalizePending([null, "", { }, 42, { name: "  " }])).toEqual([]);
  });

  it("returns [] for a non-array", () => {
    expect(normalizePending(undefined)).toEqual([]);
    expect(normalizePending("devops:qa")).toEqual([]);
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

  it("names both agents with the count when there are two", () => {
    expect(pendingWhat(["devops:frontend", "devops:qa"], "de"))
      .toBe("2 Agenten (`devops:frontend`, `devops:qa`) arbeiten");
  });

  it("caps the names and reports the rest as +N", () => {
    expect(pendingWhat(["a", "b", "c", "d"], "de")).toBe("4 Agenten (`a`, `b`, +2) arbeiten");
  });

  it("uses task wording for backgrounded tasks", () => {
    expect(pendingWhat([{ name: "npm test", kind: "task" }], "de")).toBe("Task `npm test` läuft");
    expect(pendingWhat([{ name: "npm test", kind: "task" }], "en")).toBe("task `npm test` is running");
  });

  it("leads with the named agents when agents and tasks are mixed", () => {
    expect(pendingWhat([{ name: "devops:qa" }, { name: "npm test", kind: "task" }], "de"))
      .toBe("Agent `devops:qa` + 1 Task laufen");
    expect(pendingWhat([{ name: "a" }, { name: "b" }, { name: "t", kind: "task" }], "de"))
      .toBe("2 Agenten (`a`, `b`) + 1 Task laufen");
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

describe("renderPendingBlock", () => {
  it("renders one bullet per item with its work description", () => {
    const block = renderPendingBlock(
      [{ name: "devops:frontend", doing: "Farbstil auf Tokens umstellen" }], "de",
    );
    expect(block).toContain("⏳ **LÄUFT NOCH — nicht abgeschlossen:**");
    expect(block).toContain("* `devops:frontend` — Farbstil auf Tokens umstellen");
  });

  it("states that the card predates those results", () => {
    expect(renderPendingBlock(["a"], "de")).toContain("_Diese Card berichtet den Stand VOR diesen Ergebnissen._");
    expect(renderPendingBlock(["a"], "en")).toContain("_This card reports the state BEFORE those results._");
  });

  it("caps the bullets and reports the remainder", () => {
    const block = renderPendingBlock(["a", "b", "c", "d", "e", "f"], "de");
    expect(block).toContain("* +2");
    expect(block.split("\n").filter(l => l.startsWith("* ")).length).toBe(5);
  });

  it("is empty when nothing is pending", () => {
    expect(renderPendingBlock([], "de")).toBe("");
    expect(renderPendingBlock(undefined, "de")).toBe("");
  });
});
