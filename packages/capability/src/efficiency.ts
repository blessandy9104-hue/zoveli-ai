export interface EfficiencyTrace {
  tool: string;
  durationMs: number;
  ok: boolean;
}

export interface EfficiencySnapshot {
  calls: number;
  failures: number;
  totalMs: number;
  recent: EfficiencyTrace[];
}

export interface EfficiencyFinding {
  tool: string;
  calls: number;
  failures: number;
  failureRate: number;
  averageMs: number;
  suggestion: string;
}

export interface EfficiencyReview {
  scope: 'recent-tool-calls';
  sampledCalls: number;
  totalCalls: number;
  totalFailures: number;
  averageMs: number;
  findings: EfficiencyFinding[];
  automaticChanges: false;
}

export interface EfficiencyOptions {
  /** Average latency, in milliseconds, that counts as slow. */
  slowMs?: number;
  /** Calls required before a healthy but slow tool is reported. */
  minCalls?: number;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Turn bounded host telemetry into evidence-based, non-mutating advice.
 *
 * The review never includes error text, never mutates the snapshot, and never
 * applies a change. It exists so the assistant can notice repeated slow or
 * failing work and propose a user-approved, tested improvement.
 */
export function reviewEfficiency(
  snapshot: EfficiencySnapshot | null | undefined,
  options: EfficiencyOptions = {}
): EfficiencyReview {
  const slowMs = Math.max(1, finiteOr(options.slowMs, 100));
  const minCalls = Math.max(1, Math.floor(finiteOr(options.minCalls, 3)));
  const traces = Array.isArray(snapshot?.recent)
    ? snapshot.recent.filter(
        (entry) =>
          typeof entry?.tool === 'string' &&
          entry.tool.length > 0 &&
          Number.isFinite(entry.durationMs) &&
          entry.durationMs >= 0 &&
          typeof entry.ok === 'boolean'
      )
    : [];

  const grouped = new Map<string, EfficiencyTrace[]>();
  for (const trace of traces) {
    const entries = grouped.get(trace.tool) ?? [];
    entries.push(trace);
    grouped.set(trace.tool, entries);
  }

  const findings: EfficiencyFinding[] = [];
  for (const [tool, entries] of grouped) {
    const failures = entries.filter((entry) => !entry.ok).length;
    // Repeated failures are actionable even with a small sample; a single
    // slow healthy call is not.
    if (entries.length < minCalls && failures < 2) continue;
    const averageMs =
      entries.reduce((sum, entry) => sum + entry.durationMs, 0) / entries.length;
    if (averageMs < slowMs && failures === 0) continue;
    const failureRate = failures / entries.length;
    const suggestion =
      failures > 0
        ? 'Investigate the recent failures, add a regression test, and make this operation cheaper or more reliable before increasing its use.'
        : 'Profile this operation, then propose a smaller or cached path with a test; apply it only after user approval.';
    findings.push({
      tool,
      calls: entries.length,
      failures,
      failureRate,
      averageMs: Math.round(averageMs * 100) / 100,
      suggestion,
    });
  }
  findings.sort(
    (left, right) =>
      right.averageMs - left.averageMs ||
      right.failures - left.failures ||
      left.tool.localeCompare(right.tool)
  );

  const sampledMs = traces.reduce((sum, trace) => sum + trace.durationMs, 0);
  const totalCalls = Math.max(
    0,
    Math.floor(finiteOr(snapshot?.calls, traces.length))
  );
  return {
    scope: 'recent-tool-calls',
    sampledCalls: traces.length,
    totalCalls,
    totalFailures: Math.min(
      totalCalls,
      Math.max(0, Math.floor(finiteOr(snapshot?.failures, 0)))
    ),
    averageMs: traces.length
      ? Math.round((sampledMs / traces.length) * 100) / 100
      : 0,
    findings,
    automaticChanges: false,
  };
}
