import { describe, test, expect } from "vitest";
import { GIT_TIMEOUT_MS, gitBudget } from "./git-timeout.js";

describe("GIT_TIMEOUT_MS", () => {
  test("is a single positive number, the one per-call timeout", () => {
    expect(typeof GIT_TIMEOUT_MS).toBe("number");
    expect(GIT_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe("gitBudget", () => {
  test("timeout() starts at min(totalMs, GIT_TIMEOUT_MS)", () => {
    const b = gitBudget(2000);
    expect(b.timeout()).toBeLessThanOrEqual(2000);
    expect(b.timeout()).toBeGreaterThan(0);
  });

  test("a totalMs above GIT_TIMEOUT_MS is clamped to GIT_TIMEOUT_MS", () => {
    const b = gitBudget(GIT_TIMEOUT_MS * 10);
    expect(b.timeout()).toBeLessThanOrEqual(GIT_TIMEOUT_MS);
  });

  test("defaults to GIT_TIMEOUT_MS when called with no argument", () => {
    const b = gitBudget();
    expect(b.timeout()).toBeLessThanOrEqual(GIT_TIMEOUT_MS);
    expect(b.timeout()).toBeGreaterThan(0);
  });

  test("timeout() never drops to 0 or below, even once the deadline has passed", () => {
    const b = gitBudget(0);
    expect(b.expired()).toBe(true);
    expect(b.timeout()).toBeGreaterThanOrEqual(1);
  });

  test("a negative totalMs is treated as an already-expired, zero-length budget", () => {
    const b = gitBudget(-500);
    expect(b.expired()).toBe(true);
    expect(b.timeout()).toBeGreaterThanOrEqual(1);
  });

  test("expired() is false while time remains, true once the deadline passes", async () => {
    const b = gitBudget(30);
    expect(b.expired()).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    expect(b.expired()).toBe(true);
  });

  test("timeout() shrinks as the budget is consumed, bounding a CHAIN of calls (AUD-031)", async () => {
    const b = gitBudget(200);
    const first = b.timeout();
    await new Promise((r) => setTimeout(r, 60));
    const second = b.timeout();
    expect(second).toBeLessThan(first);
    expect(second).toBeGreaterThan(0);
  });

  test("two independent budgets do not share state", () => {
    const a = gitBudget(50);
    const b = gitBudget(GIT_TIMEOUT_MS * 5);
    expect(a.timeout()).toBeLessThanOrEqual(50);
    expect(b.timeout()).toBeLessThanOrEqual(GIT_TIMEOUT_MS);
  });
});
