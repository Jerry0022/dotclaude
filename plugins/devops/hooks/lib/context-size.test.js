import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contextOfUsage, contextFromTranscriptText, currentContextTokens, formatTokens, TAIL_BYTES } from "./context-size.js";

const asst = (usage, extra = {}) => JSON.stringify({ type: "assistant", timestamp: "2026-09-21T00:00:00Z", message: { id: "m", usage }, ...extra });
const user = () => JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "x".repeat(50) }] } });

describe("context-size", () => {
  test("context of a call = input + cache read + cache creation, never output", () => {
    expect(contextOfUsage({ input_tokens: 2, cache_read_input_tokens: 400_000, cache_creation_input_tokens: 1_000, output_tokens: 9_999 })).toBe(401_002);
    expect(contextOfUsage(null)).toBe(0);
    expect(contextOfUsage({})).toBe(0);
  });

  test("newest assistant line wins, tool results and sidechains are skipped", () => {
    const text = [
      asst({ cache_read_input_tokens: 100_000 }),
      user(),
      asst({ cache_read_input_tokens: 200_000 }),
      user(),
      asst({ cache_read_input_tokens: 999_999 }, { isSidechain: true }),
      user(),
    ].join("\n") + "\n";
    expect(contextFromTranscriptText(text)).toBe(200_000);
  });

  test("a truncated first line (tail slice) is tolerated", () => {
    const text = asst({ cache_read_input_tokens: 300_000 }).slice(40) + "\n" + user() + "\n" + asst({ cache_read_input_tokens: 310_000 }) + "\n";
    expect(contextFromTranscriptText(text)).toBe(310_000);
    const onlyBroken = asst({ cache_read_input_tokens: 300_000 }).slice(40) + "\n" + user() + "\n";
    expect(contextFromTranscriptText(onlyBroken)).toBeNull();
  });

  test("empty or unusable input is unknown (null), never zero", () => {
    expect(contextFromTranscriptText("")).toBeNull();
    expect(contextFromTranscriptText(user() + "\n")).toBeNull();
    expect(currentContextTokens("")).toBeNull();
    expect(currentContextTokens(path.join(os.tmpdir(), "does-not-exist-" + Date.now() + ".jsonl"))).toBeNull();
  });

  test("reads only the tail of a large transcript", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-size-"));
    const file = path.join(dir, "t.jsonl");
    const filler = user() + "\n";
    const head = asst({ cache_read_input_tokens: 50_000 }) + "\n";
    const tail = asst({ cache_read_input_tokens: 420_000 }) + "\n";
    // enough filler that the head line is well outside the tail window
    const middle = filler.repeat(Math.ceil((TAIL_BYTES * 2) / filler.length));
    fs.writeFileSync(file, head + middle + tail);
    expect(currentContextTokens(file)).toBe(420_000);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("formatTokens rounds to thousands", () => {
    expect(formatTokens(433_545)).toBe("434 k");
    expect(formatTokens(null)).toBe("?");
  });
});
