# Syntax: Dockerfile
# zoveli CLI image: offline-capable assistant console.
# Run interactively: docker run --rm -i zoveli-cli
# NOTE: node:22 minimum — pnpm 11 requires node:sqlite (Node 22.5+).
FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm (must match packageManager in package.json)
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

# Fetch dependencies from the lockfile into the store. Source changes do not
# invalidate this layer; only a lockfile/workspace-policy change does.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

# Copy source (.dockerignore keeps node_modules/dist/.git out).
COPY . .

# Link dependencies from the fetched store, then build.
RUN pnpm install --prefer-offline --frozen-lockfile --prod=false
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

# Install mathcore before the app artifacts: this layer depends only on
# mathcore/, so ordinary source changes reuse it.
COPY mathcore ./mathcore
RUN apk add --no-cache --virtual .build-deps build-base cmake && \
    pip install --break-system-packages --no-cache-dir ./mathcore && \
    apk del .build-deps

# Copy built artifacts. pnpm's isolated linker keeps workspace links under each
# package's node_modules, including apps/cli/node_modules.
COPY --from=builder --chown=zoveli:zoveli /app/package.json ./
COPY --from=builder --chown=zoveli:zoveli /app/pnpm-lock.yaml ./
COPY --from=builder --chown=zoveli:zoveli /app/node_modules ./node_modules
COPY --from=builder --chown=zoveli:zoveli /app/packages ./packages
COPY --from=builder --chown=zoveli:zoveli /app/apps/cli/package.json ./apps/cli/package.json
COPY --from=builder --chown=zoveli:zoveli /app/apps/cli/node_modules ./apps/cli/node_modules
COPY --from=builder --chown=zoveli:zoveli /app/apps/cli/dist ./apps/cli/dist
COPY --from=builder --chown=zoveli:zoveli /app/knowledge-vault ./knowledge-vault

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


