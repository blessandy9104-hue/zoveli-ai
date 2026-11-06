import { describe, it, expect } from 'vitest';
import {
  TRUSTED_SOURCES,
  isTrustedUrl,
  assertSafeUrl,
  fetchReadable,
  parseDuckLite,
  searchTrusted,
  zoveliWebResearch,
} from '../../packages/webresearch/src/index';
import { createMockContext } from '../setup';

const PUBLIC_DNS = async () => [{ address: '93.184.216.34' }];

function stubFetch(body: string, contentType = 'text/html', status = 200, url = 'https://example.com/x') {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => body,
  })) as unknown as typeof fetch;
}

describe('trusted sources', () => {
  it('recognizes authoritative hosts and subdomains', () => {
    expect(TRUSTED_SOURCES.length).toBeGreaterThan(5);
    expect(isTrustedUrl('https://en.wikipedia.org/wiki/Tea')).toBe(true);
    expect(isTrustedUrl('https://arxiv.org/abs/1234')).toBe(true);
    expect(isTrustedUrl('https://example.com/x')).toBe(false);
    expect(isTrustedUrl('https://wikipedia.org.evil.com/')).toBe(false);
    expect(isTrustedUrl('not a url')).toBe(false);
  });
});

describe('SSRF guard', () => {
  it('rejects schemes, loopback, private and metadata hosts without DNS', async () => {
    await expect(assertSafeUrl('ftp://example.com/x', PUBLIC_DNS)).rejects.toThrow('only http');
    await expect(assertSafeUrl('http://localhost:3080/', PUBLIC_DNS)).rejects.toThrow('blocked host');
    await expect(assertSafeUrl('http://127.0.0.1/', PUBLIC_DNS)).rejects.toThrow('blocked host');
    await expect(assertSafeUrl('http://10.1.2.3/', PUBLIC_DNS)).rejects.toThrow('blocked host');
    await expect(assertSafeUrl('http://169.254.169.254/', PUBLIC_DNS)).rejects.toThrow('blocked host');
    await expect(assertSafeUrl('http://[::1]/', PUBLIC_DNS)).rejects.toThrow('blocked host');
  });

  it('rejects hosts that resolve privately', async () => {
    const evilDNS = async () => [{ address: '192.168.1.7' }];
    await expect(assertSafeUrl('https://internal.example.com/', evilDNS)).rejects.toThrow('resolves privately');
  });

  it('blocks reserved IPv4 and non-public IPv6 destinations', async () => {
    for (const ip of ['100.64.0.1', '192.0.2.1', '198.18.0.1', '224.0.0.1', '240.0.0.1']) {
      await expect(assertSafeUrl(`http://${ip}/`, PUBLIC_DNS)).rejects.toThrow('blocked host');
    }
    for (const ip of ['fc00::1', 'fe80::1', 'ff02::1', '2001:db8::1', '::ffff:192.168.1.1']) {
      await expect(assertSafeUrl(`http://[${ip}]/`, PUBLIC_DNS)).rejects.toThrow('blocked host');
    }
  });

  it('rejects mixed public and private DNS answers', async () => {
    const mixedDNS = async () => [
      { address: '93.184.216.34' },
      { address: 'fd00::1' },
    ];
    await expect(assertSafeUrl('https://mixed.example/', mixedDNS)).rejects.toThrow('resolves privately');
  });

  it('allows public hosts', async () => {
    const u = await assertSafeUrl('https://example.com/x', PUBLIC_DNS);
    expect(u.hostname).toBe('example.com');
  });
});

