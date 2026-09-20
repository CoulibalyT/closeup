# syntax=docker/dockerfile:1.7
# Development image shared by the api, worker and web services. Dependencies are installed
# inside the image (Linux binaries for swc, rolldown, ...); Compose then bind-mounts only the
# source folders. The production targets arrive with the deployment phase.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=1
WORKDIR /repo

# Optional corporate root CAs for networks behind a TLS-inspecting proxy. The folder holds no
# certificate by default, which makes all of this a no-op. See docker/certs/README.md.
COPY docker/certs/ /tmp/certs/
COPY docker/entrypoint.sh /usr/local/bin/closeup-entrypoint
RUN chmod +x /usr/local/bin/closeup-entrypoint \
 && (cat /tmp/certs/*.crt > /etc/ssl/extra-ca.pem 2>/dev/null || true) \
 && rm -rf /tmp/certs
ENTRYPOINT ["closeup-entrypoint"]

RUN closeup-entrypoint corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    closeup-entrypoint pnpm install --frozen-lockfile

FROM deps AS dev
COPY . .
RUN closeup-entrypoint sh -c "pnpm build:shared \
 && pnpm --filter @closeup/api prisma:generate \
 && pnpm --filter @closeup/web nuxt:prepare"

# ---------------------------------------------------------------------------------------------
# Production. Three images out of one build: the API, the worker, and the static web files that
# Caddy serves. They share the build stage so everything is compiled exactly once.
# ---------------------------------------------------------------------------------------------

FROM deps AS build
COPY . .
RUN closeup-entrypoint sh -c "pnpm build:shared \
 && pnpm --filter @closeup/api prisma:generate \
 && pnpm --filter @closeup/api build \
 && pnpm --filter @closeup/web generate"

# Only what the two Node services need at run time: no source, no dev dependencies.
FROM base AS runtime-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    closeup-entrypoint pnpm install --frozen-lockfile --prod --filter @closeup/api...

FROM base AS api
ENV NODE_ENV=production
COPY --from=runtime-deps /repo/node_modules ./node_modules
COPY --from=runtime-deps /repo/apps/api/node_modules ./apps/api/node_modules
# pnpm keeps each workspace's own dependencies next to it: without this, shared has no zod.
COPY --from=runtime-deps /repo/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/packages/shared/package.json ./packages/shared/
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
# A fresh named volume inherits the ownership of the folder it covers, so make it the node
# user's here: the server writes crops, and it does not run as root.
RUN mkdir -p /data/media && chown -R node:node /data/media
# Prisma reads its config (and the migrations) from the app folder.
WORKDIR /repo/apps/api
USER node
CMD ["node", "dist/main.js"]

FROM api AS worker
CMD ["node", "dist/worker.js"]

# Caddy serves the built files and proxies /api to the API: one origin, so cookies need no CORS.
FROM caddy:2-alpine AS web
COPY --from=build /repo/apps/web/.output/public /srv
COPY docker/Caddyfile /etc/caddy/Caddyfile
