# FDS-00：平台安装与运行时

- 里程碑：M0
- 优先级：P0
- 状态：已实现（M0 已完成，2026-05-19）

## 1. 背景与目标

提供可复制的安装与运行时底座，确保面板可控地管理 DST 实例生命周期；并支持 Hub 面板镜像与 DST 运行镜像的版本检测与一键更新。

## 2. 角色与前置条件

- 角色：服务器管理员
- 前置：Docker 可用，主机具备基础网络与磁盘资源；生产部署需配置 `GSH_STACK_DIR` 与 compose 文件目录

## 3. 功能范围

- 安装脚本与 Compose 启动
- 运行时连接与健康检查
- Docker 镜像拉取与容器操作封装
- Hub 面板 / DST 运行镜像更新检测与一键更新（Community）

## 4. 功能清单

- Linux 安装脚本（Community）
- Compose 开发与部署模式（Community）
- 运行时探活与错误反馈（Community）
- Hub 镜像版本检测（GHCR digest + GitHub Release 展示）（Community）
- Hub 镜像一键更新（compose updater 容器）（Community）
- 运行时安全加固（Pro 规划）

## 5. 接口与输入输出

- 输入：环境变量、安装路径、镜像参数、面板设置（`autoUpdate`、`updateCheckIntervalHours`）
- 输出：服务可访问、运行时状态可查询、更新状态缓存
- 相关接口：
  - `/health`、`/api/meta/runtime`
  - `GET /app/system/panel-update/status` — 返回 panel/dst 当前与远端 digest、Release 信息、`lastCheckedAt`、`checking`、`applySupported`
  - `POST /app/system/panel-update/check` — 手动触发检查
  - `POST /app/system/panel-update/apply` — body `{ targets?: ['panel','dst'] }`，默认更新所有有新版的目标

### 5.1 环境变量（生产）

| 变量 | 说明 |
|------|------|
| `PANEL_IMAGE` | 面板容器镜像引用 |
| `GSH_GAME_DST_IMAGE` | DST 运行镜像引用 |
| `GSH_STACK_DIR` | compose 与 `panel.env` 所在宿主机目录（如 `/opt/game-server-hub`） |
| `GSH_COMPOSE_FILES` | 冒号分隔的 compose 文件名（如 `docker-compose.yml:docker-compose.bind.yml`） |
| `GSH_PANEL_CONTAINER_NAME` | 面板容器名 |
| `GSH_GITHUB_REPO` | GitHub 仓库（默认 `PMAT77/game-server-hub`），用于 Release 展示 |
| `GSH_RELEASE_VERSION` | 构建时注入的面板版本号 |

## 6. 业务规则

- 运行时不可用时，实例操作必须拒绝并提示原因。
- 安装流程失败时保留可排障信息。
- 运行时统一走容器模型，不允许隐式宿主机直启分叉。
- **更新检测**：服务端定时轮询（默认 1 小时，`autoUpdate=true` 时启用）；比较本地镜像 digest 与 GHCR 远端 manifest digest。
- **展示版本**：优先 `GSH_RELEASE_VERSION` / OCI label；辅以 GitHub Release tag 与 body 摘要。
- **Apply 面板**：通过一次性 `docker:cli` updater 容器执行 `compose pull panel && compose up -d panel`；面板进程会短暂中断。
- **Apply DST**：`force pull` DST 镜像；不重启已运行实例，下次启动实例时使用新运行环境。
- **Apply 限制**：未配置 `GSH_STACK_DIR` 或 compose 文件缺失时禁止 panel apply，返回手动命令；更新进行中禁止重复 apply。
- **开发模式**（`dev:compose` / 无 stack dir）：允许检查版本，禁止 panel apply。

## 7. 异常与边界

- Docker 未启动 -> 返回业务错误并中断实例关键操作
- 镜像拉取失败 -> 支持重试并记录日志
- 目录不可写 -> 安装中断并回传明确错误
- DST 运行镜像缺少 `libcurl-gnutls.so.4` -> 实例启动失败；`docker/game-dst` 须安装 `libcurl3-gnutls`，发版前 rebuild 并 push `GSH_GAME_DST_IMAGE`
- GHCR / GitHub 不可达 -> 检查失败但不影响运行；status 标记 `checkError`
- 私有 GHCR -> 需宿主机 `docker login`；digest 检查可能失败并提示

## 8. 非功能要求

- 安装流程可观测（日志可追踪）
- 运行时错误可定位（错误码 + requestId）
- 更新检查不得在实例列表等高频轮询中触发 pull

## 9. 验收标准

- 安装脚本可完成基础部署
- 后端可探测运行时状态
- 实例生命周期链路可依赖该运行时执行
- digest 不一致时 status 标记 `updateAvailable`
- 仅 DST 有更新时 apply 只 pull DST，不重启面板
- 仅 panel 有更新时 apply 触发 compose updater
- GHCR 不可达时返回明确 `checkError` 且服务仍可用
- 设置页可手动检查更新并展示 Release 摘要

## 10. 后续里程碑

- 增强运行时诊断与自恢复
- 增强镜像渠道与安全校验
- CI 自动创建 GitHub Release
