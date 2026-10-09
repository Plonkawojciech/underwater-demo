FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat && corepack enable pnpm
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV PAYLOAD_SECRET=isolated-build-placeholder-never-a-runtime-secret
ENV UNDERWATER_ENVIRONMENT=build
ENV UNDERWATER_DATA_ROOT=/tmp/underwater-build
ENV DATABASE_URI=file:/tmp/underwater-build/underwater-build.db
ENV MEDIA_DIR=/tmp/underwater-build/media
ENV NEXT_PUBLIC_SERVER_URL=https://underwater-demo.programo.pl
RUN mkdir -p /tmp/underwater-build/media
RUN pnpm run build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder --chown=node:node /app ./
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=5 CMD ["node", "scripts/health.mjs"]
CMD ["sh", "./scripts/start.sh"]
