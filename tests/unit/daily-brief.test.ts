import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDailyBrief, zoveliDailyBrief } from '../../packages/daily-brief/src/index';
import { createMockContext } from '../setup';

function toolFrom(ctx: ReturnType<typeof createMockContext>) {
  const call = ctx.register.mock.calls.find((c: any[]) => c[0] === 'zoveli-daily-brief-tools');
  expect(call).toBeDefined();
  return call[1].find((t: any) => t.name === 'daily_brief_get');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('zoveli-daily-brief', () => {
  it('registers the daily-brief tool table', () => {
    const ctx = createMockContext();
    zoveliDailyBrief.setup(ctx);
    expect(toolFrom(ctx)).toBeDefined();
  });

  it('returns a deterministic briefing in the requested time zone', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T20:51:00Z'));
    const ctx = createMockContext();
    zoveliDailyBrief.setup(ctx);

    await expect(toolFrom(ctx).execute({ timeZone: 'UTC' })).resolves.toEqual({
      date: '2026-10-22',
      weekday: 'Thursday',
      time: '20:51',
      timeZone: 'UTC',
      greeting: 'Good evening',
      message: 'Good evening. October 22, 2026 at 20:51 (UTC).',
      iso: '2026-10-22T20:51:00.000Z',
    });
  });

  it('uses the greeting for the local hour', () => {
    expect(buildDailyBrief(new Date('2026-10-22T08:05:00Z'), 'UTC')).toMatchObject({
      time: '08:05',
      greeting: 'Good morning',
    });
    expect(buildDailyBrief(new Date('2026-10-22T14:00:00Z'), 'UTC')).toMatchObject({
      greeting: 'Good afternoon',
    });
    expect(buildDailyBrief(new Date('2026-10-22T23:30:00Z'), 'UTC')).toMatchObject({
      greeting: 'Good night',
    });
  });

  it('rejects an invalid time zone with an actionable error', () => {
    expect(() => buildDailyBrief(new Date(), 'Not/AZone')).toThrow(/Invalid IANA time zone/);
  });
});
