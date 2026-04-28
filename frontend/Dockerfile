# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS deps
WORKDIR /app
# better-sqlite3 needs python + a C++ toolchain to build its native binding
# against musl on Alpine (no prebuilt for alpine).
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_MOCK_API=true
ENV NEXT_PUBLIC_MOCK_API=${NEXT_PUBLIC_MOCK_API}
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
# libstdc++ is required at runtime by the better-sqlite3 native binding.
RUN apk add --no-cache libstdc++
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
# Default DB locations inside the container; compose mounts the host files here.
ENV USERS_DB_PATH=/db/users.db
ENV PLATFORM_DB_PATH=/db/platform.db

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# distDir is "build" (see next.config.ts), so standalone server expects
# static assets at ./build/static relative to server.js.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/build/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/build/static ./build/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
