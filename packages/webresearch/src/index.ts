import { definePlugin } from '@deepseek-ai/dsh-core';
import { lookup, type LookupAddress, type LookupOptions } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

/**
 * Authoritative sources the research tools prefer. Subdomains included
 * (e.g. en.wikipedia.org). Anything else still fetches — but is labeled
 * untrusted so answers can say where claims come from.
 */
export const TRUSTED_SOURCES = [
  'wikipedia.org',
  'arxiv.org',
  'pubmed.ncbi.nlm.nih.gov',
  'developer.mozilla.org',
  'docs.python.org',
  'nodejs.org',
  'learn.microsoft.com',
  'w3.org',
  'ietf.org',
  'rfc-editor.org',
  'github.com',
  'stackoverflow.com',
];

export function registrableHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, '');
}

/** True when the host is (a subdomain of) a trusted source. */
export function isTrustedUrl(url: string): boolean {
  let host: string;
  try {
    host = registrableHost(new URL(url).hostname);
  } catch {
    return false;
  }
  return TRUSTED_SOURCES.some((t) => host === t || host.endsWith(`.${t}`));
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = parseInt(p, 10);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  const inRange = (base: string, bits: number): boolean => {
    const b = ipv4ToInt(base);
    if (b === null) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (b & mask);
  };
  return (
    inRange('10.0.0.0', 8) ||
    inRange('172.16.0.0', 12) ||
    inRange('192.168.0.0', 16) ||
    inRange('100.64.0.0', 10) ||
    inRange('127.0.0.0', 8) ||
    inRange('169.254.0.0', 16) ||
    inRange('192.0.0.0', 24) ||
    inRange('192.0.2.0', 24) ||
    inRange('198.18.0.0', 15) ||
    inRange('198.51.100.0', 24) ||
    inRange('203.0.113.0', 24) ||
    inRange('224.0.0.0', 4) ||
    inRange('240.0.0.0', 4) ||
    inRange('0.0.0.0', 8)
  );
}

function ipv6ToBigInt(ip: string): bigint | null {
  let address = ip.toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (!address.includes(':')) return null;
  const ipv4Tail = address.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (ipv4Tail) {
    const ipv4 = ipv4ToInt(ipv4Tail[1]);
    if (ipv4 === null) return null;
    address = address.slice(0, -ipv4Tail[1].length) + `${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const zeros = 8 - left.length - right.length;
  if ((halves.length === 1 && zeros !== 0) || (halves.length === 2 && zeros < 1)) return null;
  const groups = [...left, ...Array(zeros).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function inIPv6Range(address: bigint, network: bigint, prefix: number): boolean {
  return address >> BigInt(128 - prefix) === network >> BigInt(128 - prefix);
}

function isBlockedAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (!normalized.includes(':')) return isPrivateIPv4(normalized);
  const ipv6 = ipv6ToBigInt(normalized);
  if (ipv6 === null) return true;
  // Permit only global unicast, excluding special-purpose and transition ranges.
  return (
    ipv6 >> 125n !== 1n ||
    inIPv6Range(ipv6, 0x20010000000000000000000000000000n, 23) || // IETF special-purpose
    inIPv6Range(ipv6, 0x20010db8000000000000000000000000n, 32) || // documentation
    inIPv6Range(ipv6, 0x20020000000000000000000000000000n, 16) || // 6to4
    inIPv6Range(ipv6, 0x20010000000000000000000000000000n, 32) // Teredo
  );
}

function isBlockedLiteral(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[(.*)\]$/, '$1');
  return h === 'localhost' || h.endsWith('.localhost') || isBlockedAddress(h);
}

export type DnsLookup = (host: string) => Promise<{ address: string }[]>;

async function defaultLookup(host: string): Promise<{ address: string }[]> {
  return new Promise((resolve, reject) => {
    lookup(host, { all: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses);
    });
  });
}

function fetchPinned(url: URL, addresses: LookupAddress[], init: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const pinnedLookup = (
      _hostname: string,
      options: LookupOptions,
      callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void
    ): void => {
      if (typeof options === 'object' && options.all) {
        callback(null, addresses);
        return;
      }
      const first = addresses[0];
      callback(null, first.address, first.family);
    };
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = transport(url, {
      method: 'GET',
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      signal: init.signal ?? undefined,
      lookup: pinnedLookup,
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > 2_000_000) {
          request.destroy(new Error('page too large'));
          return;
        }
        chunks.push(buffer);
      });
      response.on('end', () => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        }
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 502, headers }));
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}
async function resolveSafeUrl(
  url: string,
  lookupFn: DnsLookup
): Promise<{ url: URL; addresses: { address: string; family: number }[] }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`not a URL: ${url}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('only http(s) URLs may be fetched');
  }
  const host = parsed.hostname.replace(/^\[(.*)\]$/, '$1');
  if (isBlockedLiteral(host)) throw new Error(`blocked host: ${parsed.hostname}`);
  let records: { address: string }[];
  try {
    records = await lookupFn(host);
  } catch {
    throw new Error(`cannot resolve host: ${parsed.hostname}`);
  }
  if (records.length === 0) throw new Error(`cannot resolve host: ${parsed.hostname}`);
  const addresses = records.map(({ address }) => {
    if (isBlockedAddress(address)) throw new Error(`blocked host (resolves privately): ${parsed.hostname}`);
    return { address, family: (address.includes(':') ? 6 : 4) as 4 | 6 };
  });
  return { url: parsed, addresses };
}

