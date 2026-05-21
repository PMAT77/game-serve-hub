# 饥荒联机版（DST）专用服务器运维参考

> 面板功能设计的 Klei 行为依据；非官方文档。  
> 详细交互见 [FDS-03](FDS/03-dst-cluster.md)、[FDS-04](FDS/04-dst-shard.md)、[FDS-09](FDS/09-console.md)。

## 1. 标识与 AppID

| 项 | 值 |
|----|-----|
| Steam 商店 AppID | 322330（客户端） |
| 专用服务器 SteamCMD AppID | **343050**（面板 `gameCode`） |
| `steam_appid.txt` | 322330（客户端兼容用，安装逻辑会写入） |

## 2. 目录与配置（摘要）

见 [DOMAIN.md](DOMAIN.md)。

### 2.1 Cluster 根路径（面板读写）

每个 DST 实例对应一个 **installPath**（安装根目录）：

1. **优先**数据库 `game_instances.install_path`（安装完成后写入）；
2. **否则**环境变量 `GSH_INSTANCES_ROOT` 下的 `{instanceId}/`（见服务端 `server/src/shared/config/index.ts`，Windows 默认在数据目录 `instances/`）。

在该根目录下，Klei 持久化与房间配置路径为（v1 固定集群名 `Cluster_1`）：

```text
{installPath}/klei-storage/DoNotStarveTogether/Cluster_1/cluster.ini
{installPath}/klei-storage/DoNotStarveTogether/Cluster_1/cluster_token.txt
{installPath}/klei-storage/DoNotStarveTogether/Cluster_1/Master/server.ini
{installPath}/klei-storage/DoNotStarveTogether/Cluster_1/Caves/server.ini   # 启用洞穴分片时
```

DST 进程启动参数 `-persistent_storage_root` 指向 `{installPath}/klei-storage`，`-conf_dir DoNotStarveTogether`，`-cluster Cluster_1`，与上述路径一致。

**运维注意**：房间设置页通过 API 以结构化字段读写 `cluster.ini`（整文件替换固定模板）。请勿在磁盘上手写面板未覆盖的键，保存后会被覆盖。`docs/others/cluster.ini` 仅为字段说明样例，不是运行时路径。

### 2.2 核心文件

| 文件 | 作用 |
|------|------|
| `cluster.ini` | 房间名、密码、人数、游戏模式、联网模式（`offline_cluster` / `lan_only_cluster`）等 |
| `cluster_token.txt` | Klei 集群令牌（`pds-...`）；**公网 / 浏览列表**模式必填，与 `cluster.ini` 同级；见 [FDS-03](FDS/03-dst-cluster.md) §6 |
| `Master/server.ini` | 地表端口、Steam 注册端口 |
| `Caves/server.ini` | 洞穴端口（启用洞穴时） |
| `worldgenoverride.lua` | 地图生成预设与 overrides |
| `modoverrides.lua` | Mod 列表（面板 Mod 模块写入） |

## 3. 常用控制台命令（需 `-console` 启动）

面板通过 stdin 或 `docker exec` 发送以下 Lua（无需前缀 `~`）：

| 操作 | 命令 | 面板快捷（规划） |
|------|------|----------------|
| 保存 | `c_save()` | 保存 |
| 回档 n 天 | `c_rollback(n)` n=1..6 | 回档 1～6 天 |
| 重置世界 | `c_reset()` | 重置（需二次确认） |
| 注册投票 | `TheNet:ListSnapshotTimeout()` 等 | 高级，v1 可不暴露 |

**注意**：重置与回档影响全体玩家，UI 必须强确认。

## 4. 分片（Shard）与洞穴

- **Master**：主世界，必须运行。
- **Caves**：洞穴层；`cluster.ini` 中 `shard_enabled` 与是否启动洞穴容器一致（关闭分片时保留 `Caves/` 配置但不启进程）。
- 推荐流程：**房间设置** 开启分片并保存（自动生成 `Caves/` 默认配置）→ **世界设置** 调整主世界/洞穴端口与世界生成 → **启动实例**。
- 两进程需 **同时运行** 且配置兼容，客户端才能从洞穴洞口进出。
- 启停顺序建议：**启动** Master → Caves；**停止** Caves → Master（见 FDS-04）。

## 5. 网络与端口

默认地表游戏端口 **10999**（可改）。Steam 相关：

- `authentication_port` 默认 8766  
- `master_server_port` 默认 12346  

防火墙需放行 **游戏端口 + Steam 端口段**（宿主机映射到容器）。面板安装脚本可选 `--open-dst-ports` 自动开放上述 UDP 端口（ufw/firewalld）；云厂商安全组须同步放行。

| 用途 | 协议 | 默认端口 | 说明 |
|------|------|----------|------|
| 面板 Web | TCP | 80 或 `PANEL_PORT` | 安装脚本默认开放 |
| DST 游戏 | UDP | 10999 | `Master/server.ini` 可改 |
| Steam 认证 | UDP | 8766 | |
| Steam 主服务器 | UDP | 12346 | |
| SteamCMD 下载 | HTTPS | 443 | 出站，无需对玩家入站开放 |
| GHCR 镜像 | HTTPS | 443 | 面板/DST/SteamCMD 镜像拉取 |

SteamCMD 安装走 Docker 临时容器，**不需要**开放 CS2 常用的 27015–27020 端口段。

联网模式（面板 M1 三选一，须与 ini 一致）：

| 模式 | `offline_cluster` | `lan_only_cluster` | `cluster_token.txt` |
|------|-------------------|--------------------|---------------------|
| 离线 | `true` | `false` | 不需要 |
| 仅局域网 | `false` | `true` | 不需要 |
| 公网（Klei 列表） | `false` | `false` | **需要** |

令牌生成：游戏内 `TheNet:GenerateClusterToken()` 或 Klei 账号「游戏服务器」。

## 6. Mod 与创意工坊

- 服务器 Mod 自 Steam Workshop 下载到安装目录下 workshop 内容（具体路径由 SteamCMD/游戏决定，适配器封装）。
- `modoverrides.lua` 控制启用与顺序；服务器 Mod 需与客户端一致方可进服。
- 依赖关系来自 Mod 的 `server_mod_setup` 等元数据；面板做**基础**解析，Pro 做深度冲突向导。

## 7. 存档与备份边界

建议备份包含：

- 整个 Cluster 目录（含 `Master/save`、`Caves/save`）
- `cluster.ini`、各 `server.ini`、`worldgenoverride.lua`、`modoverrides.lua`

恢复前 **停止所有 Shard 容器**，避免存档损坏。

## 8. 更新服务端

- SteamCMD：`app_update 343050 validate`（面板已有手动更新 API 方向）。
- 更新前建议通知玩家并备份；更新后可能需要重启 shard。

## 9. 官方参考链接

- [Klei DST Dedicated Server](https://dontstarve.wiki.gg/wiki/Don%27t_Starve_Together_Dedicated_Server)（社区 Wiki）  
- Klei 官方论坛配置说明（随版本更新，实现时核对字段名）

---

*Klei 更新导致字段变化时，同步更新 FDS 与适配器。*
