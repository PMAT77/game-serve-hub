# Changelog

本文件记录面向用户的版本变更，格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 新增「存档导入」：将外部 Klei DST 集群存档目录（支持集群目录、`DoNotStarveTogether/<用户ID>/Cluster_N` 等层级）一键导入为指定实例的世界存档。导入前自动创建「导入前」安全备份；世界数据与房间设置保留源档，端口自动重写为本实例配置并同步数据库，避免多实例端口冲突；源档 Mod 反向写入面板 Mod 列表（`pre_import` 备份类型，工作坊内容缺失时提示）；导入与恢复共用实例级互斥锁。入口在「备份与恢复」页。

- 新增「备份与恢复」：实例存档一键备份/恢复（klei-storage 全量 tar.gz）、流式下载、保留策略（默认每实例 10 份）、更新/删除实例前自动备份钩子；面板 SQLite 数据库快照（VACUUM INTO，默认保留 5 份）。恢复前自动创建安全备份，运行中实例拒绝恢复。配套新增 `ops:read`/`ops:manage` 权限点与导航「备份与恢复」页。

### Changed

- 后端默认监听端口从 `3000` 迁移至 `8888`（避免与本机常驻开发环境服务冲突，详见 `docs/DEVELOPMENT.md` 已知问题）；生产安装的对外端口仍为 `9527`（安装脚本显式写入 `SERVER_PORT`），不受影响。

- 新增 Docker / Native systemd 双运行时；Native 模式下的面板、SteamCMD 和 DST 分片均不依赖 Docker。
- Linux 安装器新增 `--mode auto|docker|native` 与 `--network auto|cn|global`，支持国内 apt 镜像、SteamCMD 重试和多源安装资源回退。
- GitHub Release 流程新增 Linux x64 Native 包与同名 SHA256 文件。
- 新增中文架构、双模式安装、升级回滚与按错误关键词排查文档。

### Changed

- 监控与 SteamCMD 页面改用通用运行时语义，不再假定 Docker。
- 同模式重跑安装器改为原地升级：保留 `panel.env`，并在升级前备份 SQLite 与部署配置。
- **破坏性**：新增 `GSH_INSTALL_PATH_POLICY`（默认 `instances-root`），创建实例的安装路径必须位于 `GSH_INSTANCES_ROOT` 之下；确需自定义目录请显式设置 `GSH_INSTALL_PATH_POLICY=any` 并自行承担隔离风险。既有实例不受影响，可继续启动与删除。
- **破坏性**：Node.js 引擎要求收敛为 `^22.13.0 || >=24`。后端使用 Node 内置 `node:sqlite`，Node 20 无法启动后端，此前文档标注的 `^20.19` 支持不成立。
- **公告补记**：0008 迁移（随 v0.1.4 发布）会把全部已启用的实例 Mod 强制禁用（`UPDATE instance_mods SET enabled = 0`），需要手动重新启用；此行为此前未在变更记录中说明。0010 迁移已把 `instance_mods.enabled` 默认值修正为 0，此后新加入的 Mod 默认禁用。

### Fixed

