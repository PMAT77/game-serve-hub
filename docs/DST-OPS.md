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

见 [DOMAIN.md](DOMAIN.md)。核心文件：

| 文件 | 作用 |
|------|------|
| `cluster.ini` | 房间名、密码、人数、游戏模式、是否离线房等 |
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
- **Caves**：洞穴层；`cluster.ini` 中 `shard_enabled` 与目录 `Caves/` 需一致。
- 两进程需 **同时运行** 且配置兼容，客户端才能从洞穴洞口进出。
- 启停顺序建议：**启动** Master → Caves；**停止** Caves → Master（见 FDS-04）。

## 5. 网络与端口

默认地表游戏端口 **10999**（可改）。Steam 相关：

- `authentication_port` 默认 8766  
- `master_server_port` 默认 12346  

防火墙需放行 **游戏端口 + Steam 端口段**（宿主机映射到容器）。

离线房：`offline_cluster = true`；仅局域网：`lan_only_cluster = true`。

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
