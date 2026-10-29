import { describe, test, expect, vi, afterEach } from "vitest";
import { PROGRESS_PREFIX, createProgressReporter, progressLineParser } from "./progress.js";

afterEach(() => { vi.useRealTimers(); });

describe("progressLineParser", () => {
  test("yields the messages of complete [ship-progress] lines only", () => {
    const got = [];
    const feed = progressLineParser((m) => got.push(m));
    feed(`noise\n${PROGRESS_PREFIX}test: running 30s\n${PROGRESS_PREFIX}test: run`);
    expect(got).toEqual(["test: running 30s"]);
    feed("ning 1m00s\r\n");
    expect(got).toEqual(["test: running 30s", "test: running 1m00s"]);
  });
});

describe("createProgressReporter", () => {
  test("null without a progressToken or without sendNotification", () => {
    expect(createProgressReporter(undefined, "ship_run")).toBeNull();
    expect(createProgressReporter({ _meta: {}, sendNotification: vi.fn() }, "ship_run")).toBeNull();
    expect(createProgressReporter({ _meta: { progressToken: 1 } }, "ship_run")).toBeNull();
  });

  test("forwards a message as notifications/progress with a rising counter", () => {
    const sendNotification = vi.fn(async () => {});
    const rep = createProgressReporter({ _meta: { progressToken: "tok" }, sendNotification }, "ship_run");
    rep.note("test: running 30s");
    rep.note("test: running 1m00s");
    rep.stop();
    expect(sendNotification).toHaveBeenNthCalledWith(1, { method: "notifications/progress", params: { progressToken: "tok", progress: 1, message: "test: running 30s" } });
    expect(sendNotification.mock.calls[1][0].params).toMatchObject({ progress: 2, message: "test: running 1m00s" });
  });

  test("heartbeat every 30 s when the child is silent, repeating its last message; stops with stop()", async () => {
    vi.useFakeTimers();
    const sendNotification = vi.fn(async () => {});
    const rep = createProgressReporter({ _meta: { progressToken: 0 }, sendNotification }, "ship_run");
    await vi.advanceTimersByTimeAsync(65_000);
    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(sendNotification.mock.calls[0][0].params.message).toMatch(/^ship_run: running/);
    rep.note("test: running 1m05s");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sendNotification.mock.calls.at(-1)[0].params.message).toBe("test: running 1m05s");
    rep.stop();
    const n = sendNotification.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sendNotification).toHaveBeenCalledTimes(n);
  });

  test("a throwing sendNotification never breaks the call", () => {
    const rep = createProgressReporter({ _meta: { progressToken: 1 }, sendNotification: vi.fn(() => { throw new Error("closed"); }) }, "ship_run");
    expect(() => rep.note("x")).not.toThrow();
    rep.stop();
  });
});
