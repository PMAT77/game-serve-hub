# Game Server Hub

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/PMAT77/game-serve-hub/actions/workflows/ci.yml/badge.svg)](https://github.com/PMAT77/game-serve-hub/actions/workflows/ci.yml)
![Public Beta](https://img.shields.io/badge/status-Public%20Beta-orange)

面向 Steam 专用服务器的开源运维面板。当前以《饥荒联机版》（DST）为首个完整适配游戏，提供安装、更新、启停、监控、日志、控制台、世界和 Mod 管理。

![Game Server Hub 首页](https://cdn.jsdelivr.net/gh/PMAT77/PMAT77CDN@main/imgs/game-server-hub/home.png)

## 适合谁

- **个人服主** —— 不想再开一堆 SSH 窗口改 ini、手动重启世界；想在浏览器里管世界、Mod、存档和定时备份。
- **小团队 / 游戏社区** —— 需要成员账号与权限、多实例并存、操作可追溯。
- **托管商 / 集成方** —— 多节点统一管理属于规划中的 Pro 插件；也可直接联系做定制集成（见文末）。

## 它能做什么

- **一键开服与更新** —— 图形化创建实例，SteamCMD 自动安装与更新，地上 / 洞穴双分片一键拉起。
- **世界与 Mod 管理** —— 房间参数、世界生成配置、创意工坊 Mod 在线订阅与开关。
- **实时掌控** —— CPU / 内存 / 磁盘 / 网络监控，SSE 实时日志，游戏控制台直接下发命令。
- **存档与备份** —— 定时备份、面板数据库快照、导入既有存档。
- **两种部署方式** —— Docker Compose 或裸机 systemd，按你的隔离预期选。
- **升级不出事** —— 同模式原地升级，升级前自动备份数据库，保留实例、存档和自定义配置。

## 快速开始

当前为 `v0.3.6` 公测线。要求 Ubuntu 22.04 / 24.04 或 Debian 12，root/sudo，至少 4 GiB 内存和 4 GiB 空闲磁盘；Native 正式支持 x86_64，Docker 的 ARM64 支持仍为实验性。

| 模式 | 适合谁 | 面板 | SteamCMD / 游戏进程 | 进程管理 |
| --- | --- | --- | --- | --- |
| Docker | 小型游戏社区、托管商 | Docker Compose | Docker | Docker Engine |
| Native | 个人服主 | 裸机 | 裸机 | 仅 systemd |

建议明确指定模式，避免自动判断与你的隔离预期不一致。Native 模式完全不依赖 Docker，也不使用 tmux、screen 或 PM2：面板由系统级 `game-server-hub.service` 管理，游戏分片由 `gsh` 用户的 systemd 服务管理，重启、自恢复、journald 日志和资源限制均由 systemd 接管。**裸机模式属于首期预览能力，建议先在非关键服务器验证。**

> **平台支持**：两种模式都以 Linux 为目标平台。**Windows 不是部署目标，也不提供安装脚本**——它只用于本机开发调试，见[开发指南 · 平台定位](docs/DEVELOPMENT.md#平台定位)。

### Docker 模式

> **中国大陆服务器请先做这一步。** Docker 模式的安装器必须从 GHCR 拉取统一镜像，而 GHCR 的镜像层域名 `pkg-containers.githubusercontent.com` 在国内基本不可达 —— 直接执行下面的命令几乎必然卡在 `net/http: TLS handshake timeout`，重试无效。正确顺序是：先按[离线镜像包完整步骤](docs/INSTALL.md#路线-b国内服务器debian-12-离线镜像包全程)下载离线包并 `docker load` 导入，再执行下面的命令；镜像已在本地，安装器会自动跳过拉取。
>
> Native 模式不拉取任何容器镜像，不需要这一步。

```bash
curl -fsSL https://raw.githubusercontent.com/PMAT77/game-serve-hub/v0.3.6/scripts/install.linux.sh \
  | sudo bash -s -- --mode docker
```

### Native systemd 模式

```bash
curl -fsSL https://raw.githubusercontent.com/PMAT77/game-serve-hub/v0.3.6/scripts/install.linux.sh \
  | sudo bash -s -- --mode native
```

### 国内网络

若 GitHub Raw 不稳定，可从 jsDelivr 获取同版本脚本，并启用国内网络档位：

```bash
curl -fsSL https://cdn.jsdelivr.net/gh/PMAT77/game-serve-hub@v0.3.6/scripts/install.linux.sh \
  | sudo bash -s -- --mode native --network cn
```

`--network auto` 根据 GitHub、Docker 仓库和国内软件源的实际连通性选择档位，不使用 IP 归属接口；`cn` 会临时切换 Ubuntu/Debian 软件源、增加 SteamCMD 重试，失败时恢复原软件源。

安装完成后打开脚本输出的地址。安装器会生成随机初始密码，默认不在摘要中明文展示，可在服务器上读取：

```bash
sudo awk -F= '/^ADMIN_PASSWORD=/{print substr($0, index($0, "=") + 1)}' \
  /opt/game-server-hub/panel.env
```

首次登录必须修改密码。

> **国内网络**：若你跳过了上面的离线镜像包步骤、结果卡在镜像下载（`TLS handshake timeout`），那正是 GHCR 镜像层域名不可达 —— `docker load` 导入 Release 离线镜像包后重跑安装器即可，步骤见[安装与运维指南 · 离线镜像包完整步骤](docs/INSTALL.md#路线-b国内服务器debian-12-离线镜像包全程)。

镜像分发与代理、端口、升级、回滚和完整排错说明见 [安装与运维指南](docs/INSTALL.md)。

## 开源与规划

本项目采用 [MIT License](LICENSE)，**当前所有功能开源、免费，没有付费项，也没有付费入口**。

后续可能以独立插件的形式推出 Pro 版本（例如多节点管理），目前**仅在规划中、尚未开发**，也没有时间表。如果你需要官方路线图之外的能力，见文末的[定制开发](#定制开发与商业合作)。

## 常见问题

### 下载脚本或安装资源失败

先改用上面的 jsDelivr 命令并指定 `--network cn`。安装器会依次尝试资源源，Compose 文件使用脚本内置 SHA256 校验，不会为了校验再次强制访问 GitHub Raw。

### Docker 安装失败

脚本会先尝试 Docker 官方仓库，再回退到发行版签名软件包。仍失败时检查 DNS、HTTPS 出站和 `/var/log/game-server-hub/install.diagnostics.log`。不会静默切换为 Native；确认需要裸机模式后显式重跑 `--mode native`。

### GHCR 镜像拉取失败

这是 Docker 模式在国内最常见的失败点。典型症状是**能列出镜像清单、但下载层时超时**（`pkg-containers.githubusercontent.com` 不可达，报 `net/http: TLS handshake timeout`）—— 这是网络不可达，不是鉴权问题，换代理或反复重试都不会成功。

**首选方案是离线镜像包**：每个 Release 都附带 `game-server-hub-<tag>-docker-image.tar.gz`。下载 → `sha256sum -c` 校验 → `docker load -i` 导入 → 再跑安装器（检测到本地已有镜像会跳过拉取）。完整命令见[离线镜像包完整步骤](docs/INSTALL.md#路线-b国内服务器debian-12-离线镜像包全程)。

其他备选路径：配置 HTTPS 代理；或把 `PANEL_IMAGE`、`GSH_GAME_DST_IMAGE`、`GSH_STEAMCMD_IMAGE` 指向你控制的可信仓库，并按 Release 的 `release-images.json` 核对 digest；或改用 `--mode native`。Native 模式不拉取任何容器镜像。

### Native 显示 systemd 不可用

执行：

```bash
sudo systemctl status game-server-hub.service --no-pager
sudo journalctl -u game-server-hub.service -n 100 --no-pager
sudo loginctl show-user gsh -p Linger
```

`Linger=yes` 且 `user@gsh-uid.service` 正常时，面板才能管理无人登录状态下的游戏用户服务。

### 玩家无法连接

同时检查本机防火墙和云厂商安全组。默认需放行面板 `9527/tcp`，以及 DST 的 `10999/udp`、`8766/udp`、`12346/udp`（开启洞穴还需 `11000`、`8768`、`12348`）。安装器只有在传入 `--open-panel-port` / `--open-dst-ports` 时才修改本机防火墙。完整端口清单见 [DST 开服教程](docs/DST_TUTORIAL.md#4-开放端口安全组与防火墙)。

先确认控制台显示的直连地址是否可用：地址来源见命令下方提示，来自"出站 IP 探测"的地址在本机 / 家用 NAT / 容器环境下往往不可直连（开着系统代理时还可能返回代理出口地址）；本机游玩请用「本机」档。Windows 环境的注意事项见 [DST 开服教程第 5 章](docs/DST_TUTORIAL.md#5-需要配置-ip-转发吗)。

### 重跑安装脚本会清空数据吗

不会。同模式重跑被视为原地升级：保留数据库、实例、备份、账号和自定义配置，备份 `panel.env` 后只更新版本相关键。Docker 与 Native 之间不自动迁移。

更多按错误关键词整理的处理方法见 [INSTALL.md 的 FAQ](docs/INSTALL.md#问题清单按报错关键词对照)。

## 交流与反馈

![QQ 群：1055694763](https://img.shields.io/badge/QQ%E7%BE%A4-1055694763-12B7F5?logo=tencentqq&logoColor=white)

公测版本发布、部署安装问题、使用心得与建议都欢迎在群里讨论。

- **部署 / 配置 / 使用问题** → 群里问最快，也方便互相参考
- **可复现的 Bug、明确的功能请求** → 提 [Issue](https://github.com/PMAT77/game-serve-hub/issues)，不会被聊天记录冲掉，后续也好跟进

## 文档

**给服主**

| 文档 | 内容 |
| --- | --- |
| [安装与运维](docs/INSTALL.md) | 两种模式从零安装、升级、回滚、日志与 FAQ |
| [DST 开服教程](docs/DST_TUTORIAL.md) | 端口放行、面板操作、房间世界、控制台、备份与计划任务 |
| [内存建议](docs/MEMORY.md) | 4/6/8 GiB 档位、洞穴与 Mod 建议 |

**给开发者**

本地环境搭建、测试与构建见 [开发指南](docs/DEVELOPMENT.md)；版本策略与发布检查清单见 [发布流程](docs/RELEASE.md)；运行时分层与 Open-Core 边界见 [架构与产品边界](docs/ARCHITECTURE.md)。

版本变更见 [CHANGELOG.md](CHANGELOG.md)。

## 赞助与商业合作

项目主要利用业余时间维护。如果它帮你省下了时间，可以请我喝杯咖啡——赞助用于持续开发、测试机器与文档维护。

<img src="https://cdn.jsdelivr.net/gh/PMAT77/PMAT77CDN@main/imgs/common/collection_wechat.jpg" alt="微信赞助" width="200" />

> 赞助是心意，不等同于购买 Pro、故障处理时限或一对一支持。

### 定制开发与商业合作

除官方路线图外，可以提供以下付费服务：

| 服务 | 说明 |
| --- | --- |
| **适配你的游戏** | 项目以 DST 为首个适配游戏，可对接其他 Steam 专用服务器，复用安装、分片、Mod 与控制台链路 |
| **私有化部署与迁移** | 内网 / 代理受限 / 无公网环境的部署；从裸机或既有面板迁移存档与实例 |
| **功能定制开发** | 按你的玩法或运营需求实现专属功能，交付形式按需求商定 |

**联系方式**

- 微信：`PMAT77`（下方二维码）
  - 添加时请**备注来意**，建议格式 `身份 / 需求 / 规模`，例如 `个人服主 / DST 开服 / 20 人`、`托管商 / 定制插件 / 多节点`
- 电话与合同细节在微信沟通后按需提供
- 功能问题与 Bug 见[交流与反馈](#交流与反馈)。项目由我利用业余时间维护、平日有主业在身，回复可能不够及时，但看到都会回

<img src="https://cdn.jsdelivr.net/gh/PMAT77/PMAT77CDN@main/imgs/common/WeChat.jpg" alt="微信联系：PMAT77" width="200" />

## 参与贡献

欢迎提交 [Issue](https://github.com/PMAT77/game-serve-hub/issues) 与 [Pull Request](https://github.com/PMAT77/game-serve-hub/pulls)；流程与规范见 [CONTRIBUTING.md](CONTRIBUTING.md)，本地开发见 [开发指南](docs/DEVELOPMENT.md)，安全问题见 [SECURITY.md](SECURITY.md)。

后端基于 Fastify 与 Drizzle ORM，前端基于 Vue 3、Vite 与 Fantastic-admin。感谢这些项目及所有贡献者。

## 许可证

Community 源代码采用 [MIT License](LICENSE)：

```text
Copyright (c) 2026 Game Server Hub
SPDX-License-Identifier: MIT
```

**Game Server Hub** — 让开服像点一下那么简单。
