# BudgetBrain container image: one Express process that serves the API and
# the built React client from the same origin (see server/src/app.ts), the
# same shape as the Render deployment. Used by the docker-smoke CI job and
# by the AWS deployment (ECR + ECS Express Mode, see infra/).

# ---- Build stage: compile the server (tsc) and the client (Vite) ----------
FROM node:24-slim AS build
WORKDIR /app

# Manifests first, so the dependency layer is cached until they change.
COPY package.json ./
COPY client/package.json client/
COPY server/package.json server/

# Same fix as ci.yml: the committed package-lock.json was written on macOS
# and only pins the darwin builds of Rollup and esbuild, so the Vite build
# fails on Linux with it. There is no lockfile in this stage on purpose;
# npm resolves the Linux binaries fresh.
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

# ---- Runtime stage: server production dependencies + build output only ---
FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    PORT=3001
WORKDIR /app

# The lockfile IS used here: it pins every server runtime dependency,
# including libSQL's Linux binaries, and --workspace=server installs only
# the server's production dependencies (no React, Three.js or Vite).
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --omit=dev --workspace=server --no-audit --no-fund \
    && npm cache clean --force

COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist

# Without Turso settings the server falls back to a local SQLite file in
# server/data, and Gemini call logs go to server/logs; the non-root user
# needs to be able to write to both.
RUN mkdir -p server/data server/logs && chown -R node:node server/data server/logs
# The node image's built-in "node" user, by numeric id so any runtime can
# verify it isn't root without resolving names.
USER 1000:1000

EXPOSE 3001

# For `docker run` and the CI smoke job. On AWS the load balancer's own
# health check on /api/health is what counts.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "server/dist/index.js"]
