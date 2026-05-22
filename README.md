# GameServerHub

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub](https://img.shields.io/github/stars/GameServerHub/game-server-hub?style=social)](https://github.com/GameServerHub/game-server-hub)

开源 **Steam 游戏专用服务器面板**：装得上、开得起来、管得住。  
v1 聚焦 **饥荒联机版（Don't Starve Together）** 专用服务器一键开服。

> 非 Klei / Valve 官方产品。  
> 仓库：<https://github.com/GameServerHub/game-server-hub>

---

## 特性

- **一键部署**：Linux 安装脚本 + Docker Compose 全容器化运行时
- **实例生命周期**：创建实例、SteamCMD 安装/更新、启停、资源占用与安装日志
- **监控台**：主机 CPU / 内存 / 磁盘、Docker 概况、网卡实时流量
- **游戏控制台**：实例日志流（SSE）、游戏内命令下发
- **DST 房间 / 世界**：Cluster 与 Master/Caves 分片配置

---

## 环境要求

### 生产安装（Linux，推荐）

| 项 | 要求 |
|----|------|
| 系统 | Ubuntu 22.04+ / Debian 12+（`apt`） |
| 架构 | x86_64 / aarch64 |
| 磁盘 | 根分区可用空间 ≥ 4 GB（仅面板；游戏与存档另计） |
| 网络 | 可访问 Docker 与 `ghcr.io` |
| 权限 | root 或 sudo |

宿主机 **无需** 安装 Node.js、pnpm、SteamCMD；脚本仅安装 Docker。

### 本地开发

| 项 | 要求 |
|----|------|
| Node.js | `^20.19` / `^22.13` / `>=24` |
| 包管理 | pnpm `10.33+`（见 `packageManager` 字段） |
| Docker | 实例安装/启停依赖 Docker Engine（开发 Compose 模式亦需要） |
| 数据库 | SQLite（`pnpm run dev:prepare` 自动初始化） |

---

## 快速开始：生产安装（Linux）

### 一键安装

从 GitHub 拉取安装脚本（默认分支 `main`）：

```bash
curl -fsSL https://raw.githubusercontent.com/GameServerHub/game-server-hub/main/scripts/install.linux.sh | sudo bash
```

或克隆后本地执行：

```bash
git clone https://github.com/GameServerHub/game-server-hub.git
cd game-server-hub
sudo bash ./scripts/install.linux.sh
```

同时开放 DST 默认 UDP 端口（10999 / 8766 / 12346）：

```bash
sudo bash ./scripts/install.linux.sh --open-dst-ports
```

生产环境建议固定 Release 版本，勿长期使用 `latest`：

```bash
sudo PANEL_IMAGE_TAG=v0.2.0 bash ./scripts/install.linux.sh
```

### 安装脚本做了什么

1. 安装 Docker Engine 与 Compose 插件  
2. 预检架构、磁盘、网络（需能访问 `download.docker.com` 与 `ghcr.io`）  
3. 检查面板端口并尝试配置防火墙（ufw / firewalld）  
4. 生成 `/opt/game-server-hub/panel.env` 与 Compose 文件  
5. 拉取面板镜像并 `docker compose up -d`  
6. 在终端输出 **面板 URL**、**管理员账号** 与 **初始密码**

### 默认路径与变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PANEL_PORT` | `80` | 面板访问端口 |
| `PANEL_INSTALL_DIR` | `/opt/game-server-hub` | Compose 与 `panel.env` |
| `PANEL_DATA_DIR` | `/var/lib/game-server-hub` | SQLite、实例、备份 |
| `PANEL_LOG_DIR` | `/var/log/game-server-hub` | 日志与安装状态 |
| `PANEL_IMAGE` | `ghcr.io/gameserverhub/game-server-hub:latest` | 面板镜像 |
| `PANEL_IMAGE_TAG` | `latest` | 与 DST 运行镜像 tag 联动 |

安装状态文件：`/var/log/game-server-hub/install.status`

### 安装后验证

```bash
curl -fsS "http://127.0.0.1:80/health"
docker compose -f /opt/game-server-hub/docker-compose.yml ps
docker logs --tail 50 game-server-hub-panel
```

正常时 `/health` 返回 JSON，且 `docker` 字段为 `running`。

### 手动升级面板

```bash
cd /opt/game-server-hub
docker compose --env-file panel.env -f docker-compose.yml -f docker-compose.bind.yml pull
docker compose --env-file panel.env -f docker-compose.yml -f docker-compose.bind.yml up -d
```

也可在面板 **系统设置 → Hub 版本** 检查并一键更新（需已配置 `GSH_STACK_DIR`）。

---

## 本地开发

### 1. 克隆与依赖

```bash
git clone https://github.com/GameServerHub/game-server-hub.git
cd game-server-hub
corepack enable
pnpm install
```

### 2. 复制环境变量模板

```bash
cp .env.development.example .env.development
cp server/.env.development.example server/.env.development
```

按需修改 `VITE_APP_API_BASEURL`（默认 `http://127.0.0.1:9527`）与后端 `SERVER_PORT`（默认 `9527`）。

Docker Compose 开发模式使用 `panel.env.example`：

```bash
cp panel.env.example panel.env
```

### 3. 初始化数据库

```bash
pnpm run dev:prepare
```

创建 SQLite、运行 Drizzle 迁移、初始化日志目录。

### 4. 启动（宿主机 Node，推荐日常改代码）

```bash
pnpm run dev
```

| 服务 | 地址 | 说明 |
|------|------|------|
| 前端 | `http://127.0.0.1:9000` | Vite 开发服务器 |
| 后端 | `http://127.0.0.1:9527` | Fastify API |
| 健康检查 | `GET http://127.0.0.1:9527/health` | 含 Docker 状态 |

默认管理员（`panel.env` / 开发预填）：账号 `superadmin`，密码 `123456`（亦可在 `panel.env` 或 `.env.development` 中覆盖）。

### 5. 启动（Docker Compose 开发栈，贴近生产）

需已安装 Docker。`dev:compose` 与 `dev:server` **不要同时运行**（实例卷 bind 会冲突）。

```bash
pnpm run dev:compose:prepare   # 可选：预拉 SteamCMD 镜像
pnpm run dev:compose             # 启动 panel + web 容器
```

停止：

```bash
pnpm run dev:compose:down
```

Compose 开发栈下面板端口见 `panel.env` 中 `PANEL_PORT`（示例默认 `3000`）。

### 6. 运行测试

```bash
pnpm test:server
pnpm run lint
```

---

## 从源码构建生产镜像

适用于自托管构建或 CI 调试。

### 构建前端

```bash
cp .env.production.example .env.production
cp server/.env.production.example server/.env.production
pnpm install
pnpm run build          # 输出 dist/
```

### 构建 Docker 镜像

```bash
# 面板镜像（含 dist + 后端）
docker build -t ghcr.io/gameserverhub/game-server-hub:local .

# DST 运行环境镜像
docker build -t ghcr.io/gameserverhub/game-server-hub-dst:local docker/game-dst
```

### 本地 Compose 启动（非安装脚本路径）

```bash
cp panel.env.example panel.env
# 编辑 panel.env，将 PANEL_IMAGE 改为本地 tag
docker compose --env-file panel.env -f docker-compose.yml -f docker-compose.bind.yml up -d
```

官方镜像由 GitHub Actions 在推送 `main` 或 `v*` tag 时发布至 GHCR：

- `ghcr.io/gameserverhub/game-server-hub:<tag>`
- `ghcr.io/gameserverhub/game-server-hub-dst:<tag>`

---

## 使用流程（DST）

1. 浏览器打开面板 URL，使用安装脚本输出的账号登录。  
2. 若启用 `FORCE_PASSWORD_CHANGE=1`，首次登录后按提示修改密码。  
3. 打开 **监控台**，确认 Docker 与主机资源正常（`docker: running`）。  
4. **节点 → 实例管理** → 创建饥荒实例，等待 SteamCMD 安装完成。  
5. 启动实例，进入 **实例控制台** 查看日志、下发游戏内命令。  
6. 在 **房间 / 世界** 页配置 Cluster、洞穴与地图；客户端连接 `服务器IP:游戏端口`。

### 默认端口

| 用途 | 协议 | 默认端口 |
|------|------|----------|
| 面板 | TCP | `80`（安装脚本默认） |
| DST 游戏 | UDP | `10999` |
| Steam 认证 | UDP | `8766` |
| 主服务器 | UDP | `12346` |

云服务器还需在 **安全组** 中放行对应 UDP 端口；安装脚本 `--open-dst-ports` 仅处理本机防火墙。

### 国内网络优化（可选）

编辑 `/opt/game-server-hub/panel.env`，取消注释并设置：

```bash
GSH_STEAMCMD_DOWNLOAD_REGION=cn
GSH_STEAMCMD_INSTALL_MAX_ATTEMPTS=8
```

修改后重新拉起栈：

```bash
cd /opt/game-server-hub
docker compose --env-file panel.env -f docker-compose.yml -f docker-compose.bind.yml up -d
```

---

## 常用运维命令

```bash
# 查看容器
docker compose -f /opt/game-server-hub/docker-compose.yml ps

# 面板日志
docker logs -f game-server-hub-panel

# 重启面板
cd /opt/game-server-hub
docker compose restart panel

# 重启 Docker 后若面板未自动起来
docker compose --env-file panel.env -f docker-compose.yml -f docker-compose.bind.yml up -d
```

`docker compose down` **不会** 删除 `/var/lib/game-server-hub` 中的实例与存档；请勿随意加 `-v`。

---

## 故障排查

| 现象 | 处理 |
|------|------|
| `/health` 中 `docker: stopped` | `sudo systemctl restart docker`，再 `docker compose up -d` |
| 实例无法安装/启动 | 确认 Docker 正常、`docker info` 成功；查看面板日志 |
| SteamCMD 下载慢或失败 | 配置 `GSH_STEAMCMD_DOWNLOAD_REGION=cn` 或代理（见 `panel.env.example`） |
| 玩家连不上 | 检查 UDP 10999/8766/12346 与本机/云安全组 |
| 安装脚本报 ghcr 不可达 | 检查出站网络；私有 GHCR 需 `docker login ghcr.io` |

Windows 本地开发若遇 Docker/WSL 网络异常，可尝试重启 Docker Desktop 或 `wsl --shutdown`。

---

## 仓库结构

```text
game-server-hub/
├── src/                    # Vue 3 前端
├── server/                 # Fastify 后端、Drizzle、SQLite 迁移
├── shared/                 # 前后端共享契约与错误码
├── scripts/                # 安装脚本、开发工具
├── packages/               # 工作区 UI 组件
├── docker/                 # DST 运行镜像等
├── docker-compose.yml      # 生产编排
├── docker-compose.dev.yml  # 开发 overlay
├── panel.env.example       # Compose / 安装脚本环境变量模板
├── .env.*.example          # 前端 Vite 环境变量模板
└── server/.env.*.example   # 后端环境变量模板
```

---

## 参与贡献

欢迎 [Issue](https://github.com/GameServerHub/game-server-hub/issues) 与 [Pull Request](https://github.com/GameServerHub/game-server-hub/pulls)。

提交前建议：

```bash
pnpm run lint
pnpm test:server
```

提交说明采用 Conventional Commits 风格（中文）。请勿提交 `panel.env`、本地 SQLite、`docs/` 目录或任何凭据文件。

---

## 许可证

本仓库 **Community 版** 源代码采用 **[MIT License](LICENSE)** 发布。

```text
Copyright (c) 2026 GameServerHub
SPDX-License-Identifier: MIT
```

---

**GameServerHub** — 让开服像点一下那么简单。
