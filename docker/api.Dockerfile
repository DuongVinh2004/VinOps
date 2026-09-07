# Multi-stage build for VinOps NestJS API
FROM node:24-alpine AS builder

WORKDIR /app

# Enable Corepack and activate pinned pnpm
RUN corepack enable && corepack prepare pnpm@11.15.1 --activate

# Copy monorepo manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/
COPY packages/config/package.json ./packages/config/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/database/package.json ./packages/database/
COPY packages/domain/package.json ./packages/domain/
COPY packages/file/package.json ./packages/file/
COPY packages/observability/package.json ./packages/observability/

# Install all dependencies (frozen lockfile)
RUN pnpm install --frozen-lockfile

# Copy application source code
COPY apps/api/ ./apps/api/
COPY packages/ ./packages/
COPY scripts/ ./scripts/

# Build required packages and API
RUN pnpm --filter=@vinops/api... build

ENV CI=true

# Remove development dependencies for smaller image
RUN pnpm prune --prod

# Production Runner Stage
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    VINOPS_API_HOST=0.0.0.0 \
    VINOPS_API_PORT=3000

# Copy runtime assets and built files from builder
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Secure container: run as non-root user 'node'
USER node

EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health/live || exit 1

CMD ["node", "apps/api/dist/main.js"]
