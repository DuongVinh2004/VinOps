export const DEFAULT_OUTBOX_MAX_ATTEMPTS = 8;
export const OUTBOX_RETRY_BASE_DELAY_MS = 1_000;
export const OUTBOX_RETRY_MAX_DELAY_MS = 5 * 60_000;

export type RetrySchedule = {
  retryAt: Date | null;
  exhausted: boolean;
};

/**
 * The attempt number is the value persisted after an event is claimed.  The
 * calculation deliberately has no random jitter: delivery order and tests are
 * deterministic, while the database claim uses SKIP LOCKED for concurrency.
 */
export function outboxRetryDelayMs(publishAttempts: number): number {
  const normalizedAttempt = Math.max(1, Math.floor(publishAttempts));
  const exponentialDelay = OUTBOX_RETRY_BASE_DELAY_MS * 2 ** (normalizedAttempt - 1);
  return Math.min(exponentialDelay, OUTBOX_RETRY_MAX_DELAY_MS);
}

export function scheduleOutboxRetry(
  now: Date,
  publishAttempts: number,
  maxAttempts = DEFAULT_OUTBOX_MAX_ATTEMPTS,
): RetrySchedule {
  if (publishAttempts >= maxAttempts) {
    return { retryAt: null, exhausted: true };
  }

  return {
    retryAt: new Date(now.getTime() + outboxRetryDelayMs(publishAttempts)),
    exhausted: false,
  };
}
