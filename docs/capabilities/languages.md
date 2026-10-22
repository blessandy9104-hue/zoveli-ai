# Programming Languages Capability (`languages.polyglot`)

**Plugin:** `@zoveli/languages` · **Status:** beta · **Priority:** high

## What it does
Detect, analyze, format, lint, test, and recommend tooling for 17+ programming languages — offline-first, with graceful fallbacks when native tools are missing.

## Supported languages
TypeScript, JavaScript, Python, Rust, Go, Java, C++, C#, Ruby, PHP, HTML, CSS, JSON, YAML, Markdown, Bash, SQL.

## Tools (agent-facing)
| Tool | Purpose | Required inputs |
|------|---------|-----------------|
| `language_detect` | Identify language from path + optional content | `filePath` |
| `language_analyze` | Structure, metrics (LOC, cyclomatic, MI), issues | `filePath` (+ `content` for unsaved buffers) |
| `language_format` | Format via native tool or deterministic fallback | `filePath`, `content` |
| `language_lint` | Universal checks + native linter + optional host LSP diagnostics | `filePath`, `content` |
| `language_run_tests` | Run vitest / pytest / cargo test / go test | `projectPath`, `language` |
| `language_get_tooling` | Recommended LSP / formatter / linter / test runner + install hints + availability | `language` |

## Examples
```jsonc
// detect
{ "filePath": "src/index.ts" }
// → { "language": "typescript", "confidence": 0.9, "method": "extension" }

// analyze
{ "filePath": "a.ts", "content": "export function add(a:number,b:number){return a+b}" }
// → { "metrics": {...}, "structure": {"functions": [...]}, "issues": [...] }

// tooling
{ "language": "python" }
// → { "tooling": {"formatter": "black", "linter": "ruff", "testRunner": "pytest"}, "installHints": {...}, "availability": {...} }
```

## Fallback strategy (when native tools missing)
1. **Format:** try `prettier` / `black` / `rustfmt` / `gofmt` in temp dir → else trim trailing whitespace, normalize indentation, single trailing newline.
2. **Lint:** universal checks (trailing WS, tabs, missing EOL, TODO, `console.log`) + eslint JSON when available + LSP diagnostics only when the host provides an `lsp` service (none is bundled).
3. **Tests:** project-type inference (`Cargo.toml` → rust, `go.mod` → go, `pytest.ini` → python, `package.json` → node) with structured pass/fail parsing; `unknown` → `skipped` with reason instead of failure.
4. **Tooling:** `which`/`where` probes; `npx`-runnable tools treated as available via fallback.

## Capability registration
Registered as `languages.polyglot` in `zoveli-capability` scanner (`category: tools`, `provides: [language-detect, code-analyze, code-format, code-lint, run-tests, tooling-guide]`).

## Verification
```bash
# unit tests (requires pnpm install first; run from repo root)
pnpm vitest run tests/unit/languages.test.ts
```

