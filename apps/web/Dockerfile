FROM node:22.22.3-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json angular.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm ci --workspace @album/web --include-workspace-root
COPY apps/web apps/web
RUN npm run build --workspace @album/web

FROM nginx:1.28.3-alpine AS production
COPY --from=build /app/dist/web/browser /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/nginx.conf
COPY apps/web/runtime.sh /docker-entrypoint.d/40-album-runtime.sh
RUN chmod +x /docker-entrypoint.d/40-album-runtime.sh && cp /usr/share/nginx/html/index.html /opt/index.template.html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1/health || exit 1
