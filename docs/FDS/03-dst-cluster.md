# FDS-03：DST 房间管理（Cluster）

- **里程碑**：M1  
- **优先级**：P0  
- **状态**：未实现（安装时仅写死 `Cluster_1`）

## 1. 背景与目标

将 DST **房间**（Cluster）从隐式默认改为可配置实体，管理员通过表单管理 `cluster.ini`，无需手动编辑文件。

## 2. 用户角色与前置条件

- 已存在实例且安装完成（`stopped` 或 `running`）。  
- v1：**1 实例 : 1 Cluster**（[ADR-002](../adr/002-one-instance-one-cluster.md)）。

## 3. 名词

- **Cluster**：`{installPath}/klei-storage/DoNotStarveTogether/{clusterName}/`  
- **cluster.ini**：房间级配置

## 4. 用户故事

1. **我希望**设置房间名与密码，**以便**朋友能搜房或直连。  
2. **我希望**调整最大玩家与游戏模式，**以便**匹配玩法。  
3. **我希望**切换离线/LAN 专房，**以便**控制可见性。

## 5. 页面与信息架构

**推荐**：实例详情页 Tab「房间」，或菜单「饥荒 → 房间」并带 `instanceId` 查询参数。

| 区块 | 字段（示例） |
|------|-------------|
| 基本信息 | 房间名、描述、密码 |
| 网络 | 离线房、仅 LAN、最大玩家 |
| 玩法 | game_mode、pvp、pause_when_empty、cluster_intention |
| 洞穴开关入口 | 跳转世界管理（shard_enabled 与 FDS-04 联动） |

保存按钮；若需重启生效则弹窗说明。

## 6. 功能点清单

| 功能 | 版本 |
|------|------|
| 读取并解析 cluster.ini | Community |
| 表单保存写回文件 | Community |
| 创建实例时初始化默认 Cluster | Community |
| 自定义 clusterName（非 Cluster_1） | Community |
| Cluster 配置模板库 | Pro |
| 一实例多 Cluster | 不在 v1 |

## 7. 数据与 API

### 7.1 文件

路径见 [DOMAIN.md](../DOMAIN.md)。关键键：

```ini
[NETWORK]
cluster_name =
cluster_password =
offline_cluster =
lan_only_cluster =
max_players =

[GAMEPLAY]
game_mode =
pvp =

[SHARD]
shard_enabled =    # 与洞穴启用联动
```

### 7.2 API（规划）

- `GET /app/instances/:instanceId/cluster`  
- `PUT /app/instances/:instanceId/cluster`  

响应为结构化对象，非原始 ini 文本（高级用户走 FDS-07 原始编辑）。

## 8. 异常与边界

| 场景 | 行为 |
|------|------|
| 实例 installing | 只读或不可进入 |
| 运行中修改需重启 | 提示「保存后需重启 Master/Caves」；提供「保存并重启」 |
| 非法字符 in 房间名 | 校验拒绝（过滤换行引号） |
| 文件缺失 | 按模板重新生成 |

## 9. 验收标准

- [ ] 修改房间名保存后，cluster.ini 一致。  
- [ ] 重启后进服看到新房间名。  
- [ ] 密码房需密码进入。  
- [ ] 与 [ACCEPTANCE](../ACCEPTANCE.md) 场景 C 一致。

## 10. 不在本期范围

- 多 Cluster 管理 UI  
- Steam 房间列表高级运营功能

## 11. 依赖

- [FDS-02](02-node-instance.md) installPath  
- [FDS-04](04-dst-shard.md) shard_enabled  
- [DST-OPS.md](../DST-OPS.md)

---

*参考现有生成逻辑：`buildDstClusterIni` in `server/src/modules/instance/index.ts`*
