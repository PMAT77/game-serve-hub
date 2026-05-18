# FDS-04：DST 世界管理（Shard）

- **里程碑**：M1  
- **优先级**：P0  
- **状态**：未实现（仅默认 Master，无 Caves 容器）

## 1. 背景与目标

管理 DST **分片**：地表 Master 与洞穴 Caves 的配置、启停编排与 worldgen 预设，匹配全容器化双容器模型。

## 2. 用户角色与前置条件

- 实例已安装；Cluster 已存在（FDS-03）。  
- M0：Master/Caves 各对应独立容器。

## 3. 名词

- **Shard**：`Master` | `Caves`  
- **worldgenoverride.lua**：地图生成脚本

## 4. 用户故事

1. **我希望**启用洞穴，**以便**玩家可下洞。  
2. **我希望**选择地图预设（如 SURVIVAL_TOGETHER），**以便**快速开服。  
3. **我希望**单独配置地表与洞穴端口，**以便**避免冲突。

## 5. 页面与信息架构

实例上下文 Tab「世界」：

| 区块 | 内容 |
|------|------|
| Master | 状态、端口、worldgen 预设、启动/停止 |
| Caves | 启用开关、状态、端口、worldgen（可与 Master 联动预设） |
| 操作 | 「应用并重启」、启停顺序说明 |

## 6. 功能点清单

| 功能 | 版本 |
|------|------|
| 展示 Master/Caves 运行状态 | Community |
| 启用/禁用洞穴（创建 Caves 目录与容器） | Community |
| 编辑 server.ini 端口段 | Community |
| worldgen 预设下拉 | Community |
| 启停编排（先 Master 后 Caves） | Community |
| 高级 worldgen overrides 表单 | Pro |
| 自定义 lua 上传 | Pro 或 P2 |

## 7. 数据与 API

### 7.1 文件

- `Master/server.ini`、`Caves/server.ini`  
- `Master/worldgenoverride.lua`、`Caves/worldgenoverride.lua`

### 7.2 API（规划）

- `GET /app/instances/:instanceId/shards`  
- `PUT .../shards/:shard`  
- `POST .../shards/caves/enable` | `disable`

### 7.3 容器命名（建议）

- `game-{instanceId}-master`  
- `game-{instanceId}-caves`

## 8. 异常与边界

| 场景 | 行为 |
|------|------|
| 仅启 Caves 不启 Master | 禁止 |
| 禁用洞穴 | 停 Caves 容器，可选保留存档目录 |
| 端口与宿主机冲突 | 启动失败，明确 shard 名 |
| 运行中改 worldgen | 需重启并警告可能重置部分生成 |

## 9. 验收标准

- [ ] 启用洞穴后两容器 running，客户端可下洞（[ACCEPTANCE](../ACCEPTANCE.md) D）。  
- [ ] 停止顺序正确，无损坏存档告警。  
- [ ] 预设变更后新生成符合预期（新档/重置场景测）。

## 10. 不在本期范围

- 更多 Shard 类型（非 DST 标准）  
- 跨实例复制世界

## 11. 依赖

- [FDS-00](00-install-runtime.md)、[FDS-03](03-dst-cluster.md)  
- [FDS-09](09-console.md) 分片日志/命令（可选 v1 统一入口）

---

*启停顺序见 [DST-OPS.md](../DST-OPS.md) §4*