describe('fetchReadable', () => {
  const HTML = `<html><head><title>Green Tea Guide</title><style>.x{color:red}</style></head>
<body><script>track()</script><h1>Green Tea</h1><p>Green tea is steamed, keeping it fresh and grassy. It pairs well with mornings.</p></body></html>`;

  it('extracts title and readable text, drops scripts/styles', async () => {
    const r = await fetchReadable('https://example.com/tea', {
      fetchImpl: stubFetch(HTML),
      resolveHost: PUBLIC_DNS,
    });
    expect(r.title).toBe('Green Tea Guide');
    expect(r.text).toContain('Green tea is steamed');
    expect(r.text).not.toContain('track()');
    expect(r.trusted).toBe(false);
  });

  it('truncates long pages and flags trusted sources', async () => {
    const big = `<html><head><title>T</title></head><body><p>${'word '.repeat(5000)}</p></body></html>`;
    const r = await fetchReadable('https://en.wikipedia.org/wiki/Tea', {
      maxChars: 1000,
      fetchImpl: stubFetch(big),
      resolveHost: PUBLIC_DNS,
    });
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(1000);
    expect(r.trusted).toBe(true);
  });

  it('validates each redirect destination before requesting it', async () => {
    const requested: string[] = [];
    const redirectFetch = (async (input: string | URL | Request) => {
      const target = String(input);
      requested.push(target);
      return {
        ok: false,
        status: 302,
        url: target,
        headers: { get: (name: string) => name.toLowerCase() === 'location' ? 'http://127.0.0.1/admin' : null },
        text: async () => '',
      };
    }) as unknown as typeof fetch;
    await expect(fetchReadable('https://example.com/start', {
      fetchImpl: redirectFetch,
      resolveHost: PUBLIC_DNS,
    })).rejects.toThrow('blocked host');
    expect(requested).toEqual(['https://example.com/start']);
  });

  it('rejects non-text content and HTTP errors', async () => {
    await expect(
      fetchReadable('https://example.com/f.png', { fetchImpl: stubFetch('x', 'image/png'), resolveHost: PUBLIC_DNS })
    ).rejects.toThrow('unsupported content type');
    await expect(
      fetchReadable('https://example.com/old', { fetchImpl: stubFetch('x', 'text/html', 404), resolveHost: PUBLIC_DNS })
    ).rejects.toThrow('HTTP 404');
  });
});

describe('searchTrusted', () => {
  const LITE = `<html><body>
<a rel="nofollow" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FTea">Wikipedia Tea</a>
<a rel="nofollow" href="https://example.com/tea-shop">Tea Shop</a>
</body></html>`;

  it('parses redirect and direct anchors with trust flags', () => {
    const hits = parseDuckLite(LITE, 5);
    expect(hits).toHaveLength(2);
    expect(hits[0].url).toBe('https://en.wikipedia.org/wiki/Tea');
    expect(hits[0].trusted).toBe(true);
    expect(hits[1].trusted).toBe(false);
  });

  it('manually follows safe redirects and rejects unsafe destinations', async () => {
    const requested: string[] = [];
    const redirectFetch = (async (input: string | URL | Request) => {
      const target = String(input);
      requested.push(target);
      return {
        ok: false,
        status: 302,
        url: target,
        headers: { get: (name: string) => name.toLowerCase() === 'location' ? 'http://127.0.0.1/admin' : null },
        text: async () => '',
      };
    }) as unknown as typeof fetch;
    const out = await searchTrusted('tea', { fetchImpl: redirectFetch, resolveHost: PUBLIC_DNS });
    expect(out.results).toEqual([]);
    expect(out.note).toContain('blocked host');
    expect(requested).toEqual(['https://lite.duckduckgo.com/lite/?q=tea']);
  });

  it('returns empty with a note when search is down (offline stays offline)', async () => {
    const failing = (async () => { throw new Error('no network'); }) as unknown as typeof fetch;
    const out = await searchTrusted('tea', { fetchImpl: failing });
    expect(out.results).toEqual([]);
    expect(out.note).toContain('unavailable');
  });
});

describe('webresearch plugin', () => {
  it('registers fetch + search tools and a service', () => {
    const ctx = createMockContext();
    zoveliWebResearch.setup(ctx);
    const tools = ctx.register.mock.calls.find((c) => c[0] === 'webresearch-tools')?.[1] as any[];
    expect(tools.map((t) => t.name).sort()).toEqual(['web_fetch', 'web_search']);
    expect(ctx.provide).toHaveBeenCalledWith('webresearch', expect.any(Object));
  });
});
