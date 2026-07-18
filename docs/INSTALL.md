# 安装与运维指南

面向在 Linux 服务器上自托管 Game Server Hub 的用户。本地开发见 [DEVELOPMENT.md](DEVELOPMENT.md)。

---

## 环境要求

| 项 | 要求 |
|----|------|
| 系统 | Ubuntu 22.04+ / Debian 12+（`apt`） |
| 架构 | x86_64 / aarch64 |
| 内存 | **推荐 ≥ 6 GB**（单实例 + 洞穴 + 中等 Mod）；约 4 GB 仅适合单实例地上、少 Mod（见 [MEMORY.md](MEMORY.md)） |
| 磁盘 | 根分区可用空间 ≥ 4 GB（仅面板；游戏与存档另计） |
| 网络 | 可访问 Docker 仓库与镜像仓库（默认 GHCR；受限网络可显式配置自己的镜像地址） |
| 权限 | root 或 sudo |

宿主机 **无需** 安装 Node.js、pnpm、SteamCMD；安装脚本仅安装 Docker。

---

## 一键安装

从 GitHub 拉取当前稳定 Release 的安装脚本：

```bash
curl -fsSL https://raw.githubusercontent.com/GameServerHub/game-server-hub/v0.1.1/scripts/install.linux.sh | sudo bash
```

若 `raw.githubusercontent.com` 网络不稳定，可改用 CDN：

```bash
curl -fsSL https://cdn.jsdelivr.net/gh/GameServerHub/game-server-hub@v0.1.1/scripts/install.linux.sh | sudo bash
```

或克隆后本地执行：

```bash
git clone --branch v0.1.1 --depth 1 https://github.com/GameServerHub/game-server-hub.git
cd game-server-hub
sudo bash ./scripts/install.linux.sh
```

同时开放 DST 默认 UDP 端口（10999 / 8766 / 12346）：

```bash
sudo bash ./scripts/install.linux.sh --open-dst-ports
```

安装器默认锁定 `v0.1.1` 的安装资源和三类镜像。升级到其它 Release 时，显式指定同一个版本：

```bash
sudo GSH_RELEASE_TAG=v0.1.1 bash ./scripts/install.linux.sh
```

### 安装脚本做了什么

1. 安装 Docker Engine 与 Compose 插件  
2. 预检架构、磁盘、**内存档位提示**、网络（需能访问 `download.docker.com`；镜像默认从 GHCR 拉取）
3. 检查面板端口；仅在显式参数下配置防火墙（`--open-panel-port` / `--open-dst-ports`）  
4. 生成 `/opt/game-server-hub/panel.env`（可按总内存自动合并 `config/panel.env.presets/` 预设）与 Compose 文件  
5. 拉取面板镜像并 `docker compose up -d`  
6. 在终端输出 **面板 URL**、**管理员账号** 与 **初始密码**

> 安装资源（Compose、preset）下载支持多源镜像池自动回退，默认顺序：`jsdelivr` → `ghproxy` → `raw.githubusercontent.com`。脚本默认会与官方 `raw.githubusercontent.com` 同路径文件做校验；如在受限网络中无法访问官方源，可临时设置 `STRICT_INSTALLER_ASSET_CHECKSUM=0` 跳过校验（不推荐）。

### 默认路径与变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PANEL_PORT` | `9527` | 面板访问端口 |
| `PANEL_INSTALL_DIR` | `/opt/game-server-hub` | Compose 与 `panel.env` |
| `PANEL_DATA_DIR` | `/var/lib/game-server-hub` | SQLite、实例、备份 |
| `PANEL_LOG_DIR` | `/var/log/game-server-hub` | 日志与安装状态 |
| `GSH_RELEASE_TAG` | `v0.1.1` | 安装资源与默认三类镜像共同使用的不可变 Release 版本 |
| `PANEL_IMAGE` | `ghcr.io/gameserverhub/game-server-hub:v0.1.1` | 完整面板镜像引用；设置后不再拼接 tag |
| `GSH_GAME_DST_IMAGE` | `ghcr.io/gameserverhub/game-server-hub-dst:v0.1.1` | 完整 DST 运行环境镜像引用；设置后不再拼接 tag |
| `PANEL_IMAGE_TAG` | `v0.1.1` | 未显式设置完整镜像引用时，与 DST / SteamCMD 默认 tag 联动 |
| `GSH_STEAMCMD_IMAGE` | `ghcr.io/gameserverhub/steamcmd-base:v0.1.1` | 游戏安装镜像；面板内拉取严格使用 `panel.env` 中的完整引用 |
| `INSTALL_STEAMCMD_IMAGE` | `0` | 安装阶段是否预拉 SteamCMD（`1` 时预拉写入 `panel.env` 的同一镜像；默认由面板内安装） |
| `USE_CN_DEBIAN_MIRROR` | `0` | Debian 是否启用国内 apt 镜像（社区默认关闭；国内可手动开启） |
| `STRICT_INSTALLER_ASSET_CHECKSUM` | `1` | 是否强制校验安装资源完整性（`0` 为兼容受限网络，不推荐） |
| `INSTALLER_REPO_MIRRORS` | `https://cdn.jsdelivr.net/gh/...@main,https://ghproxy.com/https://raw.githubusercontent.com/.../main,https://raw.githubusercontent.com/.../main` | 安装资源镜像池（逗号分隔，按顺序回退） |
| `INSTALLER_REPO_RAW` | 空 | 兼容旧变量；设置后会作为首选单源 |

安装状态文件：`/var/log/game-server-hub/install.status`

### GHCR 网络问题与自定义镜像

