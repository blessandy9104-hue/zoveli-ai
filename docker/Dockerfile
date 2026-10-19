# Syntax: Dockerfile
# zoveli CLI image: offline-capable assistant console.
# Run interactively: docker run --rm -i zoveli-cli
# NOTE: node:22 minimum — pnpm 11 requires node:sqlite (Node 22.5+).
FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm (must match packageManager in package.json)
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

# Copy source (.dockerignore keeps node_modules/dist/.git out).
# Single COPY keeps all 60 workspace manifests aligned with sources;
# split manifest/source layers cannot enumerate 60 package.json paths
# with Docker's glob rules, so we trade a little layer caching for
# correctness.
COPY . .

# Install dependencies
RUN pnpm install --frozen-lockfile --prod=false

# Build all packages (tsc emit)
RUN pnpm run build

# Runtime stage
FROM node:22-alpine AS runtime

WORKDIR /app

# Install dumb-init for proper signal handling, plus Python for mathcore
RUN apk add --no-cache dumb-init python3 py3-pip

# Create non-root user (no fixed UID/GID: recent Alpine images already
# occupy 1000, so `addgroup -g 1000` fails with "gid in use").
RUN addgroup -S zoveli && \
    adduser -S zoveli -G zoveli

# Copy built artifacts (workspace symlinks in node_modules resolve into packages/)
COPY --from=builder --chown=zoveli:zoveli /app/package.json ./
COPY --from=builder --chown=zoveli:zoveli /app/pnpm-lock.yaml ./
COPY --from=builder --chown=zoveli:zoveli /app/node_modules ./node_modules
COPY --from=builder --chown=zoveli:zoveli /app/packages ./packages
COPY --from=builder --chown=zoveli:zoveli /app/apps/cli/package.json ./apps/cli/package.json
COPY --from=builder --chown=zoveli:zoveli /app/apps/cli/dist ./apps/cli/dist
COPY --from=builder --chown=zoveli:zoveli /app/knowledge-vault ./knowledge-vault
COPY --from=builder --chown=zoveli:zoveli /app/mathcore ./mathcore

# Install minimal build dependencies to allow z3-solver and other
# pyproject-based packages to build, install mathcore, then remove build deps.
RUN apk add --no-cache --virtual .build-deps build-base cmake && \
    pip install --break-system-packages --no-cache-dir ./mathcore && \
    apk del .build-deps

# Create directories
RUN mkdir -p /app/data/vault /app/data/sessions /app/data/audit && \
    chown -R zoveli:zoveli /app/data

# Switch to non-root user
USER zoveli

# Environment
ENV NODE_ENV=production
ENV ZOVELI_VAULT_PATH=/app/data/vault
ENV MATHCORE_AUDIT=/app/data/audit/audit.jsonl
ENV ZOVELI_SESSION_PATH=/app/data/sessions

# NOTE: no HEALTHCHECK — the CLI is interactive, not a service.
# Verified math works out of the box: mathcore-mcp is on PATH (above).

# Entry point
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/cli/dist/cli.js"]


