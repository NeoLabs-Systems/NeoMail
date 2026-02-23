# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# bcrypt and better-sqlite3 are native addons – need build tools
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine

# Non-root user for least privilege
RUN addgroup -S mailneo && adduser -S -G mailneo mailneo

WORKDIR /app

# Copy compiled node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application source (see .dockerignore for exclusions)
COPY --chown=mailneo:mailneo . .

# Persistent data directory (SQLite databases)
RUN mkdir -p /app/data && chown mailneo:mailneo /app/data
VOLUME ["/app/data"]

USER mailneo

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "server.js"]
