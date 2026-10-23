# @zoveli/daily-brief

Local daily briefing tool.

## Enable

```bash
pnpm install && pnpm run build
ZOVELI_PLUGINS=zoveli-daily-brief pnpm start
```

The `--mount` scaffolder option wires this package into
`optionalPlugins` in `packages/host/src/index.ts`; it stays unloaded
until named in `ZOVELI_PLUGINS`. Promoting it to `defaultPlugins` is a
core change (ADR + maintainer sign-off, see `docs/core-plugins.md`).

## Tool

`daily_brief_get` accepts an optional `{ timeZone?: string }` IANA zone and
returns the local date, weekday, time, time zone, greeting, a ready-to-read
message, and the ISO timestamp:

```json
{
  "date": "2026-10-22",
  "weekday": "Thursday",
  "time": "20:51",
  "timeZone": "UTC",
  "greeting": "Good evening",
  "message": "Good evening. October 22, 2026 at 20:51 (UTC).",
  "iso": "2026-10-22T20:51:00.000Z"
}
```

The tool is local-only, makes no network requests, and uses the system clock
and `Intl` time-zone data.

## Test

```bash
pnpm exec vitest run tests/unit/daily-brief.test.ts
pnpm run plugin:check
```

Authoring guide: [docs/plugin-sdk/README.md](../../docs/plugin-sdk/README.md).
