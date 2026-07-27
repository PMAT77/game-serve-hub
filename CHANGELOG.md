# Changelog

本文件记录面向用户的版本变更，格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 新增 Docker / Native systemd 双运行时；Native 模式下的面板、SteamCMD 和 DST 分片均不依赖 Docker。
- Linux 安装器新增 `--mode auto|docker|native` 与 `--network auto|cn|global`，支持国内 apt 镜像、SteamCMD 重试和多源安装资源回退。
- GitHub Release 流程新增 Linux x64 Native 包与同名 SHA256 文件。
- 新增中文架构、双模式安装、升级回滚与按错误关键词排查文档。

### Changed

- 监控与 SteamCMD 页面改用通用运行时语义，不再假定 Docker。
- 同模式重跑安装器改为原地升级：保留 `panel.env`，并在升级前备份 SQLite 与部署配置。

### Fixed

- 清除 Native 安装、资源快照、定时更新检查中的隐式 Docker 依赖。
- 修复已有前端类型错误，使完整 `vue-tsc` 与生产构建重新通过。

### Security

- Compose 安装资源使用安装器内置 SHA256，校验过程不再强制二次访问 GitHub Raw。
- Native systemd 服务采用专用无登录用户、只读 Release、受限可写路径和权限受控的控制台 FIFO。

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
