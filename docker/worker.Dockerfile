# Multi-stage build for VinOps NestJS Worker
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
COPY apps/worker/ ./apps/worker/
COPY packages/ ./packages/
COPY scripts/ ./scripts/

# Build required packages and Worker
RUN pnpm --filter=@vinops/worker... build

ENV CI=true

# Remove development dependencies for smaller image
RUN pnpm prune --prod

# Production Runner Stage
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    VINOPS_WORKER_NAME=vinops-worker-prod

# Copy runtime assets and built files from builder
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/worker/package.json ./apps/worker/
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist

# Ensure web-ifc WASM binaries are available in root and dist for runtime resolution
RUN mkdir -p /app/wasm && \
    find /app/node_modules -name "web-ifc*.wasm" -exec cp {} /app/apps/worker/dist/ \; 2>/dev/null || true

# Secure container: run as non-root user 'node'
USER node

CMD ["node", "apps/worker/dist/main.js"]
