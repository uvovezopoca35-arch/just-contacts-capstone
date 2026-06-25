import { getAdmin } from '@/lib/firebase-admin';

/**
 * Per-user rate limiting for authenticated AI server actions.
 *
 * State is persisted in Firestore (collection `rate_limits/{uid}`) so the limit
 * holds across serverless invocations, mirroring the bot webhook's limiter.
 * The collection is server-only (Admin SDK); client access is denied in
 * firestore.rules.
 */

const DEFAULT_MAX = 30; // AI server-action calls per window, per user
const DEFAULT_WINDOW_MS = 60_000; // 1 minute

/** Thrown when a caller exceeds their allowed request rate. */
export class RateLimitError extends Error {
  constructor(message = 'Rate limit exceeded. Please try again in a minute.') {
    super(message);
    this.name = 'RateLimitError';
  }
}

/**
 * Atomically consumes one unit of the caller's rate budget.
 * Throws {@link RateLimitError} when the budget is exhausted.
 *
 * If the Firestore transaction itself fails (e.g. transient backend error), the
 * request is allowed through — availability is preferred over hard-failing on
 * infrastructure hiccups, matching the bot webhook's fail-open behavior.
 */
export async function enforceRateLimit(
  uid: string,
  max = DEFAULT_MAX,
  windowMs = DEFAULT_WINDOW_MS,
): Promise<void> {
  let allowed = true;
  try {
    const db = getAdmin().firestore();
    const ref = db.doc(`rate_limits/${uid}`);
    allowed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const now = Date.now();
      let { count = 0, resetAt = 0 } = (snap.data() || {}) as { count?: number; resetAt?: number };
      if (now > resetAt) {
        count = 0;
        resetAt = now + windowMs;
      }
      if (count >= max) return false;
      tx.set(ref, { count: count + 1, resetAt }, { merge: true });
      return true;
    });
  } catch (e) {
    console.warn('Rate limit check failed (allowing request):', e);
    return;
  }
  if (!allowed) throw new RateLimitError();
}
