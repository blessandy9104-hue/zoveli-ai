# AGENTS.md

This repository is the Zoveli AI monorepo: a local-first personal assistant with a verified-math core, CLI-first UX, and optional desktop/web surfaces. Keep every change aligned with that mission: local privacy, reliable offline behavior, and explicit verification must remain the default.

## Mission and product priorities

- The CLI and local runtime are the primary product surface. Web, desktop, and broader integrations are secondary and must not degrade the core experience.
- Preserve the local-first contract: core flows must work without cloud services, and optional network features must remain non-blocking for the core path.
- Preserve the verified-math story: any change touching `mathcore`, audit logic, trust boundaries, or claim verification must remain explicit, deterministic, and inspectable.
- Prefer the smallest, most local, most understandable implementation that meets the requirement.
- Do not add cloud dependencies, telemetry, or privacy regressions without a clear product and security justification.

## Repository map

- `apps/cli`: primary CLI user experience and runtime entrypoint.
- `apps/desktop`: Electron desktop shell for local desktop use.
- `packages/*`: shared runtime packages, tools, system capabilities, and support libraries.
- `mathcore`: safety-critical verified math backend; treat as a core trust boundary.
- `scripts/`: build, validation, packaging, plugin, health, and release automation.
- `docs/`: architecture, usage, runbooks, onboarding, and product guidance.
- `test-vault`: scratch vault used by automated tests; do not treat as user data.

## Team workflow and engineering expectations

- Start by reading the relevant existing implementation and neighboring tests before changing behavior.
- Keep the scope small and reviewable. Avoid unrelated refactors in the same patch.
- Prefer the repo’s existing patterns over introducing a new framework, wrapper, or helper.
- When touching multiple layers, keep the patch coherent: minimal changes, consistent names, and clear ownership of each responsibility.
- If a change is speculative or high-risk, explain the concrete failure mode, likelihood, and cost before proceeding.

## Architecture boundaries

- Keep runtime dependencies from shared packages toward the app/runtime surfaces rather than the reverse.
- Do not let app-specific code leak into shared libraries unless there is a strong, explicit reason.
- Keep CLI and local runtime behavior understandable for a user who expects privacy and offline-first behavior.
- Keep security-sensitive and vault-related logic explicit and reviewable; do not hide side effects in broad abstractions.

## Coding standards

- Favor explicit, readable TypeScript over clever abstractions.
- Avoid `any`; prefer inferred, narrow, typed values.
- Avoid unnecessary destructuring and premature abstraction.
- Prefer inline logic unless the helper clearly owns a real responsibility.
- Do not create global state, hidden runtime coupling, or implicit test-only seams.
- Do not add generated or build artifacts as hand-edited source changes unless the task specifically requires generation.
- Aim for deterministic code paths and consistent naming.

## Verified math and safety-sensitive work

- If a change affects `mathcore`, verification logic, audit output, trust boundaries, CLI output, storage/vault behavior, or security/privacy-sensitive paths, validate the concrete risk before patching.
- Preserve the principle that verified answers are explicit and auditable, not guessed, silently approximated, or superficially “good enough.”
- Do not weaken the offline, local-only, or trusted-output guarantees.
- Any change to the safety boundary should be explained in terms of observable behavior, failure modes, and verification steps.

## Testing and validation

Before finishing a change, run the relevant validation command.

- Canonical repo checks from the root:
  - `pnpm test`
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm run build`
- For focused iteration, prefer the narrowest relevant script or package-level validation over broad suites.
- Do not add tests that only assert mock behavior or implementation details. Test the real observable contract.
- If a fix affects runtime behavior, plugin surfaces, config, vault logic, CLI behavior, or verification pathways, update the relevant tests in the same area.

## Branches and commit workflow

- Default branch: `main`.
- Use short branch names, ideally no more than three words, hyphen-separated, without slashes or type prefixes.
  - Good: `math-verify-fix`, `vault-health`, `plugin-check`
  - Avoid: `feat/foo`, `fix/thing`, `feature/xyz`
- Use conventional commit style: `type(scope): summary`
  - Valid types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`
  - Examples:
    - `fix(cli): preserve offline startup fallback`
    - `feat(mathcore): add new verification check`
    - `docs: update local setup guide`

## Pull requests and review expectations

- Keep PRs targeted and easy to reason about.
- Include the user-visible effect of the change, especially for CLI, local-only tools, security, or math-related behavior.
- Do not merge a patch that weakens the local-first or verified-math contract without explicit review.
- Prefer proof over claims: reference tests, commands run, and any key safety validation performed.

## Tooling and project scripts

Prefer the repo’s existing scripts in `package.json` rather than introducing new top-level tooling unless the task clearly requires it.

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

Keep validation steps deterministic and CI-friendly.

## Security, privacy, and data handling

- Do not weaken local-only privacy expectations.
- Treat vaults, memory stores, config files, auth data, and secrets with care.
- Avoid accidentally persisting sensitive values in logs, docs, screenshots, or test fixtures.
- Any change with security implications should be explicit about the risk and the mitigation.

## AI-assisted contribution rules

- Follow the repo’s existing conventions before inventing new patterns.
- When a task spans multiple layers, prefer the minimal patch that preserves architecture coherence.
- Before proposing a broad or risky change, explain the concrete user-visible or runtime impact.
- Do not assume a feature is safe just because it is easy to add. Validate the downstream effect on reliability, privacy, or verification integrity.
- If a task involves product, CLI, math, security, or data sensitivity, treat it as higher-risk and validate accordingly.

## Working agreement for this team

This file is the working policy for contributors and AI assistants in this repository. Respect it when making code, tests, docs, release-related changes, or automation work. The team’s priority is a reliable local-first assistant with verifiable math, clear boundaries, and a low-risk path to shipping.
