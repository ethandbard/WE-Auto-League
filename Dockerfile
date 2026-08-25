# Multi-stage build: install once, build client + server, then run with
# only production dependencies in the final image. Mirrors ../pokemon-crm.
FROM node:20-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

COPY server server
COPY client client
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci --omit=dev

COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/drizzle server/drizzle
COPY --from=build /app/client/dist client/dist
# Seed reads fixtures/june-2026-full.json from the repo root. The runtime image
# has no tsx, so first-deploy seed is `node server/dist/scripts/seed.js`.
COPY fixtures fixtures

EXPOSE 4000
CMD ["node", "server/dist/index.js"]
