import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { renderAgentCard, parseWave } = require("./agent-card.js");

const core = { type: "devops:core", description: "Engine", model: "sonnet", effort: "medium" };
const redteam = { type: "devops:redteam", description: "Gate", model: "opus", effort: "high" };
const rows = (card) => card.split("\n").filter((l) => /^\| \S+ \| \*\*/.test(l));

describe("agent card — one template for one agent or many", () => {
  test("one agent: header, newest note once, one table row, no tally", () => {
    const card = renderAgentCard({ lang: "de", agents: [redteam] });
    expect(card.split("\n")[0]).toBe("---");
    expect(card).toContain("### 🤖 **1 Agent gestartet** · Hintergrund");
    expect(card.match(/neueste Version/g)).toHaveLength(1);
    expect(rows(card)).toEqual(["| 🛡️ | **redteam** | Gate | opus | ●●● high |"]);
    expect(card).not.toContain("Σ");
    expect(card.trimEnd().endsWith("---")).toBe(true);
  });

  test("three agents: same shape, more rows, tally because a combination repeats", () => {
    const card = renderAgentCard({ lang: "en", agents: [core, { ...core, type: "devops:frontend" }, redteam] });
    expect(card).toContain("### 🤖 **3 agents started** · background");
    expect(rows(card)).toHaveLength(3);
    expect(card).toContain("**Σ Mix:** **2×** sonnet ●● medium  ·  **1×** opus ●●● high");
    for (const row of rows(card)) expect(row).not.toMatch(/newest/);
  });

  test("effort is one filled dot per level, never a hollow one — higher levels just add dots", () => {
    const levels = ["low", "medium", "high", "xhigh", "max", "ultracode"];
    const card = renderAgentCard({ agents: levels.map((effort) => ({ ...core, effort })) });
    const efforts = rows(card).map((r) => r.split("|").slice(1, -1).map((c) => c.trim())[4]);
    expect(efforts).toEqual(["● low", "●● medium", "●●● high", "●●●● xhigh", "●●●●● max", "●●●●●● ultracode"]);
    expect(card).not.toMatch(/[○◯+]/);
  });

  test("no tally when every model · effort combination is unique", () => {
    const card = renderAgentCard({ agents: [core, redteam] });
    expect(card).not.toContain("Σ");
  });

  test("waves become sections, ordered numerically, when a card spans several", () => {
    const card = renderAgentCard({
      kind: "plan", lang: "de", tier: "volle Zeremonie",
      agents: [
        { ...core, wave: 2 }, { ...redteam, wave: 1.5 }, { ...core, wave: 1 }, { ...core, wave: 10 },
      ],
    });
    expect(card).toContain("### 🗺️ **Agent-Plan** · 4 Agents · 4 Waves · volle Zeremonie");
    const heads = card.split("\n").filter((l) => l.startsWith("#### "));
    expect(heads).toEqual(["#### Wave 1 · 1 Agent", "#### Wave 1.5 · 1 Agent", "#### Wave 2 · 1 Agent", "#### Wave 10 · 1 Agent"]);
  });

  test("a spawn batch within one wave names it in the header instead of a section", () => {
    const card = renderAgentCard({ agents: [{ ...core, description: "[W2] Engine" }, { ...core, description: "[W2] AI" }] });
    expect(card).toContain("· Wave 2");
    expect(card).not.toContain("#### ");
    expect(rows(card)[0]).toContain("| Engine |");
  });

  test("inherited values are localised and drop the newest note when nothing is an alias", () => {
    const card = renderAgentCard({
      lang: "de",
      agents: [{ type: "Explore", description: "Sweep", model: "opus 5.5 (session)", effort: "session effort" }],
    });
    expect(rows(card)[0]).toBe("| 🔭 | **Explore** | Sweep | opus 5.5 (Session) | ◌ Session |");
    expect(card).not.toContain("neueste Version");
  });

  test("mixed modes are counted in the header; pipes in a task never break the table", () => {
    const card = renderAgentCard({
      lang: "de",
      agents: [{ ...core, description: "a | b" }, { ...redteam, mode: "foreground" }],
    });
    expect(card).toContain("· 1 Hintergrund · 1 Vordergrund");
    expect(rows(card)[0]).toContain("a \\| b");
  });

  test("parseWave only reads the bracket prefix", () => {
    expect(parseWave("[W1.5] Gate")).toEqual({ wave: "1.5", task: "Gate" });
    expect(parseWave("W6 AI server step")).toEqual({ wave: null, task: "W6 AI server step" });
  });
});
