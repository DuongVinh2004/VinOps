# Multi-stage build for VinOps Web Client (Vite + Nginx Alpine)
FROM node:24-alpine AS builder

WORKDIR /app

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

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy application source code
COPY apps/web/ ./apps/web/
COPY packages/ ./packages/

# Build web client and its workspace dependencies
RUN pnpm --filter=@vinops/web... build

# Web Serving Stage: Nginx Alpine
FROM nginx:alpine AS runner

# Remove default nginx static assets and config
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf

# Copy custom Nginx reverse proxy configuration
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built SPA assets
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
