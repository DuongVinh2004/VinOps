# ==============================================================================
# VinOps GIS & Drone Orthophoto Worker Container
# Multi-stage build with Node.js 22 + GDAL 3.9 + PROJ 9
# ==============================================================================

FROM node:24-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.15.1 --activate

# Copy dependency definitions
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json ./packages/config/
COPY packages/database/package.json ./packages/database/
COPY packages/domain/package.json ./packages/domain/
COPY packages/file/package.json ./packages/file/
COPY packages/observability/package.json ./packages/observability/
COPY apps/worker/package.json ./apps/worker/

RUN pnpm install --frozen-lockfile

# Copy source code and build
COPY packages/ ./packages/
COPY apps/worker/ ./apps/worker/
COPY tsconfig*.json ./

RUN pnpm --filter @vinops/worker run build

# Runtime Stage with minimal GDAL and PROJ binaries
FROM node:24-slim AS runner

WORKDIR /app

# Install GDAL C++ binaries & PROJ database
RUN apt-get update && apt-get install -y --no-install-recommends \
    gdal-bin \
    libgdal-dev \
    proj-bin \
    proj-data \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PROJ_LIB=/usr/share/proj \
    GDAL_DATA=/usr/share/gdal \
    CPL_ZIP_ENCODING=UTF-8 \
    VSI_CACHE=TRUE \
    VSI_CACHE_SIZE=67108864

RUN corepack enable && corepack prepare pnpm@11.15.1 --activate

COPY --from=builder /app /app

WORKDIR /app/apps/worker

USER node

CMD ["node", "dist/main.js"]
