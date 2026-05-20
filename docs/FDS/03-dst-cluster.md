# FDS-03：DST 房间（Cluster）

- 里程碑：M1
- 优先级：P0
- 状态：已实现（M1 Community；2026-05-20 验收确认）

## 1. 背景与目标

将房间级配置从隐式默认值（见 `server/src/infra/game-adapter/dst/cluster-config.ts` 的 `writeFileIfMissing`）升级为可视化可管理能力，覆盖 **联网模式**、Klei 集群令牌与 `cluster.ini` 一致读写。

## 2. 角色与前置条件

- 角色：实例管理员
- 前置：实例已安装，Cluster 目录已存在（`klei-storage/.../Cluster_1/`）
- 公网（Klei 列表）模式：管理员已在 Klei 账号侧生成集群令牌（游戏内 `TheNet:GenerateClusterToken()` 或 [accounts.klei.com](https://accounts.klei.com) 游戏服务器）

## 3. 功能范围

- 读取与编辑 `cluster.ini`（结构化表单，非全文裸编辑）
- 房间基础信息、玩法设置
- **联网模式**三选一及与 `offline_cluster` / `lan_only_cluster` 的联动
- **公网模式**下 `cluster_token.txt` 的粘贴与校验（v1 不做文件上传）
- 与 FDS-04 联动：`[SHARD]` 中 `shard_enabled` 等由房间页开关，洞穴细节在 Shard 模块

## 4. 功能清单

- 房间配置读取（Community）
- 表单保存与校验（Community）
- 联网模式选择与 Klei 令牌配置（Community）
- 保存后「需重启实例」提示与可选「保存并重启」（Community）
- 配置模板库（Pro 规划）

## 5. 接口与输入输出

### 5.1 REST（与实例模块命名一致）

与已实现接口对齐：资源段使用单数 `instance`（同 `/app/instance/console/logs`、`/app/instance/install-log`），**不用**路径参数 `:instanceId`，实例 ID 通过查询参数或请求体传递。

- `GET /app/instance/cluster?instanceId={instanceId}` — 读取房间配置
- `PUT /app/instance/cluster` — 保存；请求体为 `ClusterSavePayload`，含 `instanceId` 及表单字段（可选 `restart: true` 保存后重启）

> 说明：部分其他 FDS 草案仍写 `/app/instances/:instanceId/...`；v1 已落地模块以 **`/app/instance/*` + query/body** 为准，新实现与之保持一致，不在本模块单独引入复数路径段。

### 5.2 结构化对象（摘要）

| 字段 | 类型 | 说明 |
|------|------|------|
| `networkMode` | `'offline' \| 'lan_only' \| 'public'` | 联网模式（见 §6.1） |
| `clusterName` | string | 房间名 → `cluster_name` |
| `clusterDescription` | string | 描述 → `cluster_description` |
| `clusterPassword` | string | 进服密码 → `cluster_password`（可空） |
| `gameMode` | enum | → `game_mode` |
| `maxPlayers` | number | → `max_players` |
| `pvp` | boolean | → `pvp` |
| `pauseWhenEmpty` | boolean | → `pause_when_empty` |
| `clusterToken` | string \| null | 仅 `public` 时必填；写入 `cluster_token.txt`，**响应与日志不得回显完整令牌** |
| `shardEnabled` | boolean | → `shard_enabled`（洞穴启用与 FDS-04 编排联动） |
| `configDirty` | boolean | 只读：保存后若实例 running 则为 true，提示重启 |
| `effectiveHints` | string[] | 只读：如「需重启」「公网需放行端口」 |

### 5.3 磁盘文件

| 文件 | 路径（相对 Cluster 根） | 说明 |
|------|-------------------------|------|
| `cluster.ini` | `cluster.ini` | 房间主配置 |
| `cluster_token.txt` | `cluster_token.txt` | Klei 集群令牌（`pds-...`）；**仅公网模式**需要且应存在 |

参考样例：`docs/others/cluster.ini`（注释版字段说明，实现时以 Klei 当前行为为准）。

## 6. 业务规则

### 6.1 联网模式（三选一）

面板以单一选项 `networkMode` 呈现，保存时**必须**同步写入 `cluster.ini` 的 `[NETWORK]`，二者不得不一致。

| `networkMode` | `offline_cluster` | `lan_only_cluster` | 行为摘要 |
|---------------|-------------------|--------------------|----------|
| `offline` | `true` | `false` | 不向 Klei 注册；**不需要** `cluster_token.txt`；不进浏览列表 |
| `lan_only` | `false` | `true` | 仅局域网可见；**不需要** `cluster_token.txt` |
| `public` | `false` | `false` | 向 Klei 注册、可进游戏内浏览列表；**必须**提供有效 `cluster_token.txt` |

**互斥**：不允许 `offline_cluster = true` 与 `lan_only_cluster = true` 同时为 `true`（保存时校验并拒绝）。

**与 M0 默认差异**：M0 适配器默认 `offline_cluster = true` 且 `lan_only_cluster = true`（偏开发/离线）；M1 房间页保存后应以用户选择的 `networkMode` 为准，并覆盖旧值。

### 6.2 Klei 集群令牌（`cluster_token.txt`）

- 仅当 `networkMode = public` 时：
  - 用户通过面板**粘贴**提供令牌（一行，`pds-` 前缀等，以 Klei 生成为准）；v1 **不提供**令牌文件上传。
  - 服务端校验：非空、去除首尾空白、长度与字符集合理（具体规则实现时定义，避免误粘贴说明文字）。
  - 原子写入 `cluster_token.txt`（与 `cluster.ini` 同目录）。
- 当 `networkMode` 为 `offline` 或 `lan_only` 时：
  - **不得**要求令牌；若存在历史 `cluster_token.txt`，可选保留文件但不使用，或保存时删除/忽略（实现二选一，须在代码注释与 UI 说明一致；推荐：**保留文件但不读取**，切换回公网时可继续用）。
- **安全**：
  - 禁止将完整令牌写入应用日志、安装日志、实例控制台日志、审计表（若未来有）。
  - `GET` 接口仅返回 `clusterTokenConfigured: boolean` 或掩码（如 `pds-****…abcd`），**禁止**返回明文。
  - 错误提示中不得包含用户粘贴的令牌内容。

### 6.3 通用规则

- v1 保持 **1 实例 : 1 Cluster**（目录名沿用现有 `Cluster_1` 常量）。
- 实例 **running** 时允许保存配置文件，但必须提示：**需重启实例后生效**；可选提供「保存并重启」。
- 保存采用：校验 → 备份（`.bak` 时间戳）→ 原子替换 `cluster.ini` / `cluster_token.txt`。
- `cluster_key`（`[SHARD]` 段）属于 Master/Caves 分片互联密钥，**不是** Klei 令牌；在 FDS-04 或启用洞穴时配置，本模块仅在有 `shard_enabled` 开关时写入默认值或展示只读说明。

### 6.4 与 Steam 凭据区分

- **SteamCMD 账号 / Steam Guard**：用于下载专用服务器（模块 02 安装链路），与 `cluster_token.txt` **无关**。
- UI 与文档须明确区分「Steam 安装凭据」与「Klei 房间令牌」。

## 7. 异常与边界

- `cluster.ini` 缺失 → 按实例名与当前 `networkMode` 用模板重建（可参考 `cluster-config.ts` 生成逻辑，但须支持覆盖而非仅 `writeFileIfMissing`）。
- `networkMode = public` 且令牌缺失或非法 → **阻止保存**，提示前往 Klei 生成令牌。
- 字段非法（人数、模式枚举等）→ 阻止保存并字段级提示。
- 从 `public` 切到 `offline`/`lan_only` → 不要求删令牌文件；UI 说明「将不再向 Klei 列表注册」。
- 读取时 `cluster.ini` 与磁盘 `cluster_token.txt` 不一致（如 ini 为公网但无令牌）→ `GET` 返回 `warnings`，引导用户补全令牌或改模式。

## 8. 非功能要求

- 配置读写应原子化，避免文件损坏。
- 令牌仅存在于实例安装目录，权限随实例目录策略；面板 API 传输使用 HTTPS（生产）且不落库明文（若未来持久化须加密，M1 默认**仅写文件、不入 DB**）。

## 9. 验收标准

- 三种联网模式可保存，且 `cluster.ini` 中 `offline_cluster` / `lan_only_cluster` 与所选模式一致。
- 公网模式：粘贴令牌后生成 `cluster_token.txt`，重启实例后可被 Klei 注册（人工在游戏浏览列表或 Klei 侧验证）。
- 离线/仅局域网模式：无令牌亦可保存与启动；不误报缺少令牌。
- `GET` 不泄露令牌明文；日志中无可检索的完整 `pds-` 串。
- 运行中修改后有明确重启提示；与实例启停（模块 02）无状态冲突。
- 与 FDS-04：`shard_enabled` 开关保存后，洞穴编排行为符合 FDS-04 规则。

## 10. 实现落点（Community v1）

| 层级 | 路径 |
|------|------|
| 契约 | `shared/contracts/cluster.ts` |
| 后端模块 | `server/src/modules/cluster/index.ts` |
| 适配层 | `server/src/infra/game-adapter/dst/cluster-service.ts`、`cluster-ini.ts`、`cluster-token.ts` |
| 前端 API | `src/api/modules/cluster.ts`（`cluster.fake.ts`） |
| 前端页面 | `src/views/cluster/index.vue`、`settings.vue` |

## 11. 后续里程碑（Pro / 增强）

- 多 Cluster 管理（Pro）
- 房间配置模板库（Pro）
- Klei 令牌过期/轮换引导（若官方行为变更再评估）
- 令牌文件上传（v1 已明确不做，若 Pro 需要再评估）
