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
RUN pnpm run build && pnpm run build:server

FROM deps AS production
ARG GSH_RELEASE_VERSION=dev
ARG GSH_BUILD_SHA=unknown
ENV NODE_ENV=production
ENV GSH_RELEASE_VERSION=${GSH_RELEASE_VERSION}
ENV GSH_BUILD_SHA=${GSH_BUILD_SHA}
LABEL org.opencontainers.image.version="${GSH_RELEASE_VERSION}"
LABEL org.opencontainers.image.revision="${GSH_BUILD_SHA}"
WORKDIR /app
COPY --from=build /app/dist ./dist
# 服务端已 esbuild 打包（node_modules 全 external，运行时复用 deps 层依赖），node 直跑不再经 tsx
COPY --from=build /app/dist-server ./dist-server
COPY server/drizzle ./server/drizzle
EXPOSE 3000
ENV SERVER_HOST=0.0.0.0
ENV SERVER_PORT=3000
ENV DB_PATH=/app/data/game-server-hub.sqlite
ENV SERVER_LOG_DIR=/app/logs
# 镜像内无 curl/wget，用 node 内置 fetch 探活 /health
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SERVER_PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# 注：暂不以 USER node 运行。docker.sock 的宿主 gid 因发行版而异（Debian 999 / 官方镜像 root），
# 非 root 需要 entrypoint 动态调组或 compose group_add，且 /app/data、/app/logs 绑定挂载
# 需要属主匹配；该部署模型变更需真实环境矩阵验证后再启用。
CMD ["node", "dist-server/main.js"]