- 清除 Native 安装、资源快照、定时更新检查中的隐式 Docker 依赖。
- 修复已有前端类型错误，使完整 `vue-tsc` 与生产构建重新通过。
- 新增 0010 迁移补账全部影子 schema（`auth_sessions` 7 列、`game_instances` 12 列、`users.must_change_password`、维护公告两张表），并在 CI 增加 `drizzle-kit generate` 无差异门禁，防止迁移与 schema 再次漂移。
- 修复删除实例的顺序：先删数据库记录再清理磁盘目录，目录清理失败只告警，不再出现“记录仍在、文件已没”的不一致状态。
- **公告补记**：修正安装器内置 `docker-compose.yml` 校验和（`eb30aeae…` → `a34665e2…`）。旧 pin 与 tag 内文件 blob 不匹配，v0.1.4 的 Docker 安装在默认严格校验（`STRICT_INSTALLER_ASSET_CHECKSUM=1`）下会因校验失败中止；此前未被发现是因为 `install-linux-smoke.sh` 直接哈希工作区文件，Windows CRLF 检出下不会暴露真实差异。smoke 现已先归一化为 LF 再校验。
- 修复"取消安装后立即重新安装"竞态：取消不再提前清除进行中标记，取消与完成两个方向的终态写入均加前置状态守卫，任何一方都不会覆盖另一方的结果。
- SteamCMD 排队任务在获得锁时检查取消标记：排队期间被取消的任务直接跳过执行，且不再污染后续重试。
- Docker 日志 follow 流补齐销毁逻辑并接入中止信号，消费方退出时不再泄漏 docker 连接句柄。
- `updateGameInstanceRuntime` 支持 `whereStatus` 前置状态守卫，安装管线全部终态写入接入。
- 登录限流、找回/改密失败计数落 SQLite（新增 `auth_rate_limits` 表，0011 迁移），面板重启后限流状态不再清零，表容量由定期清理保证有界。
- 业务模块不再直接实例化 dockerode，统一经 infra 层 `createDockerClient` 工厂获取客户端。
- CI 质量门禁新增 release 引用一致性校验与生产构建（含服务端打包）；镜像新增 `HEALTHCHECK`（node fetch 探活 `/health`）。
- 服务端新增 esbuild 打包（`pnpm run build:server`）：Docker 镜像 production 阶段复用打包产物，`node` 直跑不再经 tsx 转译，镜像不再拷贝 server/shared 源码；运行时仓库资源（迁移目录、前端产物、DST leveldata 模板）改为从部署根统一探测定位。
- 说明：镜像暂不以非 root 用户运行——docker.sock 的宿主 gid 因发行版而异，非 root 需 entrypoint 动态调组或 compose `group_add`，且数据/日志绑定挂载需属主匹配，待部署矩阵验证后启用。
- 修复 Mod 管理在快速切换实例时旧实例响应覆盖新实例列表的竞态。
- 引入 oxlint 静态检查（`pnpm run lint:ox`，CI 以 `--deny-warnings` 门禁），清零全部告警：未用导入、多余展开拷贝、正则冗余转义等。

### Security

- Compose 安装资源使用安装器内置 SHA256，校验过程不再强制二次访问 GitHub Raw。
- Native systemd 服务采用专用无登录用户、只读 Release、受限可写路径和权限受控的控制台 FIFO。
- 登录限流不再无条件信任 `X-Forwarded-For`：仅当连接对端命中 `GSH_TRUST_PROXY` 配置的可信代理列表时才采信，并新增不可伪造的 socket 地址限流维度，阻断伪造请求头的密码喷洒。
- 自动生成的管理员初始密码不再写入日志，改为写入数据库同目录的 `admin-credentials.txt`（0600 权限），首次登录改密后自动删除。
- 前端“记住我”不再把明文密码写入 localStorage（历史遗留值会在下次访问登录页时自动清除），密码请交给浏览器密码管理器。
- 安装器写入 `panel.env` 改为 printf 逐行写入后原子落盘：环境变量传入的凭证含 `$`、反引号、引号时不再被 shell 展开破坏。
- 镜像发布流水线强制要求仓库变量 `STEAMCMD_ARCHIVE_SHA256` 非空，拒绝发布未校验的 SteamCMD 二进制。
- 安装器管理员密码回退生成改用 `/dev/urandom`（约 128 bit 熵），移除秒级时间戳弱熵回退。
- 找回密码接口新增找回口令哈希维度的失败封锁：攻击者更换 IP 也无法对同一口令持续爆破，超限后该口令在窗口内临时失效。
- CORS 反射任意 Origin（`CORS_ORIGIN=true/*`）时自动禁用凭据，消除"反射 + 凭据"组合放行任意站点携带凭据跨域调用的风险。

## [0.1.4] - 2026-07-26

### Changed

- Linux 一键安装默认预拉 SteamCMD 镜像；首次打开面板即可创建实例，仍可通过 `INSTALL_STEAMCMD_IMAGE=0` 跳过预拉。
- 实例创建流程不再要求管理员先到镜像管理页手动拉取 SteamCMD；后端统一确保容器运行时就绪。
- CI 在 PR 与 `main` 推送时仅执行轻量质量检查；生产构建、GHCR 镜像发布与 GitHub Release 仅在 `v*` Release tag 时执行。
- Release 成功后自动清理本次 candidate 镜像，避免 GHCR 存储累积。

