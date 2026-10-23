# Zoveli API Reference (agent tools)

Tools are the agent-facing API. Full JSON schemas live in each plugin's `src/index.ts`.

## Math (verified, one governed subsystem — see `docs/math-subsystem.md`)
- `mathcore_compute {expression, operation?}` → verified result + certificate (auto-memorized)
- `mathcore_check_answer {question, answer}` → MATCH | MISMATCH | UNCOMPARABLE | UNVERIFIABLE
- `mathcore_list_operations {}` → operation catalog
- Specialists (governed, namespaced proof memory): `math_algebra_solve`, `math_calculus_solve`, `math_stats_solve`, `math_logic_solve`, `math_units_solve`, `math_discrete_solve`, `math_arithmetic_solve`, `math_geometry_solve`, `math_trigonometry_solve`, `math_probability_solve`, `math_linear_solve`, `math_number_solve` (`{request, operation?}`)
- Intelligence: `math_recall {query, limit?, domain?}`, `math_recall_semantic {query, domain?, limit?}` (vector cosine when an embedding model is available, else keyword overlap), `math_route {request, operation?}`, `math_memorize {request, result}`, `math_stats {}`

## Memory / store (SQLite + FTS5 — see `docs/memory-store.md`)
- `memory_create_note {title, content, tags?, links?}`
- `memory_search {query, tags?}`
- `memory_read_note {title}`
- `memory_list_tags {}`
- `memory_update_note {title, newTitle?, content?, tags?, links?}`
- `memory_delete_note {title}`
- `vault_search {query, tags?, limit?, offset?}` (SQLite FTS5, ranked)
- `vault_graph {vaultPath?, format?}` → nodes/edges/orphans/hubs or DOT

## Persona (trusted, switchable)
- `persona_switch {persona}` → friend, tutor, engineer, or coach (remembered)
- `persona_current {}` → active persona + choices
- CLI: `/persona [name]` shows or switches; `ZOVELI_PERSONA` env pins one

## Web research (trusted sources, SSRF-guarded)
- `web_fetch {url, maxChars?}` → title + readable text + trusted flag
- `web_search {query, limit?}` → keyless source discovery with trust flags

## Languages
- `language_detect {filePath, content?}`
- `language_analyze {filePath, content?, language?, includeMetrics?, includeIssues?}`
- `language_format {filePath, content, language?, options?}`
- `language_lint {filePath, content, language?, config?}`
- `language_run_tests {projectPath, language, testPath?, args?}`
- `language_get_tooling {language}`

## Capability awareness
- `capability_scan {deep?, category?}`
- `capability_check {capability, details?}`
- `capability_list {category?, status?}`
- `capability_adapt {task, preferences?}`
- `capability_report {format?, includeRecommendations?}`

## Code / project
- `code_review {filePath, content?}` → complexity, duplication, dead code, secrets
- `docs_generate {path, outDir?}`
- `project_health {projectPath}` → score + checks
- `security_scan {path, maxFiles?}` → findings + summary
- `tasks_schedule {tasks[]}` → scored + time-blocked

## Auth (`@zoveli/auth`, passwordless email OTP)
- `auth_request_code {email}` → sends 6-digit code (any inbox incl. proton.me)
- `auth_verify_code {email, code}` → `{ok, email, token}` or `{ok:false, reason}`
- HTTP: `POST /api/auth/request`, `POST /api/auth/verify` (sets `zoveli_session` cookie),
  `GET /api/auth/me`, `POST /api/auth/logout`, page `GET /login`
- Login is optional. `ZOVELI_AUTH_REQUIRED=1` gates the app, `/api/chat`,
  `/api/run` and other non-public routes on a valid session cookie. `/health`,
  `/login` and `/api/auth/*` stay reachable.
- No Proton OAuth exists for third-party sites, so there is no "Login with
  Proton" button by design — email codes work with every provider instead.
  Set `ZOVELI_SMTP_URL` (+`ZOVELI_SMTP_FROM`) for real delivery, else codes go to
  the server console (dev mode). `ZOVELI_AUTH_DEV_ECHO=1` echoes codes in API
  responses and lifts login rate limits — test-only, never production.
  Malformed emails return `400` before any rate limit is consumed.

## System & hardware (`@zoveli/sysinfo`, local-only)
- `sysinfo_snapshot {diskPath?, fresh?}` → full host snapshot (30s cache)
- `sysinfo_cpu {}`, `sysinfo_memory {}`, `sysinfo_disk {path?}`
- `sysinfo_gpu {}`, `sysinfo_battery {}` (best effort; unavailable = unknown)
- `sysinfo_network {}` → local interfaces only, never probes externally
- `sysinfo_check {minFreeMemBytes?, minFreeDiskBytes?, maxCpuPercent?}` → budget gate

## Daily brief (`@zoveli/daily-brief`, optional, local-only)
- `daily_brief_get {timeZone?}` → date, weekday, time, time zone, greeting, message, and ISO timestamp
- Uses the system clock and `Intl` time-zone data; no network requests
- Enable with `ZOVELI_PLUGINS=zoveli-daily-brief pnpm start`

## Legacy skills (unmounted)
- `@zoveli/skills` still exports `daily-briefing`, `research`, `task-planning`,
  and `code-review` placeholders for compatibility, but it is not in the
  default plugin set and does not contribute live tools.

## Plugins
- Default tools come from the default plugins; optional plugins mount only when
  named in `ZOVELI_PLUGINS=<plugin-name,...>` (see
  [plugin SDK](../plugin-sdk/README.md)).
- `ZOVELI_DISABLE_PLUGINS=<plugin-name,...>` removes any default or optional
  plugin. `zoveli plugins [--json]` lists every plugin and its mount status.
- `pnpm run plugin:check` validates the contract, tool names and collisions
  for every built package (requires `pnpm run build` first).

## HTTP endpoints (web server, `http://127.0.0.1:3080`)

- `GET /health` → `{ok, tools}` (tool count; also the Docker/CI readiness probe)
- `GET /api/onboarding` → `{ok, chat:{ready,provider,model}, math:{ready}, tools}` (first-run readiness)
- `GET /api/tools` → `[{name, description, plugin}]` (the live tool list)
- `POST /api/chat {message}` → `{ok, verified, reply, model, provider, local}` (50k-char cap; per-IP rate limit)
- `POST /api/run {tool, args}` → `{ok, result}` on success, `{ok:false, error}` when the tool throws (unknown tools included); malformed bodies get 400
- `GET /login`, `POST /api/auth/request`, `POST /api/auth/verify`, `GET /api/auth/me`, `POST /api/auth/logout` (passwordless email OTP)
- `POST /api/run` and `/api/chat` accept an optional bearer gate: set `ZOVELI_API_TOKEN` (min 16 chars) to require `Authorization: Bearer`; when login is required and no bearer token is set, a valid session cookie is required. Per-IP rate limits apply (auth 30/min, chat/run 120/min; disabled when `ZOVELI_AUTH_DEV_ECHO=1` test mode is on).

