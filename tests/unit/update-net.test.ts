import { describe, expect, it, vi } from 'vitest';
import {
  GITHUB_UPDATE_HOSTS,
  UnsafeUrlError,
  assertSafeUrl,
  safeFetch,
} from '../../apps/cli/src/net';

describe('safe update URLs', () => {
  it('accepts only HTTPS GitHub hosts on the default port', () => {
    expect(assertSafeUrl('https://api.github.com/repos/x/y/releases/latest').host).toBe(
      'api.github.com'
    );
    expect(GITHUB_UPDATE_HOSTS).toContain('github.com');
    expect(() => assertSafeUrl('http://github.com/x')).toThrow(UnsafeUrlError);
    expect(() => assertSafeUrl('https://github.com:8443/x')).toThrow(/non-HTTPS port/);
    expect(() => assertSafeUrl('https://user:pass@github.com/x')).toThrow(/credentials/);
    expect(() => assertSafeUrl('https://evil.example/x')).toThrow(/not allowed/);
  });

  it('rejects local, loopback, link-local, and private targets', () => {
    for (const url of [
      'https://localhost/x',
      'https://foo.localhost/x',
      'https://127.0.0.1/x',
      'https://10.0.0.1/x',
      'https://172.16.0.1/x',
      'https://192.168.1.1/x',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/x',
      'https://[fd00::1]/x',
    ]) {
      expect(() => assertSafeUrl(url), url).toThrow(UnsafeUrlError);
    }
  });
});

describe('manual redirect handling', () => {
  it('never follows a redirect to a local address', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { Location: 'http://127.0.0.1:8080/admin' },
      })
    );
    await expect(
      safeFetch('https://api.github.com/repos/x/y/releases/latest', {
        fetchImpl: fetchMock as unknown as typeof fetch,
      })
    ).rejects.toThrow(/non-HTTPS/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1] as RequestInit).redirect).toBe('manual');
  });

  it('follows an allowlisted GitHub asset redirect manually', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      if (calls.length === 1) {
        return new Response(null, {
          status: 302,
          headers: {
            Location:
              'https://release-assets.githubusercontent.com/github-production-release-asset/123',
          },
        });
      }
      return new Response('archive-bytes', { status: 200 });
    });
    const result = await safeFetch(
      'https://github.com/blessandy9104-hue/zoveli-ai/releases/download/v0.8.0/asset.tar.gz',
      { fetchImpl: fetchMock as unknown as typeof fetch }
    );
    expect(result.status).toBe(200);
    expect(new TextDecoder().decode(result.body)).toBe('archive-bytes');
    expect(result.redirects).toEqual([
      'https://release-assets.githubusercontent.com/github-production-release-asset/123',
    ]);
    expect(calls).toHaveLength(2);
    expect((fetchMock.mock.calls[1][1] as RequestInit).redirect).toBe('manual');
  });

  it('stops after the redirect limit', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { Location: 'https://github.com/loop' },
      })
    );
    await expect(
      safeFetch('https://github.com/loop', {
        fetchImpl: fetchMock as unknown as typeof fetch,
        maxRedirects: 2,
      })
    ).rejects.toThrow(/too many redirects/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
