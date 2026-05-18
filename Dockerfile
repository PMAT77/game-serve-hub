FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm run build

FROM deps AS production
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY server/drizzle ./server/drizzle
EXPOSE 3000
ENV SERVER_HOST=0.0.0.0
ENV SERVER_PORT=3000
ENV DB_PATH=/app/data/game-server-hub.sqlite
ENV SERVER_LOG_DIR=/app/logs
CMD ["pnpm", "exec", "tsx", "server/src/main.ts"]
