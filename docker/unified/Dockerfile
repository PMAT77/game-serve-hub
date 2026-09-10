# syntax=docker/dockerfile:1
# Game Server Hub 统一镜像：面板（Node.js）+ DST 运行库 + SteamCMD。
#
# 镜像保持「中性」：不设 ENTRYPOINT / HEALTHCHECK / USER ——
# - 面板入口由 docker-compose.yml 的 command 提供（与镜像 CMD 一致）；
# - DST 实例容器由面板显式传入 Cmd（绝对路径二进制，见 runtime-spec.ts）；
# - SteamCMD 任务容器由面板显式传入 Cmd 与 User（1000:1000，见 steamcmd-job.ts），
#   且创建时显式 WorkingDir=/home/steam/steamcmd（该目录属主 uid/gid 1000）。
# 基础镜像 node:22-bookworm-slim 自带 uid 1000（node 用户），SteamCMD 目录直接
# 以数值 uid/gid 1000 授权，passwd 名称不影响容器运行。
#
# 层顺序：node 基础 → 系统库+SteamCMD（极少变化）→ node_modules（依赖变化才变）
# → 应用代码（每次发版）。面板小更新只需拉取最后一层。
FROM node:22-bookworm-slim AS base
# 容器无 TZ 默认 UTC；计划任务 daily「每日 HH:MM」按服务器本地时区计算，不设时区会被
# 换算成 UTC 相位。DST/SteamCMD 子容器继承镜像 ENV，此处一并修正。
# 运行时可用 environment TZ 覆盖；Node 用内置 ICU 解析时区名，无需安装 tzdata。
ARG TZ=Asia/Shanghai
ENV TZ=${TZ}
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

# 运行时基础：Debian 12 + DST 32 位运行库 + SteamCMD（构建期 SHA256 强校验与自检）。
FROM base AS runtime
ARG GSH_RELEASE_VERSION=dev
ARG GSH_BUILD_SHA=unknown
ARG STEAMCMD_ARCHIVE_URL=https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
ARG STEAMCMD_ARCHIVE_SHA256=
LABEL org.opencontainers.image.title="Game Server Hub unified runtime"
LABEL org.opencontainers.image.description="Game Server Hub panel, DST runtime libraries and SteamCMD in one image"
LABEL org.opencontainers.image.source="https://github.com/PMAT77/game-serve-hub"
LABEL org.opencontainers.image.version="${GSH_RELEASE_VERSION}"
LABEL org.opencontainers.image.revision="${GSH_BUILD_SHA}"

RUN dpkg --add-architecture i386 \
  && apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    lib32gcc-s1 \
    lib32stdc++6 \
    libc6-i386 \
    libcurl3-gnutls \
    libcurl4 \
    libcurl4:i386 \
    libgcc-s1 \
    libstdc++6 \
  && install -d -m 0755 -o 1000 -g 1000 /home/steam /home/steam/steamcmd \
  && curl --fail --location --retry 3 --retry-delay 2 --output /tmp/steamcmd.tar.gz "${STEAMCMD_ARCHIVE_URL}" \
  && if [ -n "${STEAMCMD_ARCHIVE_SHA256}" ]; then echo "${STEAMCMD_ARCHIVE_SHA256}  /tmp/steamcmd.tar.gz" | sha256sum --check --strict; fi \
  && tar --extract --gzip --file /tmp/steamcmd.tar.gz --directory /home/steam/steamcmd \
  && chown -R 1000:1000 /home/steam \
  && for attempt in 1 2 3; do \
    if setpriv --reuid 1000 --regid 1000 --clear-groups env HOME=/home/steam /home/steam/steamcmd/steamcmd.sh +quit; then break; fi; \
    if [ "${attempt}" = 3 ]; then exit 1; fi; \
    sleep 5; \
  done \
  && rm -rf /var/lib/apt/lists/* /tmp/steamcmd.tar.gz

# DST 实例容器内默认游戏根目录（游戏二进制由 SteamCMD 安装到挂载卷）。
ENV GAME_ROOT=/game

FROM runtime AS production
ARG GSH_RELEASE_VERSION=dev
ARG GSH_BUILD_SHA=unknown
ENV NODE_ENV=production
ENV GSH_RELEASE_VERSION=${GSH_RELEASE_VERSION}
ENV GSH_BUILD_SHA=${GSH_BUILD_SHA}
WORKDIR /app
# node_modules 单独成层：依赖不变时面板发版只重建下方应用代码层。
# 服务端已 esbuild 打包（node_modules 全 external，运行时复用依赖层），node 直跑不再经 tsx。
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY server/drizzle ./server/drizzle
EXPOSE 8888
ENV SERVER_HOST=0.0.0.0
ENV SERVER_PORT=8888
ENV DB_PATH=/app/data/game-server-hub.sqlite
ENV SERVER_LOG_DIR=/app/logs
# 面板入口即镜像默认命令；DST/SteamCMD 子容器会以面板显式 Cmd 覆盖。
CMD ["node", "dist-server/main.js"]
