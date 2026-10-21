# Contributing to Zoveli AI

Thank you for your interest in contributing to Zoveli AI! This document provides guidelines for contributing to the project.

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting Started

### Prerequisites

- Node.js 22.16+ (memory store needs `node:sqlite` FTS5, unavailable below 22.16; pnpm 11 needs Node 22.5+)
- Python 3.11+
- pnpm 11.7.0 (`npm install -g pnpm@11.7.0`; matches `packageManager` and upstream)
- Git

### Development Setup

```bash
# Fork and clone
git clone https://github.com/blessandy9104-hue/zoveli-ai.git
cd zoveli-ai

# Install mathcore (vendored in ./mathcore; provides the mathcore-mcp server binary)
pip install -e ./mathcore

# Install dependencies
pnpm install

# Build
pnpm run build

# Run checks (all must pass)
pnpm run lint
pnpm run typecheck
pnpm run plugin:check
pnpm test

# Start the CLI assistant
pnpm start
```

## Development Workflow

### Branch Naming

- `feature/<description>` - New features
- `fix/<description>` - Bug fixes
- `docs/<description>` - Documentation updates
- `refactor/<description>` - Code refactoring
- `test/<description>` - Test additions
- `chore/<description>` - Maintenance tasks

### Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types:
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `style` - Formatting
- `refactor` - Refactoring
- `test` - Tests
- `chore` - Maintenance
- `ci` - CI/CD changes

Examples:
```
feat(capability): add capability adaptation for research tasks
fix(math): handle mathcore MCP connection timeout
docs(api): update capability API reference
```

### Pull Requests

1. Create a feature branch from `main`
2. Make your changes with tests
3. Run `pnpm run lint && pnpm run test`
4. Push and create PR
5. Ensure CI passes
6. Request review

### Testing Requirements

- Unit tests for new functions/classes
- Integration tests for new features
- E2E tests for user-facing changes
- Maintain 80% code coverage

## Product Scope

Zoveli's core is the offline CLI assistant — verified math, local memory,
and local tools. Web, desktop, and non-default plugins are secondary and
must never break the core. Read [docs/core-plugins.md](docs/core-plugins.md)
before adding anything: it declares what counts as core vs experimental.

## New Package Policy

No new package without all four:

- an **owner** (who maintains it),
- a **use case** (which user journey needs it),
- a **test** (unit, plus e2e if user-facing),
- a **lifecycle** (core or experimental, and why).

New packages start as **experimental** — mount them opt-in, never in
`defaultPlugins`. Promotion to core needs an ADR and maintainer sign-off.

## Project Structure

```
zoveli-ai/
├── apps/                    # Applications (CLI, Web, Desktop)
├── packages/                # 22 packages (@zoveli/*)
│   ├── core                 # Core integration plugin
│   ├── math-intelligence    # Governed verified math + proof memory
│   ├── math-domains         # Algebra/calculus/statistics/logic/units/discrete specialists
│   ├── memory-store         # SQLite-backed local-first memory
│   ├── capability           # Capability awareness
├── tests/                   # Test suites
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── config/                  # Cordis profiles
├── docker/                  # Dockerfiles
├── docs/                    # Documentation
└── scripts/                 # Utility scripts
```

## Adding a New Plugin

Start with the [plugin SDK guide](docs/plugin-sdk/README.md).

1. Scaffold: `pnpm create:plugin <name> --description "..." --mount`
2. Implement `src/index.ts` with `definePlugin`, `apiVersion:
   PLUGIN_API_VERSION`, a synchronous `setup`, and typed tool schemas
3. Add tests in `tests/unit/`
4. Run `pnpm install && pnpm run build && pnpm run plugin:check && pnpm test`
5. Enable with `ZOVELI_PLUGINS=zoveli-<name>`; the scaffolder wires
   `optionalPlugins` (experimental by default — see the New Package Policy
   above). Adding to `defaultPlugins` in `packages/host/src/index.ts` is a
   core change: it needs an ADR and maintainer sign-off, plus a reference in
   root `tsconfig.json`
6. Update documentation (`docs/api/README.md` for tools, package README for
   setup)

## Style Guide

- TypeScript strict mode
- ESLint + oxlint
- Prettier formatting
- JSDoc for public APIs
- No `any` types without justification

## Reporting Issues

Use GitHub Issues with:
- Clear title and description
- Steps to reproduce
- Expected vs actual behavior
- Environment details
- Logs/screenshots if applicable

## Security Issues

Report security vulnerabilities to **blessandy9104@gmail.com** (not public issues).

## Questions?

- GitHub Discussions for general questions
- Email: blessandy9104@gmail.com