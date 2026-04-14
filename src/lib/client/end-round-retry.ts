export type EndRoundStatus = "IN_ROUND" | "RESULTS";

interface EndRoundRetrierOptions {
  runEndIfNeeded: () => Promise<{ status: EndRoundStatus }>;
  onError?: (error: unknown) => void;
  retryDelayMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export function createEndRoundRetrier(options: EndRoundRetrierOptions) {
  const retryDelayMs = options.retryDelayMs ?? 500;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  let cancelled = false;
  let running = false;
  let retryId: ReturnType<typeof setTimeout> | null = null;

  const clearRetry = () => {
    if (retryId !== null) {
      clearTimeoutFn(retryId);
      retryId = null;
    }
  };

  const run = async (): Promise<void> => {
    if (cancelled || running) {
      return;
    }

    running = true;

    try {
      const result = await options.runEndIfNeeded();
      if (cancelled || result.status !== "IN_ROUND") {
        return;
      }

      retryId = setTimeoutFn(() => {
        retryId = null;
        void run();
      }, retryDelayMs);
    } catch (error) {
      if (!cancelled) {
        options.onError?.(error);
      }
    } finally {
      running = false;
    }
  };

  const cancel = () => {
    cancelled = true;
    clearRetry();
  };

  return {
    run,
    cancel,
    hasPendingRetry: () => retryId !== null,
  };
}
