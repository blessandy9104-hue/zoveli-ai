/**
 * Per-credential usage accounting helpers.
 *
 * Usage records live in memory only and reset on restart. They are never
 * written to disk and never include bearer tokens. Callers can take snapshots
 * for observability without exposing any credential material.
 */

export interface UsageEntry {
  name: string;
  requests: number;
  blockedRequests: number;
  lastRequestAt: string | null;
}

/** Aggregate per-credential usage into a single total view. */
export function aggregateUsage(entries: readonly UsageEntry[]): {
  totalRequests: number;
  totalBlocked: number;
  byName: ReadonlyArray<UsageEntry>;
} {
  let totalRequests = 0;
  let totalBlocked = 0;
  for (const entry of entries) {
    totalRequests += entry.requests;
    totalBlocked += entry.blockedRequests;
  }
  return {
    totalRequests,
    totalBlocked,
    byName: [...entries].sort((a, b) => a.name.localeCompare(b.name)),
  };
}
