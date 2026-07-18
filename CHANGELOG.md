# Changelog

本文件记录面向用户的版本变更，格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

（暂无）

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

[Unreleased]: https://github.com/GameServerHub/game-server-hub/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/GameServerHub/game-server-hub/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/GameServerHub/game-server-hub/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/GameServerHub/game-server-hub/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/GameServerHub/game-server-hub/compare/v0.0.0...v0.1.0
[0.0.0]: https://github.com/GameServerHub/game-server-hub/releases
