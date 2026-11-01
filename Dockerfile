# The API image: Hono server + the built PWA, served from one origin.
# Used by `docker compose --profile full` locally and by Fly (staging and production).

FROM node:22.20-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/schema/package.json packages/schema/
COPY packages/score/package.json packages/score/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter web build

FROM node:22.20-slim
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages packages
COPY apps/server apps/server
RUN pnpm install --prod --frozen-lockfile --filter server... && rm -rf /root/.cache /root/.local/share/pnpm
COPY --from=build /app/apps/web/build apps/web/build
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/apps/web/build
EXPOSE 8080
USER node
# Run from the server package so `--import tsx` resolves its own dependency.
WORKDIR /app/apps/server
CMD ["node", "--import", "tsx", "src/main.ts"]