/**
 * SSRF guard: reject local, reserved and special-use IPv4/IPv6 destinations.
 * The returned URL is not a connection pin; network fetches use resolveSafeUrl.
 */
export async function assertSafeUrl(url: string, lookupFn: DnsLookup = defaultLookup): Promise<URL> {
  return (await resolveSafeUrl(url, lookupFn)).url;
}
/** Remove `<tag ...>...</tag ...>` blocks in linear time (case-insensitive). */
function removeTagBlocks(html: string, tag: string): string {
  const lower = html.toLowerCase();
  const open = `<${tag}`;
  const close = `</${tag}`;
  let out = '';
  let i = 0;
  while (i < html.length) {
    const start = lower.indexOf(open, i);
    if (start === -1) {
      out += html.slice(i);
      break;
    }
    const next = lower.charAt(start + open.length);
    if (next && !/[\s/>]/.test(next)) {
      out += html.slice(i, start + open.length);
      i = start + open.length;
      continue;
    }
    out += html.slice(i, start);
    let end = lower.indexOf(close, start + open.length);
    if (end === -1) break; // unclosed block: drop the remainder
    end = lower.indexOf('>', end + close.length);
    if (end === -1) break;
    i = end + 1;
  }
  return out;
}

/** Remove HTML comments in linear time. */
function removeHtmlComments(html: string): string {
  let out = '';
  let i = 0;
  while (i < html.length) {
    const start = html.indexOf('<!--', i);
    if (start === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, start);
    const end = html.indexOf('-->', start + 4);
    if (end === -1) break;
    i = end + 3;
  }
  return out;
}

/** Replace `<...>` tags with a space in linear time. */
function stripTags(html: string): string {
  let out = '';
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, lt);
    const gt = html.indexOf('>', lt + 1);
    if (gt === -1) break;
    i = gt + 1;
  }
  return out;
}

function stripToText(html: string): { title: string; text: string } {
  const title = (html.match(/<title[^>]*>([\s\S]{0,300})<\/title>/i)?.[1] || '').trim().replace(/\s+/g, ' ');
  let body = removeTagBlocks(html, 'script');
  body = removeTagBlocks(body, 'style');
  body = removeTagBlocks(body, 'noscript');
  body = removeTagBlocks(body, 'svg');
  body = removeHtmlComments(body);
  body = stripTags(body);
  const text = body
    .replace(/&(nbsp|amp|lt|gt|quot|apos);/gi, ' ')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
}

export interface FetchResult {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  truncated: boolean;
  trusted: boolean;
}

/**
 * Fetch a page and return readable text. HTTPS preferred (plain http is
 * accepted but reported). Caps bytes/time; rejects non-text content.
 */
async function fetchFollowingSafeRedirects(
  url: string,
  fetchImpl: typeof fetch | undefined,
  init: RequestInit,
  lookupFn: DnsLookup = defaultLookup
): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = url;
  for (let redirects = 0; ; redirects += 1) {
    const { url: current, addresses } = await resolveSafeUrl(currentUrl, lookupFn);
    const response = fetchImpl
      ? await fetchImpl(current.toString(), { ...init, redirect: 'manual' })
      : await fetchPinned(current, addresses, init);
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response, finalUrl: current.toString() };
    }
    const location = response.headers.get('location');
    if (!location) throw new Error('redirect response has no location');
    if (redirects >= 5) throw new Error('too many redirects');
    try {
      await response.body?.cancel();
    } catch {
      // Ignore failures closing the redirect body; do not follow it unchecked.
    }
    currentUrl = new URL(location, current).toString();
  }
}

/**
 * Fetch a page and return readable text. HTTPS preferred (plain http is
 * accepted but reported). Caps bytes/time; rejects non-text content.
 */