安装器默认只使用官方 `ghcr.io/gameserverhub/*`，不会自动使用维护者的 ACR 或任何第三方镜像站。若 `docker pull` 访问 GHCR 失败：

1. 先确认服务器 DNS、防火墙和 HTTPS 代理是否允许访问 `ghcr.io`；可直接执行 `docker pull ghcr.io/gameserverhub/game-server-hub:<版本>` 测试。
2. 如需镜像副本，请使用自己控制或明确可信的仓库，并从同一个 Release 的 `release-images.json` 核对 digest；不要因网络问题改用来源不明、无法校验的镜像。
3. 安装时一次性传入三个完整镜像引用。私有仓库请先在宿主机以 root 身份执行 `docker login <你的仓库域名>`。

```bash
sudo docker login registry.example.com
sudo \
  PANEL_IMAGE=registry.example.com/your-namespace/game-server-hub:v0.2.0 \
  GSH_GAME_DST_IMAGE=registry.example.com/your-namespace/game-server-hub-dst:v0.2.0 \
  GSH_STEAMCMD_IMAGE=registry.example.com/your-namespace/steamcmd-base:v0.2.0 \
  bash ./scripts/install.linux.sh
```

安装后切换镜像时，编辑 `/opt/game-server-hub/panel.env` 内的 `PANEL_IMAGE`、`GSH_GAME_DST_IMAGE` 和 `GSH_STEAMCMD_IMAGE`，然后执行：

```bash
cd /opt/game-server-hub
sudo docker compose --env-file panel.env -f docker-compose.yml -f docker-compose.bind.yml pull
sudo docker compose --env-file panel.env -f docker-compose.yml -f docker-compose.bind.yml up -d
```

若仍使用 GHCR 且希望连通性预检失败即终止安装，可设置 `STRICT_GHCR_CHECK=1`；三个运行时镜像均为自定义地址时，安装器会跳过 GHCR 预检。

### 防火墙策略（默认不自动开面板端口）

- 默认仅检查端口冲突，不自动放行 `9527/tcp`
- 若确认需要自动放行面板端口：`sudo bash ./scripts/install.linux.sh --open-panel-port`
- DST UDP 端口仍需显式参数：`--open-dst-ports`

### 安装资源拉取策略（多源回退）

- 安装脚本会优先使用本地仓库内文件；缺失时按镜像池顺序下载  
- `panel.env` 预设文件内置在脚本中，弱网场景下即使外网不可达也能继续安装  
- 自定义镜像池（逗号分隔）：`INSTALLER_REPO_MIRRORS="https://your-mirror-1,https://your-mirror-2"`  
- 强制首选单源（兼容旧变量）：`INSTALLER_REPO_RAW="https://your-mirror"`  

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

> **安全提示：首次部署务必改密。** 默认密码仅用于快速上手，公网或多人可访问的环境必须在首次登录后立即修改为强密码。安装脚本默认写入 `FORCE_PASSWORD_CHANGE=1`，首次登录会跳转至强制改密页，完成改密后方可进入面板。

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
2. **首次登录后立即修改密码**（`FORCE_PASSWORD_CHANGE=1` 时会进入强制改密页）。  
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

云服务器还需在 **安全组** 中放行对应端口。安装脚本 `--open-panel-port` / `--open-dst-ports` 仅处理本机防火墙（ufw / firewalld）；未使用这些参数时请手动放行。

---

## 国内网络优化（可选）

编辑 `/opt/game-server-hub/panel.env`，取消注释并设置：

```bash
GSH_STEAMCMD_DOWNLOAD_REGION=cn
GSH_STEAMCMD_INSTALL_MAX_ATTEMPTS=8
```

默认拉取 GHCR 的 `gameserverhub/steamcmd-base`。如网络环境需要，可自行配置 SteamCMD 镜像候选 registry（按顺序优先，最后尝试 `GSH_STEAMCMD_IMAGE` 的完整引用）：

```bash
GSH_STEAMCMD_IMAGE_MIRRORS=your-mirror-1.example.com,your-mirror-2.example.com
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

## 内存与 Mod / 洞穴

全 Docker 部署时，除面板外每个 DST 实例至少一个游戏容器，开启洞穴会再增加一个容器；Steam 安装阶段还有短时峰值。  
**4 GiB** 机适合单实例地上、少量 Mod；**6 GiB** 适合洞穴与中等 Mod；**8 GiB+** 更适合 Mod 较多的长期服。

- 档位说明、预设文件与变量：[MEMORY.md](MEMORY.md)  
- 安装脚本在总内存偏低时会 WARN，并默认按档位合并 `config/panel.env.presets/*.env`  
- 手动指定预设：`sudo GSH_PANEL_ENV_PRESET=small bash ./scripts/install.linux.sh`  
- 不合并预设：`sudo GSH_PANEL_ENV_PRESET=none bash ./scripts/install.linux.sh`

---

## 故障排查

| 现象 | 处理 |
|------|------|
| `/health` 中 `docker: stopped` | `sudo systemctl restart docker`，再 `docker compose up -d` |
| 实例无法安装/启动 | 确认 Docker 正常、`docker info` 成功；查看面板日志 |
| SteamCMD 下载慢或失败 | 配置 `GSH_STEAMCMD_DOWNLOAD_REGION=cn` 或代理（见 `panel.env.example`） |
| 玩家连不上 | 检查 UDP 10999/8766/12346 与本机/云安全组 |
| 安装阶段面板镜像拉取失败 | 先检查 `registry.cn-hangzhou.aliyuncs.com` 与 `ghcr.io` 出站连通性；私有 GHCR 需 `docker login ghcr.io` |

Windows 本地开发若遇 Docker/WSL 网络异常，可尝试重启 Docker Desktop 或 `wsl --shutdown`。
