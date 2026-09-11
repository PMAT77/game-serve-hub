# 宿主机内存与 DST 部署档位

Game Server Hub 生产环境为 **全 Docker**：面板容器 + 每实例 DST 容器（开启洞穴时为 **地上 + 洞穴两个容器**）+ 安装时的 **SteamCMD 临时容器**。  
任务管理器里单个进程只显示几十 MiB 属正常现象，**总占用请看「可用内存」与 `docker stats`**。

---

## 档位对照（按总内存 MemTotal）

| 档位 | 总内存参考 | 单实例（地上） | 洞穴 | Mod（经验值） | 同机多实例 |
|------|------------|----------------|------|---------------|------------|
| **small** | 约 **4 GiB**（&lt; 5 GiB） | ✅ 推荐 | ❌ 不建议 | 少量（≤10） | ❌ 不建议同时运行 |
| **medium** | 约 **6 GiB**（5–8 GiB） | ✅ | ✅ 可开 | 中等（10–30） | 第二实例可用 seed，避免与安装并行 |
| **large** | **≥ 8 GiB** | ✅ | ✅ | 较多 Mod 仍须观察 | 自行规划上限与实例数 |

说明：

- **Mod** 主要增加 **DST 游戏容器** 内存，不是面板进程；Mod 越多，越需要更大内存或设置 `GSH_DST_CONTAINER_MEMORY_MB`。
- **安装 / 更新** Steam 服务端时会短时升高占用；面板默认串行 SteamCMD 任务，但仍建议 **先停止运行中实例** 再安装。
- **开发环境** `pnpm dev:compose` 为双 Node 容器，内存显著高于生产单容器，**不能**用开发占用评估生产。

---

## 典型内存预算（生产、单实例）

以下为经验区间，实际随 Mod、存档、玩家数波动：

| 组件 | 约占用 |
|------|--------|
| Docker 守护进程 + 系统 | 0.3–0.8 GiB |
| panel 容器 | 0.2–0.5 GiB |
| DST 地上 | 0.5–1.5+ GiB |
| DST 洞穴（若开） | +0.4–1.0+ GiB |
| SteamCMD 安装峰值 | +1.0–1.5 GiB（短时） |

因此 **4 GiB 机** 适合「体验开服」；**6 GiB** 适合「地上 + 洞穴 + 中等 Mod」；**8 GiB+** 更适合 Mod 较多的长期服。

---

## panel.env 预设

仓库提供三档可选配置（**非默认强制**）：

| 文件 | 路径 |
|------|------|
| 小内存 | `config/panel.env.presets/small.env` |
| 中等 | `config/panel.env.presets/medium.env` |
| 大内存 | `config/panel.env.presets/large.env` |

安装脚本默认 `GSH_PANEL_ENV_PRESET=auto`，按检测到的总内存自动追加对应预设片段到 `/opt/game-server-hub/panel.env`。

手动指定预设：

```bash
sudo GSH_PANEL_ENV_PRESET=medium bash ./scripts/install.linux.sh
```

已安装后合并预设并重启：

```bash
sudo bash -c 'cat /opt/game-server-hub/config/panel.env.presets/small.env >> /opt/game-server-hub/panel.env'
cd /opt/game-server-hub
sudo docker compose --env-file panel.env -f docker-compose.yml -f docker-compose.bind.yml up -d
```

### 相关环境变量

| 变量 | 含义 |
|------|------|
| `GSH_STEAMCMD_CONTAINER_MEMORY_MB` | SteamCMD 子容器内存硬上限（MiB），不设则不限制 |
| `GSH_DST_CONTAINER_MEMORY_MB` | 每个 DST 分片容器上限（MiB） |
| `GSH_HOST_MEMORY_HEADROOM_MB` | 安装/启动守卫保留空闲（默认 512） |
| `GSH_HOST_MIN_AVAILABLE_MB` | 设为 `0` 可关闭守卫（小内存慎用） |
| `GSH_STEAMCMD_APP_UPDATE_TIMEOUT_MS` | 单次 app_update 超时（毫秒，默认 3600000 = 60 分钟），超时终止后重试断点续传 |

完整示例见仓库根目录 `panel.env.example`。

---

## 安装脚本内存提示

`scripts/install.linux.sh` 在预检阶段读取 `/proc/meminfo`：

- 总内存 **&lt; 约 4 GiB**：输出 **WARN**，说明档位与建议，并写入 `install.status`
- **`GSH_PANEL_ENV_PRESET=auto`**：自动合并 `small` / `medium` / `large` 预设

---

## 面板内提示

登录后：

- **监控台**：展示当前内存档位与总览建议
- **房间设置 → 启用洞穴**：小内存档位显示警告
- **世界设置 → 模组**：提示 Mod 与内存关系
- **实例管理**：创建/安装前提示避免与运行实例叠加

安装/启动时若可用内存不足，API 会返回 `HOST_MEMORY_PRESSURE` 错误（可在 `panel.env` 调整守卫）。

---

## 运维排查

```bash
free -h
docker stats --no-stream
docker logs --tail 100 game-server-hub-panel
```

SteamCMD 容器 exit 137 有两种来源：

- **面板超时终止**：单次 app_update 超过 `GSH_STEAMCMD_APP_UPDATE_TIMEOUT_MS`（默认 60 分钟）后由面板 SIGKILL，日志含 `GSH-APP-UPDATE-TIMEOUT`。此时与内存无关，调大该值即可；已下载内容保留，重试会自动断点续传。
- **内存不足**：容器硬上限或宿主机 OOM。可调高预设或升级规格，并避免安装与多实例同时运行。

更多安装步骤见 [INSTALL.md](INSTALL.md)。
