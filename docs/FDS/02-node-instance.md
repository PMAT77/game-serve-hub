# FDS-02：节点与游戏实例

- **里程碑**：M0/M1  
- **优先级**：P0  
- **状态**：核心已实现，M0 运行时待替换

## 1. 背景与目标

在单本地节点上完成 DST 实例全生命周期：创建 → SteamCMD 安装 → 启停 → 更新 → 删除，并为房间/世界/Mod 提供 `instanceId` 上下文。

## 2. 用户角色与前置条件

- 权限：`pages.node.instance:manage`。  
- SteamCMD 可用（M0：栈内容器）。  
- Community 实例数 ≤ 3（若启用限制，见 [TODO §8](../TODO.md#8-community--pro-功能对照表)）。

## 3. 名词

见 [DOMAIN.md](../DOMAIN.md)：**节点**、**实例**、**gameCode=343050**。

## 4. 主流程

```text
创建实例 → pending_install → installing（SteamCMD）→ stopped
    → 配置房间/世界（可并行于首次启动前）
    → start → running → stop → stopped
    → update（可选）→ delete
```

## 5. 页面与信息架构

| 页面 | 路径 | 说明 |
|------|------|------|
| 实例管理 | `/node/instance` | 节点卡片 + 实例列表/网格 |
| 创建弹窗 | — | 名称、游戏、安装路径、端口 |
| SteamCMD 面板 | 实例页内嵌 | 系统级 SteamCMD 配置入口 |
| 实例控制台 | `/node/instance/console/:id` | FDS-09 |

**规划**：独立「游戏」页 `/games` 仅 DST 卡片，点击「创建实例」带默认 gameCode。

## 6. 功能点清单

| 功能 | 版本 | 状态 |
|------|------|------|
| 本地节点注册与资源展示 | Community | [x] |
| 实例 CRUD | Community | [x] |
| 启停/重启/删除确认 | Community | [x] |
| SteamCMD 安装与进度 | Community | [x] |
| 安装日志查看 | Community | [x] |
| 手动更新服务端 | Community | [x] |
| 运行中 CPU/内存/时长 | Community | [x] |
| 容器运行时 | Community | [ ] M0 |
| 游戏市场页 | Community | [ ] |
| 实例数软限 3 | Community | [ ] 可配置 |
| 远程节点 | Pro / v2 | [ ] |

## 7. 数据与 API

- 表：`game_instances`（见 DOMAIN）  
- API：[API.md](../API.md) §4–5  
- 安装日志：`data/install-logs/` 或卷内等价路径  
- 删除实例：停止容器 → 可选删卷 → 删 DB 行（**须在 FDS 实现时明确默认是否保留存档**；建议二次确认「是否删除数据」）

## 8. 异常与边界

| 场景 | 行为 |
|------|------|
| 安装路径非法 | 创建失败，提示规则 |
| 端口冲突 | 启动失败，`last_error` 明确 |
| 安装中启停 | 按钮 disabled |
| 运行中删除 | 先停再删，强确认 |
| 服务重启后面板重启 | reconcile 将无进程实例标 stopped |
| 达实例上限 | 创建失败，Pro 升级文案 |

## 9. 验收标准

- [ ] 创建后安装成功，目录结构符合 DOMAIN。  
- [ ] 启停后状态与容器一致（M0）。  
- [ ] 指标仅在 running 时轮询。  
- [ ] 删除后无残留容器（M0）。

## 10. 不在本期范围

- 多节点、实例迁移、实例克隆

## 11. 依赖

- [FDS-00](00-install-runtime.md) ContainerRuntime  
- [FDS-03](03-dst-cluster.md)、[FDS-04](04-dst-shard.md) 配置写入同一 installPath  

---

*实现：`server/src/modules/instance`、`node`、`src/views/node/instance/`*
