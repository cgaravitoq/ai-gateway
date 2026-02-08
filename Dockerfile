ARG BUN_VERSION=1.2.4
FROM oven/bun:${BUN_VERSION} AS base
WORKDIR /usr/src/app

# --- Install dependencies ---
FROM base AS install

# Install dev dependencies (for type checking, etc.)
RUN mkdir -p /temp/dev
COPY package.json bun.lock /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

# Install production dependencies only
RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# --- Build / type-check stage ---
FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .

# --- Production image ---
FROM base AS release
COPY --from=install /temp/prod/node_modules node_modules
COPY --from=prerelease /usr/src/app/src src/
COPY --from=prerelease /usr/src/app/package.json .
COPY --from=prerelease /usr/src/app/tsconfig.json .

# Run as non-root
USER bun
EXPOSE 3000/tcp

ENTRYPOINT ["bun", "run", "src/index.ts"]
