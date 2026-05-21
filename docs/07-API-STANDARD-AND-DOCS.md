# 接口设计规范与 API 文档

## 1. RESTful API 设计规范

### 1.1 基础约定

- 基础路径：`/app/*`（业务）与 `/api/*`（基础元信息）。
- 数据格式：`application/json`，统一响应壳。
- 鉴权头：`token`（大小写兼容），未授权返回统一错误码。

### 1.2 响应结构

```json
{
  "status": 1,
  "error": "",
  "code": "OK",
  "data": {},
  "requestId": "..."
}
```

### 1.3 设计规则

- 资源查询优先 `GET`，复杂检索可使用 `POST /.../list`。
- 动作型操作（启动、停止、更新）使用 `POST`。
- 接口字段命名保持统一，错误码可枚举。

## 2. 接口清单（当前实现）

## 2.1 认证与路由

- `GET /app/route/list`：获取菜单路由树
- `POST /app/account/login`：登录
- `POST /app/account/logout`：登出
- `GET /app/account/permission`：权限列表
- `POST /app/account/password/edit`：修改密码

### 2.2 系统能力

- `GET /app/system/settings`
- `POST /app/system/settings`
- `GET /app/system/filesystem/directories`
- `GET /app/system/filesystem/search`
- `GET /app/system/steamcmd/config`
- `POST /app/system/steamcmd/config`
- `POST /app/system/steamcmd/install`
- `GET /app/system/info`
- `GET /app/system/network/realtime`
- `GET /app/system/network/config`
- `POST /app/system/network/config`
- `POST /app/system/network/validate`
- `POST /app/system/network/apply`

### 2.3 节点能力

- `POST /app/node/local/register`
- `POST /app/node/list`

### 2.4 实例能力

- `POST /app/instance/list`
- `GET /app/instance/games`
- `GET /app/instance/install-log`
- `POST /app/instance/create`
- `POST /app/instance/check-updates`
- `POST /app/instance/update`
- `POST /app/instance/start`
- `POST /app/instance/stop`
- `POST /app/instance/restart`
- `POST /app/instance/delete`
- `POST /app/instance/metrics`

### 2.5 控制台能力

- `GET /app/instance/connect-info?instanceId=`：DST 直连命令与房间摘要（`InstanceConnectInfoDto`；不写入控制台日志）
- `GET /app/instance/console/logs?instanceId=&afterId=&stream=`（`stream` 可选：`game` | `panel`，省略为全部）
- `POST /app/instance/console/logs/clear`
- `POST /app/instance/console/command`
- `GET /app/instance/console/stream`（SSE）

### 2.6 房间配置（Cluster，模块 03）

- `GET /app/instance/cluster?instanceId={instanceId}`：读取 DST 房间配置（`ClusterConfigDto`；令牌仅掩码）
- `PUT /app/instance/cluster`：保存房间配置（`ClusterSavePayload`；可选 `restart: true` 保存后重启）
- 保存且 `shardEnabled=true` 时：服务端幂等生成 `Caves/server.ini` 与 `worldgenoverride.lua`（`writeFileIfMissing`，不覆盖已有洞穴配置）

### 2.7 世界配置（Shard，模块 04）

- `GET /app/instance/shards?instanceId={instanceId}`：分片列表与运行状态（`ShardListDto`）
- `PUT /app/instance/shards`：保存单个分片配置（`ShardSavePayload`：`shard` 为 `master` | `caves`；可选 `restart: true`）
- `POST /app/instance/shards/init-caves?instanceId={instanceId}`：幂等补全洞穴默认文件（修复用；常规流程由房间保存开启分片触发）

### 2.8 基础能力

- `GET /health`
- `GET /api/ping`
- `GET /api/meta/runtime`

## 3. 关键接口详细定义（示例）

### 3.1 登录

- **接口**：`POST /app/account/login`
- **输入**：`{ account, password }`
- **输出**：`{ token, userInfo, mustChangePassword }`
- **异常**：账号/密码错误、账户状态异常

### 3.2 创建实例

- **接口**：`POST /app/instance/create`
- **输入**：`{ name, nodeId, gameCode, installPath?, ports? }`
- **输出**：实例基础信息与初始状态
- **异常**：参数非法、节点不可用、运行时不可用、目录冲突

### 3.3 启动实例

- **接口**：`POST /app/instance/start`
- **输入**：`{ instanceId }`
- **输出**：`{ isSuccess }`
- **异常**：实例不存在、状态不允许、容器操作失败

### 3.4 查询安装日志

- **接口**：`GET /app/instance/install-log?instanceId=...`
- **输出**：安装文本、状态摘要、进度信息
- **异常**：实例不存在、日志不可读

### 3.5 读取 / 保存房间配置

- **读取**：`GET /app/instance/cluster?instanceId=...`
- **保存**：`PUT /app/instance/cluster`，body 含 `instanceId` 与表单字段；公网模式可带 `clusterToken`（仅提交时传入，响应不回显明文）
- **输出**：读取为 `ClusterConfigDto`（含 `warnings`、`effectiveHints`、`configDirty`）；保存为 `{ saved: true, restarted?: boolean }`
- **异常**：实例不存在、非 DST、安装目录缺失、公网无令牌、字段校验失败
- **分片**：`shardEnabled=true` 保存时自动生成洞穴默认配置（不再因缺少 `Caves/server.ini` 拒绝保存）

### 3.6 读取 / 保存世界（分片）配置

- **读取**：`GET /app/instance/shards?instanceId=...` → `ShardListDto`（含 `clusterShardEnabled`、Master/Caves 容器状态与端口摘要）
- **保存**：`PUT /app/instance/shards`，body 含 `instanceId`、`shard`、`serverPort`、`steamAuthPort`、`steamMasterPort`、`worldgenPreset`
- **规则**：`shard=caves` 时要求房间已开启分片（`cluster.ini` `shard_enabled=true`）；Master/Caves 端口不得冲突
- **输出**：保存为 `{ saved: true, restarted?: boolean }`
- **异常**：实例不存在、非 DST、未开房间分片却保存洞穴、端口互斥、字段非法
- **实例启动**：`shard_enabled=true` 时启 Master 后启 Caves；`false` 时仅 Master；缺洞穴配置时启动前自愈（见 FDS-04）

## 4. 接口鉴权与安全要求

- 登录外的大多数 `/app/*` 接口必须鉴权。
- 会话失效需统一触发登出流程。
- 高风险操作需记录审计信息（模块 12 规划落地）。
- 文件系统接口必须限制可访问根路径，禁止危险目录越权。

## 5. 接口版本管理策略

### 5.1 当前策略

- v1 使用无版本前缀路径，依赖变更兼容原则。

### 5.2 后续策略

- 当出现不兼容变更时，引入 `/app/v2/*` 命名空间。
- 新增字段优先后向兼容，不删除旧字段直至迁移窗口结束。
- 版本升级需同步更新：
  - API 文档
  - 前端 API 封装
  - FDS 对应章节

## 6. 规划态接口域

- 模块 **03** 房间配置接口已上线（见 §2.6、§3.5；FDS-03）。
- 模块 **04** 世界（分片）接口已上线并已验收（2026-05-21；见 §2.7、§3.6；FDS-04 §9；回归 `docs/M0-M1-REGRESSION.md` §M1 Shard 验收记录）。
- 模块 05/06/07/08/10/11/12 当前为规划态，接口定义详见对应 FDS。
- 规划态接口不得在外部文档中标记为“已可用”。
