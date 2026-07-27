# Game Server Hub

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/PMAT77/game-serve-hub/actions/workflows/ci.yml/badge.svg)](https://github.com/PMAT77/game-serve-hub/actions/workflows/ci.yml)
![Public Beta](https://img.shields.io/badge/status-Public%20Beta-orange)

面向 Steam 专用服务器的开源运维面板。当前以《饥荒联机版》（DST）为首个完整适配游戏，提供安装、更新、启停、监控、日志、控制台、世界和 Mod 管理。

项目采用 **Open-Core**：单机服主需要的 Community 核心永久开源；多节点等高级能力以独立 Pro 插件提供。当前仓库版本为 `v0.1.4` 公测线，裸机模式属于首期预览能力，建议先在非关键服务器验证。

![Game Server Hub 首页](https://cdn.jsdelivr.net/gh/PMAT77/PMAT77CDN@main/imgs/game-server-hub/home.png)

## 两种部署模式

| 模式 | 适合谁 | 面板 | SteamCMD / 游戏进程 | 进程管理 |
| --- | --- | --- | --- | --- |
| Docker | 小型游戏社区、托管商 | Docker Compose | Docker | Docker Engine |
| Native | 个人服主 | 裸机 | 裸机 | 仅 systemd |

Native 模式完全不依赖 Docker，也不使用 tmux、screen 或 PM2。面板由系统级 `game-server-hub.service` 管理，游戏分片由 `gsh` 用户的 systemd 服务管理；重启、自恢复、journald 日志和资源限制均由 systemd 接管。

## 立即安装

要求：Ubuntu 22.04 / 24.04 或 Debian 12，root/sudo，至少 4 GiB 内存和 4 GiB 空闲磁盘。Native 正式支持 x86_64；Docker 的 ARM64 支持仍为实验性。

建议明确指定模式，避免自动判断与你的隔离预期不一致。

### Docker 模式

```bash
curl -fsSL https://raw.githubusercontent.com/PMAT77/game-serve-hub/v0.1.4/scripts/install.linux.sh \
  | sudo bash -s -- --mode docker
```

### Native systemd 模式

```bash
curl -fsSL https://raw.githubusercontent.com/PMAT77/game-serve-hub/v0.1.4/scripts/install.linux.sh \
  | sudo bash -s -- --mode native
```

### 国内网络

若 GitHub Raw 不稳定，可从 jsDelivr 获取同版本脚本，并启用国内网络档位：

```bash
curl -fsSL https://cdn.jsdelivr.net/gh/PMAT77/game-serve-hub@v0.1.4/scripts/install.linux.sh \
  | sudo bash -s -- --mode native --network cn
```

`--network auto` 根据 GitHub、Docker 仓库和国内软件源的实际连通性选择档位，不使用 IP 归属接口。`cn` 会临时切换 Ubuntu/Debian 软件源、增加 SteamCMD 重试；失败时恢复原软件源。

> 当前尚无官方国内容器仓库。Docker 模式仍默认拉取官方 GHCR 镜像，不会把来源不明的容器代理写入默认配置。你可以显式配置自己信任的镜像仓库。

安装完成后打开脚本输出的地址。安装器会生成随机初始密码，默认不在摘要中明文展示；可在服务器上读取：

```bash
sudo awk -F= '/^ADMIN_PASSWORD=/{print substr($0, index($0, "=") + 1)}' \
  /opt/game-server-hub/panel.env
```

首次登录必须修改密码。完整的代理、端口、升级、回滚和排错说明见 [安装与运维指南](docs/INSTALL.md)。

## 核心能力

- 实例创建、SteamCMD 安装/更新、启动、停止和重启
- DST 地上/洞穴分片、房间、世界生成和 Mod 管理
- 主机与实例 CPU、内存、磁盘和网络监控
- SSE 实时日志、游戏控制台命令
- Docker Compose 与 Native systemd 双运行时
- 安装资源多源回退、SHA256 校验、阶段状态和脱敏诊断
- 同模式原地升级；升级前一致性备份 SQLite，并保留实例、存档、备份和自定义 `panel.env`

## Open-Core 边界

Community 核心永久包含单节点完整生命周期、双部署模式、基础监控、DST 管理和本地数据能力，采用 [MIT License](LICENSE)。

首个 Pro 插件规划为**多节点管理**，后续候选包括计划任务、异地备份、告警、审计、高级 RBAC、SSO 与托管商能力。商业插件将采用签名包和可离线使用的设备授权文件；授权服务不可达时不会停止已运行的游戏实例。

目前 Pro 插件与授权服务尚未发布，Community 不包含占位付费按钮。技术边界见 [架构与产品边界](docs/ARCHITECTURE.md)。

## 常见问题

### 下载脚本或安装资源失败

先改用上面的 jsDelivr 命令并指定 `--network cn`。安装器会依次尝试资源源，Compose 文件使用脚本内置 SHA256 校验，不会为了校验再次强制访问 GitHub Raw。

### Docker 安装失败

脚本会先尝试 Docker 官方仓库，再回退到发行版签名软件包。仍失败时检查 DNS、HTTPS 出站和 `/var/log/game-server-hub/install.diagnostics.log`。不会静默切换为 Native；确认需要裸机模式后显式重跑 `--mode native`。

### GHCR 镜像拉取失败

这是 Docker 模式最常见的受限网络问题。请配置 HTTPS 代理，或把 `PANEL_IMAGE`、`GSH_GAME_DST_IMAGE`、`GSH_STEAMCMD_IMAGE` 指向你控制的可信仓库，并核对 Release digest。Native 模式不拉取这些容器镜像。

### Native 显示 systemd 不可用

执行：

```bash
sudo systemctl status game-server-hub.service --no-pager
sudo journalctl -u game-server-hub.service -n 100 --no-pager
sudo loginctl show-user gsh -p Linger
```

`Linger=yes` 且 `user@gsh-uid.service` 正常时，面板才能管理无人登录状态下的游戏用户服务。

### 玩家无法连接

同时检查本机防火墙和云厂商安全组。默认需放行面板 `9527/tcp`，以及 DST 的 `10999/udp`、`8766/udp`、`12346/udp`。安装器只有在传入 `--open-panel-port` / `--open-dst-ports` 时才修改本机防火墙。

### 重跑安装脚本会清空数据吗

不会。同模式重跑被视为原地升级：保留数据库、实例、备份、账号和自定义配置，备份 `panel.env` 后只更新版本相关键。Docker 与 Native 之间不自动迁移。

更多按错误关键词整理的处理方法见 [INSTALL.md 的 FAQ](docs/INSTALL.md#faq-按错误关键词排查)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [安装与运维](docs/INSTALL.md) | 两种模式从零安装、升级、回滚、日志与 FAQ |
| [架构与产品边界](docs/ARCHITECTURE.md) | 运行时分层、Open-Core 边界、Native 服务模型 |
| [内存建议](docs/MEMORY.md) | 4/6/8 GiB 档位、洞穴与 Mod 建议 |
| [开发指南](docs/DEVELOPMENT.md) | 本地开发、测试和构建 |
| [发布流程](docs/RELEASE.md) | Release 与镜像发布 |
| [变更记录](CHANGELOG.md) | 版本变更 |

## 参与贡献

欢迎提交 [Issue](https://github.com/PMAT77/game-serve-hub/issues) 与 [Pull Request](https://github.com/PMAT77/game-serve-hub/pulls)。开始前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [SECURITY.md](SECURITY.md)。

前端基于 Fantastic-admin、Vue 3 和 Vite；后端采用 Fastify、Drizzle ORM。感谢这些项目及所有贡献者。

## 赞助

项目主要利用业余时间维护。赞助用于持续开发、测试机器和文档维护，不等同于购买 Pro、故障处理时限或一对一支持。

<img src="https://cdn.jsdelivr.net/gh/PMAT77/PMAT77CDN@main/imgs/common/collection_wechat.jpg" alt="微信赞助码" width="200" />

商业合作或托管商集成可通过[商业合作 Issue](https://github.com/PMAT77/game-serve-hub/issues/new?title=%5B%E5%95%86%E4%B8%9A%E5%90%88%E4%BD%9C%5D)联系。付费调试服务说明与 GIF 演示按当前计划暂缓发布。

## 许可证

Community 源代码采用 [MIT License](LICENSE)：

```text
Copyright (c) 2026 Game Server Hub
SPDX-License-Identifier: MIT
```

**Game Server Hub** — 让开服像点一下那么简单。
