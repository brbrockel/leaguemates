# LeagueMates: one container serving the API and the built web app on port 4100.

FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY api/package.json api/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile
COPY . .
# The web app shows it in the profile menu (see the runtime stage below).
ARG APP_VERSION=dev
RUN pnpm --filter @leaguemates/shared build \
 && pnpm --filter @leaguemates/api build \
 && pnpm --filter @leaguemates/web build
# Production-only node_modules for the API, with the shared package bundled in.
RUN pnpm --filter @leaguemates/api deploy --prod --legacy /out/api \
 && rm -rf /out/api/dist /out/api/src /out/api/test \
 && cp -r api/dist /out/api/dist

FROM node:24-slim
# The release (1.0.0) or git commit, shown on problem reports, /api/health and the profile
# menu: docker build --build-arg APP_VERSION=$TAG
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    APP_VERSION=$APP_VERSION \
    PORT=4100 \
    WEB_DIST=/app/web \
    PHOTOS_DIR=/data/photos
WORKDIR /app/api
COPY --from=build /out/api ./
COPY --from=build /repo/web/dist /app/web
# Match photos: mount a volume here. Created owned by node so a new volume is writable.
RUN mkdir -p /data/photos && chown node:node /data/photos
USER node
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:4100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Apply database migrations, then start. Admin helpers: node dist/scripts/<name>.js
CMD ["sh", "-c", "node dist/src/db/migrate.js && exec node dist/src/main.js"]
