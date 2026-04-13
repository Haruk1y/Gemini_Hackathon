import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEndRoundRetrier } from "@/lib/client/end-round-retry";

describe("createEndRoundRetrier", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries when the server still reports IN_ROUND and stops after RESULTS", async () => {
    const runEndIfNeeded = vi
      .fn<() => Promise<{ status: "IN_ROUND" | "RESULTS" }>>()
      .mockResolvedValueOnce({ status: "IN_ROUND" })
      .mockResolvedValueOnce({ status: "RESULTS" });

    const retrier = createEndRoundRetrier({
      runEndIfNeeded,
      retryDelayMs: 500,
    });

    await retrier.run();

    expect(runEndIfNeeded).toHaveBeenCalledTimes(1);
    expect(retrier.hasPendingRetry()).toBe(true);

    await vi.advanceTimersByTimeAsync(500);

    expect(runEndIfNeeded).toHaveBeenCalledTimes(2);
    expect(retrier.hasPendingRetry()).toBe(false);
  });

  it("cancels a scheduled retry", async () => {
    const runEndIfNeeded = vi
      .fn<() => Promise<{ status: "IN_ROUND" | "RESULTS" }>>()
      .mockResolvedValue({ status: "IN_ROUND" });

    const retrier = createEndRoundRetrier({
      runEndIfNeeded,
      retryDelayMs: 500,
    });

    await retrier.run();
    retrier.cancel();
    await vi.advanceTimersByTimeAsync(500);

    expect(runEndIfNeeded).toHaveBeenCalledTimes(1);
    expect(retrier.hasPendingRetry()).toBe(false);
  });

  it("reports errors without scheduling another retry", async () => {
    const onError = vi.fn();
    const runEndIfNeeded = vi
      .fn<() => Promise<{ status: "IN_ROUND" | "RESULTS" }>>()
      .mockRejectedValue(new Error("boom"));

    const retrier = createEndRoundRetrier({
      runEndIfNeeded,
      onError,
      retryDelayMs: 500,
    });

    await retrier.run();
    await vi.advanceTimersByTimeAsync(500);

    expect(runEndIfNeeded).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(retrier.hasPendingRetry()).toBe(false);
  });
});
