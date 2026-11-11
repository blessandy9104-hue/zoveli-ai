import { isIP } from 'node:net';

/**
 * Origin validation for the remote MCP server, per the MCP Streamable HTTP
 * spec (2026-07-28) and earlier revisions:
 *
 *   - Servers MUST validate the Origin header on all incoming connections to
 *     prevent DNS rebinding attacks.
 *   - An invalid present Origin MUST yield HTTP 403 Forbidden.
 *   - Origin: null (e.g. file://) MUST be rejected.
 *   - An absent Origin is allowed (some clients/senders omit it).
 *
 * Two modes:
 *
 *   Local mode (loopback bind): allow absent Origin; allow loopback origins;
 *   reject non-loopback same-origin requests to prevent DNS rebinding.
 *
 *   Remote mode (public bind): allow same-origin plus configured origins;
 *   reject Origin: null; allow absent Origin.
 */

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '::1' || hostname === '0:0:0:0:0:0:0:1') {
      return true;
    }
    return isIP(hostname) === 4 && hostname.startsWith('127.');
  } catch {
    return false;
  }
}

export interface OriginPolicyOptions {
  /** 'local' (loopback bind) or 'remote' (public bind). */
  mode: 'local' | 'remote';
  /** Additional origins allowed in remote mode (e.g. 'https://client.example.com'). */
  configuredOrigins: readonly string[];
  /** The server's own origin, derived from host/port/scheme. Used for same-origin checks. */
  serverOrigin: string;
}

/**
 * Validate an Origin header value. Returns null when allowed, or a 403
 * reason string when disallowed. Callers map the reason to an HTTP 403.
 *
 * An absent Origin is represented by `undefined` and is always allowed (some
 * clients legitimately omit it).
 */
export function validateOrigin(
  origin: string | undefined,
  options: OriginPolicyOptions,
): string | null {
  // Absent Origin is allowed: some clients/senders omit it.
  if (origin === undefined) return null;

  // Origin: null (file://, sandboxed) is never acceptable.
  if (origin === 'null') return 'Origin null is not allowed.';

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return 'Origin is not a valid absolute URL.';
  }

  // Same-origin requests are always allowed regardless of mode.
  if (parsed.origin === options.serverOrigin) return null;

  // Non-same-origin handling depends on mode.
  if (options.mode === 'local') {
    // Local mode: only loopback origins are permitted beyond same-origin.
    if (!isLoopbackOrigin(parsed.origin)) {
      return `non-loopback origin "${origin}" is not allowed on a loopback bind (DNS rebinding protection).`;
    }
    return null;
  }

  // Remote mode: same-origin already allowed above; check configured origins.
  for (const configured of options.configuredOrigins) {
    try {
      const configuredUrl = new URL(configured);
      if (
        configuredUrl.origin === parsed.origin &&
        (configuredUrl.protocol === parsed.protocol ||
          (configuredUrl.protocol === 'https:' && parsed.protocol === 'https:'))
      ) {
        return null;
      }
    } catch {
      // Ignore malformed configured origins; they never match.
    }
  }

  return `origin "${origin}" is not in the configured allowlist.`;
}
