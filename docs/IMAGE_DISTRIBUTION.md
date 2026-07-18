# 镜像发布与副本校验

本项目以 GHCR 作为镜像的权威来源。维护者可将镜像复制到个人 ACR 做测试和副本校验，但 ACR 不是公开用户分发源，不会写入安装脚本默认配置，也不会被安装器自动选择。

## 发布产物

推送 `main` 或 `v*` tag 时，GitHub Actions 会构建并发布以下镜像：

- `ghcr.io/gameserverhub/game-server-hub`
- `ghcr.io/gameserverhub/game-server-hub-dst`
- `ghcr.io/gameserverhub/steamcmd-base`

`steamcmd-base` 使用项目内的 [`docker/steamcmd/Dockerfile`](../docker/steamcmd/Dockerfile)：镜像包含 32 位运行依赖、UID 1000 的 `steam` 用户，以及在构建时已完成首次更新的 SteamCMD。面板运行时使用的二进制路径固定为 `/home/steam/steamcmd/steamcmd.sh`。

每个 `v*` Release 都会附带 `release-images.json`，其中记录该版本三个 GHCR 镜像的不可变 digest。部署与排障应以该文件中的 digest 为准，不以可变的 `latest` tag 为准。

## ACR 作为维护者私有副本

若配置了以下 GitHub Actions 配置，发布工作流会在 GHCR 发布成功后复制同一镜像到 ACR，并比较源与目标 digest：

| 类型 | 名称 | 说明 |
|---|---|---|
| Secret | `ACR_REGISTRY` | ACR 实例公网域名；新个人版应填写实际分配的 `crpi-...personal.cr.aliyuncs.com` 域名，不要假定通用域名。 |
| Variable | `ACR_NAMESPACE` | ACR 命名空间，未设置时为 `game-server-hub`。 |
| Secret | `ACR_USERNAME` | 仅用于向目标命名空间推送的专用 RAM 身份。 |
| Secret | `ACR_PASSWORD` | 上述身份的 Registry 密码；不得提交到仓库、写入安装脚本或写入镜像。 |
| Variable（可选） | `STEAMCMD_ARCHIVE_SHA256` | SteamCMD 官方归档的 SHA-256。设置后构建会强制校验归档；更新该值前须先独立核验官方归档。 |

未配置 ACR 凭据时，镜像发布仍会成功，ACR 同步任务会明确显示为跳过。这保证个人 ACR 不会阻塞正式 Release，也不会影响任何 GitHub 用户安装。

同步规则：

- `latest` 与 `main` 可移动，但每次同步后必须与 GHCR digest 相同。
- `v*` 等发布 tag 一旦已存在且 digest 不同，工作流会失败而不是覆盖它。
- ACR 复制使用 registry-to-registry 的 manifest copy，不依赖重新构建或本地 `docker pull/tag/push`。

发布后维护者应确认：GitHub Release 中的 `release-images.json`、GHCR tag 与 ACR tag 的 digest 一致。ACR 故障或未配置不会改变 GHCR 发布结果；用户如需镜像副本，应自行配置完整镜像引用。

## 仍待完成的下一项

离线镜像包（`docker save` + SHA-256）属于下一项发布可靠性工作。它会作为 GHCR 与 ACR 均不可用时的恢复通道，但不会解决 SteamCMD 下载游戏文件和 Workshop Mod 时访问 Steam 的网络问题。
