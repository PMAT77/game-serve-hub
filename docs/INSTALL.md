# 安装与运维指南

面向在 Linux 服务器上自托管 Game Server Hub 的用户。本地开发见 [DEVELOPMENT.md](DEVELOPMENT.md)。

---

## 环境要求

| 项 | 要求 |
|----|------|
| 系统 | Ubuntu 22.04+ / Debian 12+（`apt`） |
| 架构 | x86_64 / aarch64 |
| 磁盘 | 根分区可用空间 ≥ 4 GB（仅面板；游戏与存档另计） |
| 网络 | 可访问 Docker 与 `ghcr.io` |
| 权限 | root 或 sudo |

宿主机 **无需** 安装 Node.js、pnpm、SteamCMD；安装脚本仅安装 Docker。

---

## 一键安装

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
| `PANEL_PORT` | `9527` | 面板访问端口 |
| `PANEL_INSTALL_DIR` | `/opt/game-server-hub` | Compose 与 `panel.env` |
| `PANEL_DATA_DIR` | `/var/lib/game-server-hub` | SQLite、实例、备份 |
| `PANEL_LOG_DIR` | `/var/log/game-server-hub` | 日志与安装状态 |
| `PANEL_IMAGE` | `ghcr.io/gameserverhub/game-server-hub:latest` | 面板镜像 |
| `PANEL_IMAGE_TAG` | `latest` | 与 DST 运行镜像 tag 联动 |

安装状态文件：`/var/log/game-server-hub/install.status`

### 安装后验证

```bash
curl -fsS "http://127.0.0.1:9527/health"
docker compose -f /opt/game-server-hub/docker-compose.yml ps
docker logs --tail 50 game-server-hub-panel
```

正常时 `/health` 返回 JSON，且 `docker` 字段为 `running`。

### 默认管理员账号与安全

安装完成后，面板初始管理员凭证如下（安装脚本终端也会打印）：

| 项 | 默认值 | 说明 |
|----|--------|------|
| `ADMIN_USERNAME` | `superadmin` | 可在安装前通过环境变量覆盖 |
| `ADMIN_PASSWORD` | `123456` | 可在安装前通过环境变量覆盖 |

> **安全提示：首次部署务必改密。** 默认密码仅用于快速上手，公网或多人可访问的环境必须在首次登录后立即修改为强密码。安装脚本默认写入 `FORCE_PASSWORD_CHANGE=1`，首次登录会弹出改密建议。

生产环境推荐在安装前显式指定强密码，例如：

```bash
sudo ADMIN_USERNAME=admin ADMIN_PASSWORD='your-strong-password' bash ./scripts/install.linux.sh
```

### 手动升级面板

```bash
cd /opt/game-server-hub
docker compose --env-file panel.env -f docker-compose.yml -f docker-compose.bind.yml pull
docker compose --env-file panel.env -f docker-compose.yml -f docker-compose.bind.yml up -d
```

也可在面板 **系统设置 → Hub 版本** 检查并一键更新（需已配置 `GSH_STACK_DIR`）。

---

## 使用流程（DST）

1. 浏览器打开面板 URL，使用默认账号 `superadmin` / `123456`（或安装脚本输出的自定义凭证）登录。  
2. **首次登录后立即修改密码**（`FORCE_PASSWORD_CHANGE=1` 时会弹出改密提示）。  
3. 打开 **监控台**，确认 Docker 与主机资源正常（`docker: running`）。  
4. **节点 → 实例管理** → 创建饥荒实例，等待 SteamCMD 安装完成。  
5. 启动实例，进入 **实例控制台** 查看日志、下发游戏内命令。  
6. 在 **房间 / 世界** 页配置 Cluster、洞穴与地图；客户端连接 `服务器IP:游戏端口`。

---

## DST 端口与防火墙

| 用途 | 协议 | 默认端口 |
|------|------|----------|
| 面板 | TCP | `9527`（安装脚本默认） |
| DST 游戏 | UDP | `10999` |
| Steam 认证 | UDP | `8766` |
| 主服务器 | UDP | `12346` |

云服务器还需在 **安全组** 中放行对应 UDP 端口。安装脚本 `--open-dst-ports` 仅处理本机防火墙（ufw / firewalld）；未使用该参数时请手动放行上述 UDP 端口。

---

## 国内网络优化（可选）

编辑 `/opt/game-server-hub/panel.env`，取消注释并设置：

```bash
GSH_STEAMCMD_DOWNLOAD_REGION=cn
GSH_STEAMCMD_INSTALL_MAX_ATTEMPTS=8
```

如 Docker Hub 访问不稳定，可额外配置 SteamCMD 镜像候选 registry（按顺序自动回退）：

```bash
GSH_STEAMCMD_IMAGE_MIRRORS=docker.m.daocloud.io,hub-mirror.c.163.com
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
