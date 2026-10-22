# Zoveli Desktop Guide

## Run (development)

```bash
pnpm install
pnpm run build
pnpm --filter @zoveli/desktop start
```

The shell spawns the local web app, waits for `/health`, then opens
it in a window. No remote servers, no accounts. Set `ZOVELI_DESKTOP_PORT`
to change the port (default 3080). See the [first-run guide](onboarding.md)
for setup checks and the readiness panel (`GET /api/onboarding`).

## Optional login

The desktop is account-free by default. Set `ZOVELI_AUTH_REQUIRED=1` to
require a valid email-OTP session for the app, `/api/chat`, `/api/run` and
other non-public routes. Configure `ZOVELI_SMTP_URL` and `ZOVELI_SMTP_FROM`
for real code delivery; otherwise codes print to the server console. A
configured `ZOVELI_API_TOKEN` lets machine clients bypass the session gate
with a bearer token.

## Verify without a window

```bash
ZOVELI_DESKTOP_SMOKE=1 pnpm --filter @zoveli/desktop start
# → "zoveli desktop smoke OK: server healthy on 127.0.0.1:3080"
```

## Accessibility

- Every page has landmarks, a skip link, labeled controls and visible keyboard
  focus; the chat log is a polite live region, so replies and errors are
  announced.
- Themes declare a native light/dark `color-scheme`, and text plus control
  borders meet WCAG AA contrast (verified by unit tests).
- `prefers-reduced-motion: reduce` disables smooth scrolling and skips loading
  the animated Unicorn backdrop; the static gradient remains.
- Chat history stays in this browser. Transient network errors are shown but not
  persisted; reloading restores VERIFIED badges and reply metadata.

## Packaged installers

Not shipped: `.exe`/`.dmg`/`.AppImage` builds require OS code-signing
certificates and `electron-builder` configuration, which are intentionally
not in this repo. The development shell above is the supported path.
