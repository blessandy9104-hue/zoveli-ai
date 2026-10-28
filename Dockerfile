# syntax=docker/dockerfile:1

# Build the TypeScript web application and install Python mathcore dependencies.
FROM node:22-bookworm-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch

COPY . .
RUN pnpm install --offline --frozen-lockfile --prod=false \
    && pnpm run build

RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/venv/bin/pip install --no-cache-dir ./mathcore

# Keep the runtime lean: only runtime OS packages and compiled app artifacts.
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3080 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:${PATH}" \
    ZOVELI_VAULT_PATH=/app/data/vault \
    ZOVELI_SESSION_PATH=/app/data/sessions \
    MATHCORE_AUDIT=/app/data/audit/audit.jsonl \
    MATHCORE_MCP_COMMAND=/opt/venv/bin/mathcore-mcp
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends dumb-init python3 python3-venv libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/data/vault /app/data/sessions /app/data/audit \
    && chown -R node:node /app/data

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/packages ./packages
COPY --from=builder --chown=node:node /app/apps/desktop/package.json ./apps/desktop/package.json
COPY --from=builder --chown=node:node /app/apps/desktop/node_modules ./apps/desktop/node_modules
COPY --from=builder --chown=node:node /app/apps/desktop/dist ./apps/desktop/dist
COPY --from=builder --chown=node:node /app/apps/desktop/vendor ./apps/desktop/vendor

USER node
EXPOSE 3080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3080/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/desktop/dist/server/server.js"]
