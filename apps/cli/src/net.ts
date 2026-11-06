/**
 * Network helpers for the updater.
 *
 * Redirects are followed manually and every hop is checked against a small
 * host allowlist. That keeps a compromised or malicious redirect from turning
 * an update request into a probe of localhost, link-local metadata services,
 * or other machines on the user's LAN.
 */

export const GITHUB_UPDATE_HOSTS = [
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'raw.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com',
] as const;

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

export interface SafeFetchOptions {
  fetchImpl?: typeof fetch;
  allowedHosts?: readonly string[];
  maxRedirects?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: string;
}

export interface SafeFetchResult {
  status: number;
  headers: Headers;
  body: Uint8Array;
  url: string;
  redirects: string[];
}

function ipv4Private(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((value) => value > 255)) return true;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function ipv6Private(host: string): boolean {
  const value = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (!value.includes(':')) return false;
  return (
    value === '::' ||
    value === '::1' ||
    value.startsWith('fc') ||
    value.startsWith('fd') ||
    value.startsWith('fe8') ||
    value.startsWith('fe9') ||
    value.startsWith('fea') ||
    value.startsWith('feb') ||
    value.startsWith('ff')
  );
}

function hostAllowed(hostname: string, allowedHosts: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return allowedHosts.some(
    (allowed) => host === allowed.toLowerCase() || host.endsWith(`.${allowed.toLowerCase()}`)
  );
}

/** Validate one URL before a request or redirect. */
export function assertSafeUrl(raw: string, allowedHosts: readonly string[] = GITHUB_UPDATE_HOSTS): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError(`invalid URL: ${raw}`);
  }
  if (url.protocol !== 'https:') {
    throw new UnsafeUrlError(`refusing non-HTTPS update URL: ${url.protocol}//${url.host}`);
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('refusing update URL with embedded credentials');
  }
  if (url.port && url.port !== '443') {
    throw new UnsafeUrlError(`refusing update URL on non-HTTPS port: ${url.port}`);
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    ipv4Private(host) ||
    ipv6Private(host)
  ) {
    throw new UnsafeUrlError(`refusing local or private update URL host: ${host}`);
  }
  if (!hostAllowed(host, allowedHosts)) {
    throw new UnsafeUrlError(`redirect host is not allowed: ${host}`);
  }
  return url;
}

function redirectLocation(response: Response): string | null {
  const status = response.status;
  if (![301, 302, 303, 307, 308].includes(status)) return null;
  return response.headers.get('location');
}

/**
 * Fetch with `redirect: 'manual'`. `Location` is resolved and validated before
 * the next request, so the runtime never follows a redirect to a local address.
 */
export async function safeFetch(raw: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const allowedHosts = options.allowedHosts ?? GITHUB_UPDATE_HOSTS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRedirects = options.maxRedirects ?? 5;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const redirects: string[] = [];
  let current = assertSafeUrl(raw, allowedHosts);

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    let response: Response;
    try {
      response = await fetchImpl(current.toString(), {
        method: options.method ?? 'GET',
        redirect: 'manual',
        headers: {
          'User-Agent': 'zoveli-update',
          ...options.headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new Error(
        `update request failed for ${current.host}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const location = redirectLocation(response);
    if (location === null) {
      return {
        status: response.status,
        headers: response.headers,
        body: new Uint8Array(await response.arrayBuffer()),
        url: current.toString(),
        redirects,
      };
    }

    if (response.body) await response.body.cancel().catch(() => {});
    if (hop === maxRedirects) {
      throw new UnsafeUrlError(`too many redirects while fetching ${raw}`);
    }
    const next = new URL(location, current);
    current = assertSafeUrl(next.toString(), allowedHosts);
    redirects.push(current.toString());
  }

  throw new UnsafeUrlError(`too many redirects while fetching ${raw}`);
}

export async function safeFetchText(
  url: string,
  options: SafeFetchOptions = {}
): Promise<{ status: number; text: string; url: string }> {
  const result = await safeFetch(url, options);
  return {
    status: result.status,
    text: new TextDecoder().decode(result.body),
    url: result.url,
  };
}
