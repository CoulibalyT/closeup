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
