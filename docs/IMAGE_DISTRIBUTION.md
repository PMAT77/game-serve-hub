# 镜像发布与副本校验

本项目以 GHCR 作为镜像的唯一官方分发源。安装器不会写入或自动选择任何第三方镜像地址；受限网络用户应按 [INSTALL.md](INSTALL.md) 的说明使用 Release 离线镜像包或自行配置镜像代理。

## 发布产物

v0.2.0 起面板（Node.js）、DST 运行库与 SteamCMD 合并为单一统一镜像（源文件见 [`docker/unified/Dockerfile`](../docker/unified/Dockerfile)）。推送 `main` 或来自 `main` 的 `v*` tag 时，GitHub Actions 会构建统一镜像并写入 candidate；candidate 成功后发布正式标签：

- `ghcr.io/pmat77/game-server-hub`

镜像保持中性（无 ENTRYPOINT/HEALTHCHECK/USER），面板入口由 compose 提供；面板运行时使用的 SteamCMD 路径为 `/home/steam/steamcmd/steamcmd.sh`。

v0.3.10 起镜像还打包了 `docker` CLI 与 compose 插件（`/usr/local/bin/docker`、`/usr/local/lib/docker/cli-plugins/docker-compose`），供面板内一键更新的 updater 容器直接使用——面板不再依赖从 Docker Hub 拉取 `docker:27-cli`，离线部署同样可以完成更新。代价是镜像增大（约 +100 MB 未压缩）；构建可用 `--build-arg DOCKER_CLI_URL=...` / `COMPOSE_PLUGIN_URL=...`（或 `DOCKER_CLI_VERSION` / `COMPOSE_VERSION`）指向可达的镜像站或制品库。

每个 `v*` Release 都会附带 `release-images.json`（记录统一镜像的不可变 digest）与离线镜像包 `game-server-hub-<tag>-docker-image.tar.gz`（含同名 SHA256）。部署与排障应以 digest 为准，不以可变的 `latest` tag 为准；GHCR 不可达时优先使用离线镜像包。

正式版本 tag 不允许覆盖；如果同名镜像已经存在，发布会在提升前整体终止并要求使用新版本号。候选镜像还会生成 provenance 与 SBOM，便于追踪来源和依赖。历史的三镜像拆分（`game-server-hub-dst`、`steamcmd-base`）自 v0.2.0 起废弃，GHCR 上的旧 package 可自行删除。
