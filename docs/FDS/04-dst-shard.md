# FDS-04：DST 世界（Shard）

- 里程碑：M1
- 优先级：P0
- 状态：已实现（M1 Community；2026-05-21 验收确认）

## 1. 背景与目标

提供 Master/Caves 世界配置与运行编排，补齐 DST 多世界管理能力。与 FDS-03 分工：房间级 `cluster.ini`（含 `shard_enabled`、分片互联）在房间页；本模块负责各分片目录下 `server.ini`、`worldgenoverride.lua` 及分片容器状态。

## 2. 角色与前置条件

- 角色：实例管理员
- 前置：实例已安装，Cluster 目录已存在（`klei-storage/.../Cluster_1/`）

## 3. 功能范围

- 分片配置读写（`Master|Caves/server.ini`、`worldgenoverride.lua`）
- 洞穴默认配置（房间开启分片保存时自动生成；`init-caves` 为可选修复入口）
- 分片运行状态展示与双容器编排（`shard_enabled` 时 Master → Caves 启动，停止逆序）

### 3.1 推荐用户流程（Community，对齐 dst-admin-go）

1. **房间设置**：打开「启用分片」并保存 → 仅写 `cluster.ini`，同时**自动**生成 `Caves/` 默认 `server.ini` 与 `worldgenoverride.lua`（非「先创建游戏存档」）。
2. **世界设置**：调整主世界与洞穴的端口、世界生成预设（洞穴卡片仅在房间已开启分片时可编辑）。
3. **启动实例**：`shard_enabled=true` 时启动 Master 与 Caves 容器；关闭分片时保留 `Caves/` 文件但不启洞穴进程。
4. **世界列表**：查看主世界/洞穴容器状态（运行中 / 已停止 / 未开启分片等）。

**术语**：「洞穴配置」= 分片运行参数（端口、Steam 端口、`worldgenoverride.lua` 预设），不是要求用户先完成可玩洞穴存档。

## 4. 功能清单

- 分片状态展示（Community）
- 分片配置管理（Community）
- 分片编排自动化（Community）
- 高级 worldgen 编辑（Pro 规划）

## 5. 接口与输入输出

### 5.1 REST（与 v1 实例模块命名一致）

资源段使用单数 `instance`，实例 ID 通过 query 或 body 传递。

- `GET /app/instance/shards?instanceId={instanceId}` — 分片列表与状态
- `PUT /app/instance/shards` — 保存单个分片配置；body 含 `instanceId`、`shard`、`serverPort` 等
- `POST /app/instance/shards/init-caves?instanceId={instanceId}` — 幂等修复/补全 `Caves/` 默认文件（前端 v1 不主推；房间保存开启分片时已自动生成）

### 5.2 结构化对象（摘要）

| 字段 | 类型 | 说明 |
|------|------|------|
| `clusterShardEnabled` | boolean | 只读，来自 `cluster.ini` `shard_enabled` |
| `shards[]` | array | `id`: `master` \| `caves`；`configured`、`containerStatus`、`serverPort`、`steamAuthPort`、`steamMasterPort`、`worldgenPreset`、`configDirty`、`warnings` |
| `effectiveHints` | string[] | 重启、防火墙、启停顺序提示 |

**`ShardSavePayload`（Community v1）**

| 字段 | 说明 |
|------|------|
| `shard` | `master` \| `caves` |
| `serverPort` | `[NETWORK] server_port` |
| `steamAuthPort` | `[STEAM] authentication_port` |
| `steamMasterPort` | `[STEAM] master_server_port` |
| `worldgenPreset` | Master: `SURVIVAL_TOGETHER`；Caves: `DST_CAVE` \| `DST_CAVE_PLUS` \| `COMPLETE_DARKNESS` |
| `restart` | 可选，保存后重启实例 |

### 5.3 磁盘文件

| 分片 | 路径（相对 Cluster 根） |
|------|-------------------------|
| Master | `Master/server.ini`、`Master/worldgenoverride.lua` |
| Caves | `Caves/server.ini`、`Caves/worldgenoverride.lua` |

## 6. 业务规则

### 6.1 与 FDS-03 分工

- `shard_enabled`、`bind_ip`、`master_ip`、`master_port`、`cluster_key` 在房间设置页（FDS-03）维护。
- 房间保存 `shard_enabled=true` 时自动 scaffold 洞穴默认配置（见 FDS-03 §6.3）。
- 世界设置中**仅当** `clusterShardEnabled=true` 时可编辑洞穴；未开启时仅提示前往房间设置。
- 禁止仅运行 Caves：`shard_enabled=true` 时 Master 必须已配置且可构建容器 spec。
- 关闭房间分片后保留 `Caves/` 配置，不启动洞穴容器。

### 6.2 端口

- Master 与 Caves 的 `server_port`、`authentication_port`、`master_server_port` 不得相同；保存与启动前校验。
- 自动生成洞穴默认：`caves.server_port = master.server_port + 1`；Steam 端口在 Master 默认基础上各 +2。

### 6.3 启停与生效

- 启动顺序：Master → Caves；停止顺序：Caves → Master。
- 实例 **running** 时允许保存，须提示需重启；可选「保存并重启」。
- 保存：校验 → 备份（`.bak`）→ 原子替换 ini / lua。

### 6.4 控制台（v1 遗留）

- 实例控制台（FDS-09）仍仅连接 Master 容器；Caves 日志/命令分流为后续里程碑。

## 7. 异常与边界

- 端口冲突 → 禁止启动并给出冲突端口
- 配置非法 / 分片端口互斥 → 阻止保存
- 洞穴配置人为删除 → 启动前自愈 `ensureDstCavesShardConfig` 或重新保存房间开启分片

## 8. 非功能要求

- 分片操作保证启停顺序与状态一致性；启动失败时回滚已启分片容器
- v1 DB 仍只存 Master `containerId`；Caves 容器按命名规则发现

## 9. 验收标准

- 房间开启分片保存后自动生成 `Caves/` 默认配置，无需先点「初始化」
- 房间开启分片 → 世界设置调整洞穴 → 双容器启动 → 游戏内可进洞穴（人工）
- Master/Caves 配置可读写；端口冲突保存/启动失败且提示明确
- 运行中修改有重启提示；停止时 Caves 先于 Master
- `GET` 无 Klei 令牌等敏感字段

## 10. 实现落点（Community v1）

| 层级 | 路径 |
|------|------|
| 契约 | `shared/contracts/shard.ts` |
| 后端模块 | `server/src/modules/shard/index.ts` |
| 适配层 | `server/src/infra/game-adapter/dst/shard-service.ts`、`server-ini.ts`、`worldgen-override.ts`、`runtime-spec.ts` |
| 生命周期 | `server/src/modules/instance/container-lifecycle.ts` |
| 前端 API | `src/api/modules/shard.ts` |
| 前端页面 | `src/views/shard/index.vue`、`settings.vue` |

## 11. 后续里程碑（Pro / 增强）

- 高级 worldgen 参数模板与原始 Lua 编辑
- 分片级日志与控制台命令分流
