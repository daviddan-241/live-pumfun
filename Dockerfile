# ARCC Telegram Intelligence & Publishing System
# Multi-stage Dockerfile for Render deployment

# Stage 1: Build
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies for build)
RUN npm install

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/

# Compile TypeScript
RUN npm run build

# Stage 2: Runtime
FROM node:20-slim AS runtime

WORKDIR /app

# Install better-sqlite3 native dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json package-lock.json* ./

# Install production dependencies only
RUN npm install --omit=dev

# Copy compiled code
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/dashboard/public ./src/dashboard/public

# Create data and logs directories
RUN mkdir -p /app/data/media /app/logs

# Expose dashboard port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# Start the application
CMD ["node", "dist/index.js"]
