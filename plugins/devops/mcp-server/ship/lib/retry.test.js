import { describe, test, expect, vi } from "vitest";
import { backoffMs, sleep, retryUntil } from "./retry.js";

// Deterministic jitter: random() = 0.5 → the multiplier is exactly 1.
const mid = { random: () => 0.5 };

describe("backoffMs", () => {
  test("grows exponentially from the base delay", () => {
    expect(backoffMs(1, { delayMs: 1000, ...mid })).toBe(1000);
    expect(backoffMs(2, { delayMs: 1000, ...mid })).toBe(3000);
    expect(backoffMs(3, { delayMs: 1000, ...mid })).toBe(9000);
  });

  test("honours a custom factor", () => {
    expect(backoffMs(3, { delayMs: 100, factor: 2, ...mid })).toBe(400);
  });

  test("a zero or negative base disables the wait entirely", () => {
    expect(backoffMs(1, { delayMs: 0 })).toBe(0);
    expect(backoffMs(4, { delayMs: 0 })).toBe(0);
    expect(backoffMs(2, { delayMs: -5 })).toBe(0);
  });

  test("jitter stays inside ±10% of the base by default", () => {
    for (const r of [0, 0.25, 0.5, 0.75, 1]) {
      const ms = backoffMs(2, { delayMs: 1000, random: () => r });
      expect(ms).toBeGreaterThanOrEqual(2700);
      expect(ms).toBeLessThanOrEqual(3300);
    }
  });

  test("jitter can be switched off for an exact value", () => {
    expect(backoffMs(2, { delayMs: 1000, jitter: 0 })).toBe(3000);
  });

  test("attempt 0 or below is treated as the first attempt", () => {
    expect(backoffMs(0, { delayMs: 500, ...mid })).toBe(500);
    expect(backoffMs(-3, { delayMs: 500, ...mid })).toBe(500);
  });
});

describe("sleep", () => {
  test("resolves immediately for a non-positive duration", async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
    await expect(sleep(-1)).resolves.toBeUndefined();
  });

  test("resolves after the timer for a positive duration", async () => {
    vi.useFakeTimers();
    let done = false;
    const p = sleep(50).then(() => { done = true; });
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    await p;
    expect(done).toBe(true);
    vi.useRealTimers();
  });
});

describe("retryUntil", () => {
  const noSleep = { delayMs: 0, sleepFn: () => Promise.resolve() };

  test("returns the first settled value without retrying", async () => {
    const fn = vi.fn(() => "ok");
    const r = await retryUntil(fn, { attempts: 3, ...noSleep });
    expect(r).toMatchObject({ ok: true, value: "ok", attempts: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("retries while fn returns null, then settles", async () => {
    let n = 0;
    const fn = vi.fn(() => (++n < 3 ? null : `settled-${n}`));
    const r = await retryUntil(fn, { attempts: 5, ...noSleep });
    expect(r).toMatchObject({ ok: true, value: "settled-3", attempts: 3 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("undefined is retried just like null", async () => {
    let n = 0;
    const fn = vi.fn(() => (++n < 2 ? undefined : "later"));
    const r = await retryUntil(fn, { attempts: 3, ...noSleep });
    expect(r.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test("falsy-but-present values settle immediately (0, false, empty string)", async () => {
    for (const v of [0, false, ""]) {
      const r = await retryUntil(() => v, { attempts: 3, ...noSleep });
      expect(r).toMatchObject({ ok: true, value: v, attempts: 1 });
    }
  });

  test("a throw is retried and recorded as the last error", async () => {
    const fn = vi.fn(() => { throw new Error("boom"); });
    const r = await retryUntil(fn, { attempts: 3, ...noSleep });
    expect(r.ok).toBe(false);
    expect(r.value).toBeNull();
    expect(r.attempts).toBe(3);
    expect(r.error.message).toBe("boom");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("a throw followed by a success still succeeds, with no stale error", async () => {
    let n = 0;
    const fn = vi.fn(() => { if (++n === 1) throw new Error("transient"); return "recovered"; });
    const r = await retryUntil(fn, { attempts: 3, ...noSleep });
    expect(r).toMatchObject({ ok: true, value: "recovered", error: null, attempts: 2 });
  });

  test("a null after an earlier throw clears the recorded error", async () => {
    // Otherwise an exhausted run would blame an error that a later attempt
    // did not actually reproduce.
    let n = 0;
    const fn = () => { if (++n === 1) throw new Error("first"); return null; };
    const r = await retryUntil(fn, { attempts: 3, ...noSleep });
    expect(r.ok).toBe(false);
    expect(r.error).toBeNull();
  });

  test("awaits async fns", async () => {
    let n = 0;
    const fn = async () => (++n < 2 ? null : "async-ok");
    const r = await retryUntil(fn, { attempts: 3, ...noSleep });
    expect(r).toMatchObject({ ok: true, value: "async-ok", attempts: 2 });
  });

  test("sleeps between attempts but never after the last one", async () => {
    const sleepFn = vi.fn(() => Promise.resolve());
    await retryUntil(() => null, { attempts: 3, delayMs: 10, jitter: 0, sleepFn });
    expect(sleepFn).toHaveBeenCalledTimes(2);
    expect(sleepFn.mock.calls.map((c) => c[0])).toEqual([10, 30]);
  });

  test("attempts below 1 still run exactly once", async () => {
    const fn = vi.fn(() => null);
    const r = await retryUntil(fn, { attempts: 0, ...noSleep });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(r.attempts).toBe(1);
  });

  test("passes the 1-based attempt number to fn", async () => {
    const seen = [];
    await retryUntil((a) => { seen.push(a); return null; }, { attempts: 3, ...noSleep });
    expect(seen).toEqual([1, 2, 3]);
  });
});

describe("retryUntil — wall-clock deadline", () => {
  const noSleep = { delayMs: 0, sleepFn: () => Promise.resolve() };

  test("stops retrying once the deadline has passed", async () => {
    const fn = vi.fn(() => null);
    let t = 0;
    const r = await retryUntil(fn, {
      attempts: 10,
      ...noSleep,
      deadline: 100,
      now: () => (t += 60), // 60, 120 → over the deadline after the first attempt
    });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(true);
    expect(r.attempts).toBe(2);
  });

  test("a deadline never truncates a run that settles in time", async () => {
    let n = 0;
    const r = await retryUntil(() => (++n < 3 ? null : "ok"), {
      attempts: 10,
      ...noSleep,
      deadline: 1_000,
      now: () => 0,
    });
    expect(r).toMatchObject({ ok: true, value: "ok", attempts: 3 });
  });

  test("no deadline means the attempt budget alone decides", async () => {
    const fn = vi.fn(() => null);
    const r = await retryUntil(fn, { attempts: 4, ...noSleep });
    expect(fn).toHaveBeenCalledTimes(4);
    expect(r.timedOut).toBe(false);
  });

  test("a deadline of 0 is honoured, not treated as 'disabled'", async () => {
    // 0 is a legitimate already-expired deadline; only `null` disables the cap.
    const fn = vi.fn(() => null);
    await retryUntil(fn, { attempts: 5, ...noSleep, deadline: 0, now: () => 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("the deadline is checked BEFORE sleeping, not after", async () => {
    // Otherwise an expired budget still burns a full backoff wait.
    const sleepFn = vi.fn(() => Promise.resolve());
    await retryUntil(() => null, { attempts: 5, delayMs: 10, sleepFn, deadline: 0, now: () => 1 });
    expect(sleepFn).not.toHaveBeenCalled();
  });
});
