# 镜像发布与副本校验

本项目以 GHCR 作为镜像的唯一官方分发源。安装器不会写入或自动选择任何第三方镜像地址；受限网络用户应按 [INSTALL.md](INSTALL.md) 的说明自行配置完整镜像引用。

## 发布产物

PR 只验证构建，不推送镜像。推送 `main` 或来自 `main` 的 `v*` tag 时，GitHub Actions 会先构建三类镜像并写入 candidate；只有 candidate 全部成功后才发布以下正式标签：

- `ghcr.io/gameserverhub/game-server-hub`
- `ghcr.io/gameserverhub/game-server-hub-dst`
- `ghcr.io/gameserverhub/steamcmd-base`

`steamcmd-base` 使用项目内的 [`docker/steamcmd/Dockerfile`](../docker/steamcmd/Dockerfile)：镜像包含 32 位运行依赖、UID 1000 的 `steam` 用户，以及在构建时已完成首次更新的 SteamCMD。面板运行时使用的二进制路径固定为 `/home/steam/steamcmd/steamcmd.sh`。

每个 `v*` Release 都会附带 `release-images.json`，其中记录该版本三个 GHCR 镜像的不可变 digest。部署与排障应以该文件中的 digest 为准，不以可变的 `latest` tag 为准。

正式版本 tag 不允许覆盖；如果任意一个同名镜像已经存在，发布会在提升前整体终止并要求使用新版本号。候选镜像还会生成 provenance 与 SBOM，便于追踪来源和依赖。

## 仍待完成的下一项

离线镜像包（`docker save` + SHA-256）属于下一项发布可靠性工作。它会作为 GHCR 不可用时的恢复通道，但不会解决 SteamCMD 下载游戏文件和 Workshop Mod 时访问 Steam 的网络问题。
