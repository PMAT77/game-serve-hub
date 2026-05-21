# 运维 Runbook

面向 **Linux 生产/自托管**（`install.linux.sh` + Docker Compose）。Windows 开发机 WSL 网络问题见 [09-DEVELOPMENT-STANDARDS.md §9](./09-DEVELOPMENT-STANDARDS.md#9-windows-开发环境docker--wsl-网络异常)。

## 1. 默认路径与假设

安装脚本默认值（可通过 `panel.env` 覆盖）：

| 项 | 默认路径 |
|----|----------|
| 安装目录 `PANEL_INSTALL_DIR` | `/opt/game-server-hub` |
| Compose 文件 | `/opt/game-server-hub/docker-compose.yml` |
| 环境文件 | `/opt/game-server-hub/panel.env` |
| 面板容器名 | `game-server-hub-panel` |
| 面板端口 `PANEL_PORT` | `80` |

下文命令均在安装目录下执行，且需已安装 Docker Engine 与 Compose 插件。

## 2. 健康检查

### 2.1 HTTP 探活

```bash
curl -fsS "http://127.0.0.1:${PANEL_PORT:-80}/health"
```

正常示例（字段可能随版本微调）：

```json
{
  "status": "ok",
  "service": "game-server-hub-backend",
  "docker": "running",
  "timestamp": "..."
}
```

- `status` 为 `ok`：面板进程可用。
- `docker` 为 `stopped`：面板仍可能响应，但 **实例安装/启停等依赖 Docker 的操作会失败**（业务层会拒绝），需按 §3 处理 Docker。

### 2.2 Docker 引擎

```bash
docker info >/dev/null && echo "docker ok"
```

### 2.3 面板容器状态

```bash
cd /opt/game-server-hub
docker compose ps
docker logs --tail 100 game-server-hub-panel
```

## 3. 故障恢复顺序（从轻到重）

**不要默认重启整机。** 按序尝试，每步后重复 §2 验证。

| 级别 | 场景 | 操作 |
|------|------|------|
| 1 | `/health` 非 200、面板无响应 | 仅重启面板容器 |
| 2 | `docker` 为 `stopped` 或 `docker info` 失败 | 重启 Docker 服务 |
| 3 | 重启 docker 后仍异常 | 重新拉起 Compose 栈 |
| 4 | 宿主机路由/DNS 异常（少见） | 重启网络管理（会短暂断网） |
| 5 | 内核/驱动僵死、无法定位 | 重启主机 |

### 3.1 级别 1：重启面板容器

```bash
cd /opt/game-server-hub
docker compose restart panel
# 或指定服务名（与 compose 中 services 一致，默认 panel）
docker restart game-server-hub-panel
```

验证：

```bash
curl -fsS "http://127.0.0.1:${PANEL_PORT:-80}/health"
```

### 3.2 级别 2：重启 Docker 服务

```bash
sudo systemctl restart docker
# 等待数秒后
docker info
curl -fsS "http://127.0.0.1:${PANEL_PORT:-80}/health"
```

若面板容器未随 Docker 自动拉起（取决于 restart 策略）：

```bash
cd /opt/game-server-hub
docker compose up -d
```

### 3.3 级别 3：重新拉起 Compose 栈

```bash
cd /opt/game-server-hub
docker compose down
docker compose up -d
docker compose ps
curl -fsS "http://127.0.0.1:${PANEL_PORT:-80}/health"
```

有绑定卷与数据目录时，`down` **不会** 删除 `panel.env` 与 `/var/lib/game-server-hub` 中的持久化数据；勿随意加 `-v` 以免误删命名卷。

### 3.4 级别 4：宿主机网络（慎用）

仅在确认是宿主机网络栈问题（非仅 Docker）时使用，**会造成短暂断网**：

```bash
# 按发行版二选一
sudo systemctl restart systemd-networkd
# 或
sudo systemctl restart NetworkManager
```

### 3.5 级别 5：重启主机

```bash
sudo reboot
```

重启后检查：`systemctl is-active docker`、`curl /health`、`docker compose ps`。

## 4. Hub 版本升级（面板 + DST 运行镜像）

### 4.1 推荐：Hub 内一键更新

1. 登录 Hub → **系统设置 → Hub 版本**
2. 点击 **检查更新**
3. 若有新版本，点击 **立即更新**（仅更新检测到变化的镜像）

面板更新会导致服务短暂中断（约 30 秒）；DST 运行镜像更新后，需 **重启实例** 才使用新运行环境。

前提：`panel.env` 已配置 `GSH_STACK_DIR`（安装脚本默认 `/opt/game-server-hub`），且 compose 文件存在于该目录。

### 4.2 手动升级（fallback）

```bash
cd /opt/game-server-hub
docker compose --env-file panel.env -f docker-compose.yml -f docker-compose.bind.yml pull
docker compose --env-file panel.env -f docker-compose.yml -f docker-compose.bind.yml up -d
curl -fsS "http://127.0.0.1:${PANEL_PORT:-80}/health"
```

仅更新面板或 DST 时，可在 `pull` 后指定服务名 `panel`，或单独 `docker pull` DST 镜像（见 `panel.env` 中 `GSH_GAME_DST_IMAGE`）。

### 4.3 发版 SOP（维护者）

1. 合并 `main` 或推送 tag `v*` → GitHub Actions [docker-publish.yml](../.github/workflows/docker-publish.yml) 构建并推送：
   - `ghcr.io/pmat77/game-server-hub:<tag>`
   - `ghcr.io/pmat77/game-server-hub-dst:<tag>`
2. 推送 `v*` tag 时 workflow 自动创建 GitHub Release（含 Release Notes）
3. 生产环境建议 pin 版本 tag（如 `v0.2.0`），而非长期使用 `latest`：
   - `PANEL_IMAGE=ghcr.io/pmat77/game-server-hub:v0.2.0`
   - `GSH_GAME_DST_IMAGE=ghcr.io/pmat77/game-server-hub-dst:v0.2.0`
4. 确认 GHCR 包为 **Public**，或用户服务器已 `docker login ghcr.io`

## 5. 与 Windows 开发环境的差异

| 项目 | Windows 开发（Docker Desktop + WSL2） | Linux 生产 |
|------|----------------------------------------|------------|
| 整机其它应用流量为 0 | 常见（WSL NAT 挂死） | 少见 |
| 首选恢复 | Docker Restart → `wsl --shutdown` | `compose restart` → `systemctl restart docker` |
| 重启整机 | 最后手段 | 最后手段 |

生产环境 **通常不会出现** 开发机上那种「任务管理器里除 IDE 外全网为 0」的 WSL2 特征；更多为 Docker 不可用或单个容器/端口异常。

## 6. 宿主机性能基线（Linux 生产推荐）

Game Server Hub 以 Docker 运行面板、SteamCMD 安装与 DST 进程。以下宿主机调优可显著改善 **SteamCMD 下载** 与 **存档 IO**，需在安装目录外手动配置（Community 文档指引；一键加固为 Pro `runtime_hardening` 规划）。

### 6.1 磁盘 IO

- 实例数据目录（默认 `/var/lib/game-server-hub/instances`）建议单独分区或 NVMe。
- `/etc/fstab` 游戏分区挂载选项：`noatime,nodiratime,errors=remount-ro`（ext4/xfs）。
- NVMe IO 调度器 `none`；HDD 使用 `mq-deadline`。

### 6.2 内存与 swap

- **建议禁用宿主机 swap**（`swapoff -a` 并注释 `/etc/fstab` 中 swap 行）。SteamCMD 安装容器已在 cgroup 内禁用 swap，但宿主机 swap 仍会在压力下拖慢面板与 DST。
- 可选：`vm.swappiness=1`（`/etc/sysctl.conf`）。

### 6.3 DNS 与时间同步

- 国内建议 DNS：`223.5.5.5`、`114.114.114.114`（`systemd-resolved` 或 `/etc/docker/daemon.json` 的 `"dns"`）。
- 启用 `chrony` 或 `systemd-timesyncd`；系统时间偏差 >5 分钟会导致 Steam SSL 登录失败。

### 6.4 Docker 镜像加速

`/etc/docker/daemon.json` 示例：

```json
{
  "registry-mirrors": ["https://你的镜像加速地址"],
  "dns": ["223.5.5.5", "114.114.114.114"]
}
```

需确保可拉取：`PANEL_IMAGE`、`GSH_STEAMCMD_IMAGE`、`GSH_GAME_DST_IMAGE`。

### 6.5 文件描述符

`/etc/security/limits.conf` 增加 `* soft/hard nofile 65536`（多容器 + SteamCMD 下载）。

## 7. SteamCMD 国内网络排障

面板通过 **Docker 临时容器** 执行 `app_update 343050`，不依赖宿主机直装 SteamCMD。

### 7.1 推荐 panel.env（国内）

```env
GSH_STEAMCMD_DOWNLOAD_REGION=cn
GSH_STEAMCMD_INSTALL_MAX_ATTEMPTS=8
GSH_STEAMCMD_INSTALL_RETRY_DELAYS_MS=5000,10000,15000,20000,25000,30000,35000
```

修改后：`cd /opt/game-server-hub && docker compose up -d` 重启面板。

### 7.2 诊断 API

登录 Hub 后请求 `GET /app/system/steamcmd/diagnostics`（或系统设置页），检查 SteamCDN 连通性、Docker 状态与配置建议。

### 7.3  escalation 顺序

1. 设置 `GSH_STEAMCMD_DOWNLOAD_REGION=cn`（或 `shanghai` / `beijing`）
2. 优化 DNS / 时间同步 / Docker registry mirrors
3. 配置 `GSH_STEAMCMD_HTTPS_PROXY`（IP 被 SteamCDN 限制时）
4. 设置 `GSH_STEAMCMD_NETWORK_MODE=host` 后重启面板
5. 查看实例安装日志；清理半成品目录后重试「更新服务端」

### 7.4 DST 防火墙

| 端口 | 协议 | 用途 |
|------|------|------|
| `PANEL_PORT` | TCP | 面板 |
| 10999 | UDP | DST 游戏（默认，可改） |
| 8766 | UDP | Steam 认证 |
| 12346 | UDP | Steam 主服务器 |

安装脚本：`./install.linux.sh --open-dst-ports`。云安全组须同步。

### 7.5 同机第二实例：depot 复制（跳过 Steam 下载）

当宿主机上已有 **已停止** 且 **版本最新** 的 DST 实例 A 时，再创建实例 B 会优先 **复制 A 的游戏文件**（不含存档），安装日志可见「已从实例 … 复制游戏文件，跳过 Steam 下载」。若无可用供体或复制失败，自动走 SteamCMD。

注意：

- **不要**手动把 B 的 `installPath` 指向 A 的目录（会共享存档）；seed 是复制到新目录 `{instancesRoot}/{新实例Id}/`。
- 供体须 **stopped**；运行中复制 depot 虽理论可行，面板 intentionally 不选用 running 实例为供体。
- 关闭 seed：`GSH_INSTALL_SEED_ENABLED=0`
- 安装结束立即拉 DST 运行镜像：`GSH_INSTALL_DEFER_DST_IMAGE_PULL=0`

## 8. 兜底与监控（建议）

应用层已具备：Docker 不可达时拒绝实例关键操作并返回业务错误（见 FDS-00）。

运维层建议：

1. 每 1–5 分钟探测 `GET /health`，失败则告警。
2. 可选自动恢复（cron / systemd timer）：连续 N 次失败后执行级别 1 → 2，并写日志；避免无界循环重启。
3. 外部监控区分：**面板存活** 与 **`docker: running`**，避免误报。

示例探测脚本（需根据实际 `PANEL_PORT` 调整）：

```bash
#!/usr/bin/env bash
set -euo pipefail
URL="${GSH_HEALTH_URL:-http://127.0.0.1:80/health}"
INSTALL_DIR="${PANEL_INSTALL_DIR:-/opt/game-server-hub}"

if curl -fsS --max-time 10 "$URL" | grep -q '"status":"ok"'; then
  exit 0
fi

echo "$(date -Is) health check failed, restarting panel" >&2
cd "$INSTALL_DIR"
docker compose restart panel || docker compose up -d
```

## 9. 相关文档

- 安装与运行时： [FDS/00-install-runtime.md](./FDS/00-install-runtime.md)
- 架构与 Docker 依赖： [05-SYSTEM-ARCHITECTURE-DESIGN.md](./05-SYSTEM-ARCHITECTURE-DESIGN.md)
- 开发环境 WSL 排障： [09-DEVELOPMENT-STANDARDS.md §9](./09-DEVELOPMENT-STANDARDS.md#9-windows-开发环境docker--wsl-网络异常)
