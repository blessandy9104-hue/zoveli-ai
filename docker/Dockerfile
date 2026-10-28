# syntax=docker/dockerfile:1
# Zoveli CLI image: interactive offline-capable assistant terminal.
FROM node:22-alpine AS builder

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

# Fetch dependencies from the lockfile into the store. Source changes do not
# invalidate this layer; only a lockfile/workspace-policy change does.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

COPY . .
RUN pnpm install --prefer-offline --frozen-lockfile --prod=false
RUN pnpm run build

# Reuse the published project runtime, including dumb-init, Python, mathcore,
# and its unprivileged zoveli account. This avoids compiling math dependencies.
FROM ghcr.io/blessandy9104-hue/zoveli-ai:f3de8d1 AS runtime
WORKDIR /app

# pnpm links workspaces through these root and package-level node_modules dirs.
COPY --from=builder --chown=zoveli:zoveli /app/package.json ./package.json
COPY --from=builder --chown=zoveli:zoveli /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder --chown=zoveli:zoveli /app/node_modules ./node_modules
COPY --from=builder --chown=zoveli:zoveli /app/packages ./packages
COPY --from=builder --chown=zoveli:zoveli /app/apps/cli/package.json ./apps/cli/package.json
COPY --from=builder --chown=zoveli:zoveli /app/apps/cli/node_modules ./apps/cli/node_modules
COPY --from=builder --chown=zoveli:zoveli /app/apps/cli/dist ./apps/cli/dist
COPY --chown=zoveli:zoveli knowledge-vault ./knowledge-vault

RUN mkdir -p /app/data/vault /app/data/sessions /app/data/audit \
    && chown -R zoveli:zoveli /app/data

USER zoveli
ENV NODE_ENV=production \
    ZOVELI_VAULT_PATH=/app/data/vault \
    MATHCORE_AUDIT=/app/data/audit/audit.jsonl \
    ZOVELI_SESSION_PATH=/app/data/sessions

# Interactive CLI: no web port or service healthcheck is needed.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/cli/dist/cli.js"]
