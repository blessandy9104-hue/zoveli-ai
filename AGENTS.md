# AGENTS.md

This repository is the Zoveli AI monorepo: a local-first personal assistant with a verified-math core, CLI-first UX, and optional desktop/web surfaces. Keep changes aligned with that mission: the offline core must remain reliable and privacy-preserving.

## Product and architecture priorities

- Keep the local-first, offline core as the primary contract. Web, desktop, and broader integrations are secondary and must not regress the CLI/runtime core.
- Preserve the verified-math story: tools that touch `mathcore`, audit results, or checked outputs must remain deterministic, explicit, and transparent.
- Prefer the smallest, most local, most inspectable implementation that satisfies the requirement.
- Do not add cloud dependencies or telemetry that changes the product’s privacy-first operating model without a clear justification.

## Repository shape

- `apps/cli`: command-line experience and primary user entrypoint.
- `apps/desktop`: Electron shell for desktop use.
- `packages/*`: shared libraries, tool implementations, runtime capabilities, and support modules.
- `mathcore`: offline verified math subsystem; treat it as a critical safety boundary.
- `scripts/`: build, validation, packaging, plugin, and health checks.
- `docs/`: architecture, usage, runbooks, and product guidance.

## Coding expectations

- Keep runtime dependencies and package boundaries sane: shared packages should not depend on app-specific shell code; app code should depend on shared capability layers rather than each other.
- Favor the existing workspace conventions in this repo (`pnpm`, TypeScript, package-local modules) over ad hoc patterns.
- Do not create new global state or hidden side effects just to make a feature easier to test.
- Prefer explicit, readable code over clever abstraction. If a helper exists to explain a real responsibility, keep it; otherwise inline it.
- Avoid `any`; prefer narrow, inferred, typed values.
- Avoid unnecessary destructuring and premature abstraction. Keep the code easy to follow.
- Keep generated or build artifacts out of hand-edited source changes unless the task specifically requires generation.

## Verified math and safety-sensitive changes

- If a change affects mathematical verification, audit logic, tool trust boundaries, CLI output, or local security/privacy behavior, validate the concrete failure mode before patching.
- For math-related changes, preserve the existing principle: verified answers should be explicit and auditable, not guessed or silently approximated.
- Do not weaken the claims or safety checks around offline execution, vault data, or security-sensitive actions.

## CLI and local runtime expectations

- The CLI is the canonical user interface for the core product. Changes should not degrade the local experience or require a hosted service for core workflows.
- Preserve the “works offline for local tools” contract. If a feature relies on network access, make that dependency explicit and non-blocking for the core path.
- Keep commands, output, and health checks understandable and actionable for developers and end users.

## Testing and verification

Run the relevant validation command before finishing a change.

- Use the repo’s standard checks from the root:
  - `pnpm test`
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm run build`
- For focused iteration, run the narrowest relevant command in the affected package or app instead of broad suites.
- Do not add tests that merely assert mocks or implementation details. Test the real observable behavior.
- If a fix affects the runtime, plugin surface, config, vault, or CLI behavior, add or update focused tests in the relevant area.

## Branches, commits, and PRs

- Default branch: `main`.
- Use short branch names, ideally no more than three words, hyphen-separated, without slashes or type prefixes.
  - Good: `math-verify-fix`, `vault-health`, `plugin-check`
  - Avoid: `feat/foo`, `fix/thing`, `feature/xyz`
- Use conventional commit titles: `type(scope): summary`
  - Valid types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`
  - Examples: `fix(cli): preserve offline startup fallback`, `feat(mathcore): add new verification check`, `docs: update local setup guide`

## Tooling and commands

- Prefer the project scripts already defined in `package.json`:
  - `pnpm install`
  - `pnpm run build`
  - `pnpm test`
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm run doctor`
  - `pnpm config:check`
  - `pnpm health:check`
  - `pnpm release:check`
  - `pnpm plugin:check`
  - `pnpm perf:check`
- Use the existing package structure instead of introducing new top-level build tools or one-off scripts unless the task clearly requires it.
- Keep scripts and validation steps deterministic and CI-friendly.

## Security, privacy, and data handling

- Do not weaken local-only privacy expectations.
- Treat vault, memory, config, auth, and secrets with care. Avoid accidental persistence of sensitive data in docs or logs.
- Any security-sensitive or data-handling change should be explicit about the risk and the mitigation.

## Notes for AI-assisted contributors

- Follow the repo’s existing conventions before inventing new patterns.
- When a task touches multiple layers, prefer the minimal patch that keeps the architecture coherent.
- When proposing a change, explain the user-visible or runtime impact, especially for offline/local-only features.
- Do not assume a feature is safe just because it is “easy” to add. Validate the downstream effect on reliability, privacy, or math correctness.

This file is the local policy for working in this repo. Respect it when making code, tests, docs, or release-related changes.