export async function fetchReadable(
  url: string,
  opts: { maxChars?: number; timeoutMs?: number; fetchImpl?: typeof fetch; resolveHost?: DnsLookup } = {}
): Promise<FetchResult> {
  const maxChars = Math.min(Math.max(opts.maxChars ?? 12000, 500), 100000);
  const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? 15000, 1000), 60000);
  const { response: res, finalUrl } = await fetchFollowingSafeRedirects(
    url,
    opts.fetchImpl,
    {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'ZoveliAI/0.1 (local research; contact: blessandy9104@gmail.com)', Accept: 'text/html,text/plain' },
    },
    opts.resolveHost
  );
  if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status}`);
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const raw = await res.text();
  if (raw.length > 2_000_000) throw new Error('page too large');
  let title = '';
  let text = '';
  if (contentType.includes('text/html') || (!contentType && /<\w+/.test(raw.slice(0, 2000)))) {
    ({ title, text } = stripToText(raw));
  } else if (contentType.includes('text/')) {
    text = raw.replace(/\s+/g, ' ').trim();
  } else {
    throw new Error(`unsupported content type: ${contentType || 'unknown'}`);
  }
  const truncated = text.length > maxChars;
  const cut = truncated ? text.slice(0, maxChars) : text;
  const atSentence = truncated ? Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n')) : -1;
  return {
    url,
    finalUrl,
    title: title.slice(0, 200),
    text: atSentence > maxChars * 0.5 ? cut.slice(0, atSentence + 1) : cut,
    truncated,
    trusted: isTrustedUrl(url) || isTrustedUrl(finalUrl),
  };
}
export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  trusted: boolean;
}

/** Decode the `udm=14`-free DuckDuckGo lite anchors into results. */
export function parseDuckLite(html: string, limit: number): SearchHit[] {
  const hits: SearchHit[] = [];
  // Bounded quantifiers keep matching linear on hostile HTML.
  const anchorRe = /<a\b[^>]{0,2000}?rel="nofollow"[^>]{0,2000}?href="([^"]{1,2000})"[^>]{0,2000}?>([\s\S]{0,5000}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null && hits.length < limit) {
    let href = m[1].replace(/&amp;/g, '&');
    const redirect = href.match(/[?&]udm=14|yan?dex|duckduckgo\.com\/l\/\?uddg=([^&]+)/i);
    if (redirect?.[1]) {
      try {
        href = decodeURIComponent(redirect[1]);
      } catch {
        continue;
      }
    }
    if (!/^https?:\/\//i.test(href)) continue;
    const label = stripTags(m[2]).replace(/\s+/g, ' ').trim();
    hits.push({ title: label.slice(0, 200) || href, url: href, snippet: '', trusted: isTrustedUrl(href) });
  }
  return hits;
}

/**
 * Keyless web search via DuckDuckGo Lite. Best-effort: any failure returns
 * an empty list with a note (never throws) — offline stays offline.
 */
export async function searchTrusted(
  query: string,
  opts: { limit?: number; timeoutMs?: number; fetchImpl?: typeof fetch; resolveHost?: DnsLookup } = {}
): Promise<{ results: SearchHit[]; note: string }> {
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 10);
  const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? 15000, 1000), 60000);
  try {
    const { response: res } = await fetchFollowingSafeRedirects(
      `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
      opts.fetchImpl,
      {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': 'ZoveliAI/0.1 (local research; contact: blessandy9104@gmail.com)' },
      },
      opts.resolveHost
    );
    if (!res.ok) return { results: [], note: `search unavailable (HTTP ${res.status})` };
    const html = await res.text();
    return { results: parseDuckLite(html, limit), note: 'keyless DuckDuckGo Lite; verify important claims at the source' };
  } catch (e) {
    return { results: [], note: `search unavailable (${e instanceof Error ? e.message : String(e)})` };
  }
}
export const zoveliWebResearch = definePlugin({
  name: 'zoveli-webresearch',
  description: 'Trusted-source web retrieval for grounding answers',

  setup(ctx) {
    ctx.provide('webresearch', { fetchReadable, searchTrusted, isTrustedUrl });

    ctx.register('webresearch-tools', [
      {
        name: 'web_fetch',
        description:
          'Fetch a web page as readable text for grounding an answer (SSRF-guarded; prefer wikipedia.org, arxiv.org, official docs; always name the source when answering)',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'https URL to fetch' },
            maxChars: { type: 'number', default: 12000 },
          },
          required: ['url'],
        },
        async execute({ url, maxChars = 12000 }: { url: string; maxChars?: number }) {
          return fetchReadable(url, { maxChars });
        },
      },
      {
        name: 'web_search',
        description:
          'Keyless web search for discovering sources on a topic (best-effort; results flagged trusted or not — verify important claims at the source)',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', default: 5 },
          },
          required: ['query'],
        },
        async execute({ query, limit = 5 }: { query: string; limit?: number }) {
          return searchTrusted(query, { limit });
        },
      },
    ]);
  },
});

export default zoveliWebResearch;
