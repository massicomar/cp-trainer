# syntax=docker/dockerfile:1

# ---- build: compile TypeScript + Vite assets, then install prod deps -------
FROM node:24-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 ships prebuilt binaries; these are only used if it has to
# compile from source (e.g. no prebuild for this Node/arch combination).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN node ace build

WORKDIR /app/build
RUN npm ci --omit=dev

# ---- runtime ----------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/build ./

# The SQLite volume mounts here. Creating it owned by `node` makes a fresh
# named volume inherit that ownership instead of root's.
RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 3333
# Migrations must succeed. A failed content sync (bad files in the content
# repo) is logged but doesn't block startup: the app keeps serving the last
# content that synced cleanly.
CMD ["sh", "-c", "node ace migration:run --force && { node ace content:sync || echo 'content:sync failed; serving the last synced content' >&2; } && exec node bin/server.js"]
