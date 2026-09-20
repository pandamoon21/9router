# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS base
WORKDIR /app
# CN mirror for apk (used by builder and runner stages)
RUN sed -i 's|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g' /etc/apk/repositories

FROM base AS builder

# No C++ toolchain. The only native dep is better-sqlite3, and it is an
# optionalDependency that npm resolves to a prebuilt musl binary — a measured
# build shows zero cc1plus/node-gyp invocations. db/driver.js falls through
# better-sqlite3 → node:sqlite (built in since Node 22.5) → sql.js anyway, so
# the compiler earns nothing. Dropping it also drops the `apk upgrade` that
# used to run the whole Alpine distro forward in both stages.

# package-lock.json is gitignored (upstream decolua made it so, fb5be37e), so a
# plain clone has none. `npm ci` needs one, and the old bare `npm install`
# re-solved the whole dependency tree whenever package.json changed — measured
# at 354s of a 734s build. install.sh / .ps1 write one next to package.json;
# this layer writes one in the image if the build context lacks it.
COPY package.json ./
RUN if [ ! -f package-lock.json ]; then npm install --package-lock-only --registry=https://registry.npmmirror.com; fi

# Copy the rest of the source, then the lockfile last: the heavy `npm ci` layer
# below then only busts when the lockfile itself changes, not on every source
# edit.
COPY . ./
COPY package-lock.json* ./

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm ci --registry=https://registry.npmmirror.com && npm run build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app

LABEL org.opencontainers.image.title="9router"

ENV NODE_ENV=production
ENV PORT=20128
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATA_DIR=/app/data

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/custom-server.js ./custom-server.js
COPY --from=builder /app/open-sse ./open-sse
# Next file tracing can omit sibling files; MITM runs server.js as a separate process.
COPY --from=builder /app/src/mitm ./src/mitm
# Standalone node_modules may omit deps only required by the MITM child process.
COPY --from=builder /app/node_modules/node-forge ./node_modules/node-forge
# Ensure `next` is available at runtime in case tracing did not include it.
COPY --from=builder /app/node_modules/next ./node_modules/next
# sql.js loads dist/sql-wasm.wasm by path at runtime; tracing only follows JS imports,
# so the last-resort DB driver would abort with ENOENT on the missing binary.
COPY --from=builder /app/node_modules/sql.js ./node_modules/sql.js
# node-machine-id is createRequire-loaded at runtime; tracing omits it.
COPY --from=builder /app/node_modules/node-machine-id ./node_modules/node-machine-id

RUN mkdir -p /app/data && chown -R node:node /app && \
  mkdir -p /app/data-home && chown node:node /app/data-home && \
  ln -sf /app/data-home /root/.9router 2>/dev/null || true

# Fix permissions at runtime (handles mounted volumes)
RUN apk --no-cache add su-exec && \
  printf '#!/bin/sh\nchown -R node:node /app/data /app/data-home 2>/dev/null\nexec su-exec node "$@"\n' > /entrypoint.sh && \
  chmod +x /entrypoint.sh

EXPOSE 20128

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "custom-server.js"]
