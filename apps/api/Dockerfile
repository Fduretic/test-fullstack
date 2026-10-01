FROM node:22.22.3-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace @album/api --include-workspace-root
COPY apps/api apps/api
RUN npm run build --workspace @album/api

FROM node:22.22.3-bookworm-slim AS production
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --gid 10001 album && useradd --uid 10001 --gid 10001 --no-create-home album
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace @album/api --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "apps/api/dist/main.js"]
