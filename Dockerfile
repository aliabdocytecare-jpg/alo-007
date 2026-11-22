# AloDoc — single-image build (DEC-049, Option A: Express serves frontend + API).
# Stage 1 builds the React client; Stage 2 runs the Express API which serves that build.
# Same-origin: the client uses relative /api/v1 (VITE_API_URL left empty).

# ---- Stage 1: build the client ----
FROM node:20-slim AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- Stage 2: server runtime ----
FROM node:20-slim AS runtime
WORKDIR /app/server
ENV NODE_ENV=production
ENV PORT=3000
# curl is required by Coolify's Docker healthcheck (DEC-050); slim image lacks it.
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
# No native modules to compile: better-sqlite3 was removed with the local driver (DEC-054).
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
# Bring in the built client; index.js serves it (STATIC_DIR matches the default path).
COPY --from=client-build /app/client/dist /app/client/dist
ENV STATIC_DIR=/app/client/dist
EXPOSE 3000
# Coolify/Traefik health check hits /health
CMD ["node", "index.js"]