/**
 * Unified provider error codes.
 *
 * The chat loop retries and reports errors the same way regardless of which
 * cloud API produced them. Adapters translate vendor-specific status codes and
 * error bodies into this shape so the host never has to parse provider prose.
 */

export type ProviderErrorCode =
  | 'authentication_failed'
  | 'bad_request'
  | 'context_window_exceeded'
  | 'model_not_found'
  | 'provider_unavailable'
  | 'rate_limited'
  | 'timeout'
  | 'transport_error'
  | 'unknown';

export interface ProviderErrorOptions {
  provider: string;
  status?: number;
  retryable?: boolean;
  retryAfterMs?: number;
  cause?: unknown;
}

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly provider: string;
  readonly status?: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(code: ProviderErrorCode, message: string, options: ProviderErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ProviderError';
    this.code = code;
    this.provider = options.provider;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
  }
}

const CONTEXT_PATTERN =
  /context(?:_length_exceeded| window| length| limit)|maximum context|too many tokens|token limit|reduce the length|prompt is too long/i;
const RATE_PATTERN = /rate[_ ]limit|too many requests|quota exceeded|resource exhausted/i;
const MODEL_PATTERN = /model[_ ]not[_ ]found|does not exist|unknown model|invalid model|no such model/i;

function headerValue(headers: Headers | Record<string, string> | undefined, name: string): string {
  if (!headers) return '';
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) || '';
  }
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers as Record<string, string>)) {
    if (key.toLowerCase() === lower) return value;
  }
  return '';
}

/** Parse `Retry-After` as seconds or an HTTP date into milliseconds. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number.parseInt(value.trim(), 10);
  if (Number.isFinite(seconds) && String(seconds) === value.trim()) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return undefined;
}

function errorBody(body: string): { message: string; code: string } {
  if (!body) return { message: '', code: '' };
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: unknown; code?: unknown; type?: unknown };
      message?: unknown;
      code?: unknown;
    };
    const error = parsed.error;
    const message =
      (typeof error?.message === 'string' && error.message) ||
      (typeof parsed.message === 'string' && parsed.message) ||
      body;
    const code =
      (typeof error?.code === 'string' && error.code) ||
      (typeof error?.type === 'string' && error.type) ||
      (typeof parsed.code === 'string' && parsed.code) ||
      '';
    return { message, code };
  } catch {
    return { message: body, code: '' };
  }
}

/** Map an OpenAI-compatible HTTP failure to a unified ProviderError. */
export function mapOpenAIError(
  status: number,
  body: string,
  headers?: Headers | Record<string, string>,
  provider = 'openai',
  now = Date.now()
): ProviderError {
  const parsed = errorBody(body);
  const detail = parsed.message.slice(0, 300);
  const retryAfterMs = parseRetryAfter(headerValue(headers, 'retry-after'), now);

  if (status === 401 || status === 403) {
    return new ProviderError(
      'authentication_failed',
      `${provider} authentication failed (${status}): ${detail}`,
      { provider, status, retryable: false }
    );
  }
  if (status === 429 || RATE_PATTERN.test(parsed.code) || RATE_PATTERN.test(parsed.message)) {
    return new ProviderError(
      'rate_limited',
      `${provider} rate limit exceeded (${status}): ${detail}`,
      { provider, status, retryable: true, retryAfterMs }
    );
  }
  if (
    status === 413 ||
    parsed.code === 'context_length_exceeded' ||
    CONTEXT_PATTERN.test(parsed.code) ||
    CONTEXT_PATTERN.test(parsed.message)
  ) {
    return new ProviderError(
      'context_window_exceeded',
      `${provider} rejected the request because it exceeds the model context window: ${detail}`,
      { provider, status, retryable: false }
    );
  }
  if (status === 404 && (MODEL_PATTERN.test(parsed.code) || MODEL_PATTERN.test(parsed.message))) {
    return new ProviderError('model_not_found', `${provider} model not found: ${detail}`, {
      provider,
      status,
      retryable: false,
    });
  }
  if (status === 408 || status === 504) {
    return new ProviderError('timeout', `${provider} timed out (${status}): ${detail}`, {
      provider,
      status,
      retryable: true,
      retryAfterMs,
    });
  }
  if (status >= 500) {
    return new ProviderError('provider_unavailable', `${provider} is unavailable (${status}): ${detail}`, {
      provider,
      status,
      retryable: true,
      retryAfterMs,
    });
  }
  if (status >= 400) {
    return new ProviderError('bad_request', `${provider} rejected the request (${status}): ${detail}`, {
      provider,
      status,
      retryable: false,
    });
  }
  return new ProviderError('unknown', `${provider} request failed (${status}): ${detail}`, {
    provider,
    status,
    retryable: false,
  });
}

/** Wrap a transport-level failure (DNS, reset, fetch rejection). */
export function transportError(provider: string, error: unknown): ProviderError {
  const message = error instanceof Error ? error.message : String(error);
  return new ProviderError('transport_error', `${provider} request failed: ${message}`, {
    provider,
    retryable: true,
    cause: error,
  });
}

/** True for errors that may succeed when retried without changing the request. */
export function isRetryableProviderError(error: unknown): boolean {
  return error instanceof ProviderError && error.retryable;
}
