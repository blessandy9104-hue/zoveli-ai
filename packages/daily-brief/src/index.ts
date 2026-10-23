import { definePlugin, PLUGIN_API_VERSION, type Tool } from '@deepseek-ai/dsh-core';

export interface DailyBrief {
  date: string;
  weekday: string;
  time: string;
  timeZone: string;
  greeting: string;
  message: string;
  iso: string;
}

function greetingForHour(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  if (hour >= 17 && hour < 22) return 'Good evening';
  return 'Good night';
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((entry) => entry.type === type)?.value ?? '';
}

export function buildDailyBrief(now: Date, timeZone?: string): DailyBrief {
  const requested = (timeZone ?? '').trim();
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: requested || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw new Error(`Invalid IANA time zone: ${requested}`);
  }

  const zone = formatter.resolvedOptions().timeZone;
  const parts = formatter.formatToParts(now);
  const hour = Number(part(parts, 'hour'));
  const time = `${part(parts, 'hour')}:${part(parts, 'minute')}`;
  const date = `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')}`;
  const weekday = part(parts, 'weekday');
  const greeting = greetingForHour(hour);
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(now);

  return {
    date,
    weekday,
    time,
    timeZone: zone,
    greeting,
    message: `${greeting}. ${dateLabel} at ${time} (${zone}).`,
    iso: now.toISOString(),
  };
}

const DailyBriefGet: Tool = {
  name: 'daily_brief_get',
  description:
    'Return a local daily briefing with the date, weekday, time, time zone, and greeting.',
  parameters: {
    type: 'object',
    properties: {
      timeZone: {
        type: 'string',
        description: 'Optional IANA time zone, for example Europe/London.',
      },
    },
    additionalProperties: false,
  },
  async execute(args: { timeZone?: string } = {}) {
    return buildDailyBrief(new Date(), args.timeZone);
  },
};

export const zoveliDailyBrief = definePlugin({
  name: 'zoveli-daily-brief',
  apiVersion: PLUGIN_API_VERSION,
  description: 'Daily briefing tool',
  setup(ctx) {
    ctx.register('zoveli-daily-brief-tools', [DailyBriefGet]);
  },
});

export default zoveliDailyBrief;
