FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat && corepack enable pnpm
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV PAYLOAD_SECRET=build-only-secret
ENV DATABASE_URI=file:/tmp/build.db
ENV MEDIA_DIR=/tmp/media
RUN pnpm run build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app ./
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3000
CMD ["sh", "./scripts/start.sh"]