### Security

- 所有 GitHub Actions 均固定到完整 commit SHA，并保留来源版本注释，避免可变 Action tag 改写发布行为。

## [0.1.3] - 2026-07-18

### Changed

- 容器发布改为构建验证、candidate 推送、完整镜像集提升三个阶段，正式 tag 不再边构建边发布。
- 移除公开 CI/CD 中的个人 ACR 同步链路；GHCR 是唯一官方镜像源。
- CI 合并为单次依赖安装的 `Quality Gate`，同时保留类型检查、233 项单测与生产构建。

### Security

- Release tag 必须匹配 `package.json`、存在 Changelog 条目并指向已经合并进 `main` 的提交。
- 正式镜像附带 provenance、SBOM 与 `release-images.json` digest 清单，且禁止覆盖已有 tag。

## [0.1.2] - 2026-07-18

> 发布失败：仅部分镜像 tag 写入 GHCR，不可作为安装版本。

### Fixed

- SteamCMD 镜像构建时的预热步骤在 Valve 服务出现短暂网络故障时自动重试，避免取消同批镜像发布。

## [0.1.1] - 2026-07-18

> 发布失败：三类镜像未形成完整集合，不可作为安装版本。

### Added

- 发布 SteamCMD 基础镜像，并将面板、DST、SteamCMD 三类镜像纳入同一个 Release 与 digest 清单。

### Changed

- 生产安装默认锁定同一个不可变 Release 的安装资源与镜像，不再默认使用可变的 `latest`。

## [0.1.0] - 2026-06-06

首个带版本号与 CI 门禁的公测发行版。

### Added

- **CI 质量门禁**：PR / `main` 推送自动执行 `lint`、`test:unit` 与生产构建（[`.github/workflows/ci.yml`](.github/workflows/ci.yml)）
- **社区基础设施**：`CONTRIBUTING.md`、`SECURITY.md`、`CODE_OF_CONDUCT.md`、`docs/RELEASE.md`
- **Issue / PR 模板**：Bug、功能建议、使用提问
- **Dependabot**：npm 与 GitHub Actions 每周依赖更新检查
- 强制改密页 `/force-change-password` 与完整拦截流程
- 共享宿主机指标模块 `server/src/shared/host-metrics.ts`
- 实例管理页拆分：`InstanceInstallLogModal`、`useInstanceRuntimeObservability`
- 安全与配置相关单测（强制改密、CORS、生产密码、宿主机指标）

### Changed

- `FORCE_PASSWORD_CHANGE=1` 时首次登录须完成改密后方可进入面板（不再仅 toast 提示）
- 生产环境 CORS 默认同源（`false`）；开发环境默认允许跨域，可通过 `CORS_ORIGIN` 配置白名单
- `node` 与 `system` 模块共用宿主机 CPU/磁盘采样状态
- README / INSTALL / 模块文档与 Mod、占位模块实现状态对齐

### Security

- 生产环境未配置 `ADMIN_PASSWORD` 时自动生成强随机密码并写入启动日志
- 生产初始化不再种子化 `superadmin/123456` 弱密码演示账号
- 未改密用户访问受保护 API 返回 `AUTH_FORCE_PASSWORD_CHANGE`

## [0.0.0] - 公测基线

首个公开仓库版本，核心能力：

- Linux 一键安装与 Docker Compose 部署
- DST 实例生命周期、监控台、控制台
- DST 房间 / 世界 / Mod 管理
- 面板与 DST 镜像 GHCR 发布（`v*` tag）

[Unreleased]: https://github.com/PMAT77/game-serve-hub/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/PMAT77/game-serve-hub/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/PMAT77/game-serve-hub/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/PMAT77/game-serve-hub/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/PMAT77/game-serve-hub/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/PMAT77/game-serve-hub/compare/v0.0.0...v0.1.0
[0.0.0]: https://github.com/PMAT77/game-serve-hub/releases
