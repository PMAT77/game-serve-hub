# FDS-09：游戏实例控制台

- **里程碑**：M1  
- **优先级**：P0  
- **状态**：v1 已实现基础能力，增强项未做

## 1. 背景与目标

为**单个游戏实例**提供实时日志与命令下发，支持 DST 常用运维快捷操作；与**主机监控台**（FDS-01）严格区分。

## 2. 用户角色与前置条件

- 实例属于 `local-node`。  
- 命令下发需要实例 `running`（M0：对应容器 running）。

## 3. 名词

- **SSE 日志流**：`GET /app/instance/console/stream`  
- **预设命令**：面板维护的只读快捷按钮，映射到实际 Lua

## 4. 用户故事

1. **我希望**实时看服务器日志，**以便**排错。  
2. **我希望**发送 Lua 命令，**以便**保存、回档。  
3. **我希望**一键点「保存」「回档」而不用记命令，**以便**降低门槛。

## 5. 页面与信息架构

路径：`/node/instance/console/:instanceId`（`menu: false`，`activeMenu: /node/instance`）

| 区域 | 功能 |
|------|------|
| 日志区 | 自动滚动、清空、复制、下载（P1） |
| 输入区 | 命令输入框、发送、历史 ↑↓ |
| 快捷区 | 按 gameCode 渲染按钮 |
| 状态条 | running/stopped、当前 shard（规划） |

## 6. 功能点清单

| 功能 | 版本 | 状态 |
|------|------|------|
| SSE + 轮询日志 | Community | [x] |
| stdin / exec 发令 | Community | [x] |
| 清空/复制/自动滚动 | Community | [x] |
| M0 Docker logs 对接 | Community | [ ] |
| 命令历史与补全 | Community | [ ] |
| DST 预设：保存、回档 1–6、重置 | Community | [ ] |
| 重置二次确认 | Community | [ ] |
| 日志下载 | Community | P1 |
| 按 Shard 切换日志流 | Community | P1 |
| 审计记录命令 | Pro | [ ] |

### DST 预设命令表（v1）

| 显示名 | 下发内容 | 确认级别 |
|--------|---------|---------|
| 保存 | `c_save()` | 无 |
| 回档 1 天 | `c_rollback(1)` | 一级确认 |
| … 6 天 | `c_rollback(6)` | 一级确认 |
| 重置世界 | `c_reset()` | 二级确认 |

## 7. 数据与 API

- 已有：[API.md](../API.md) §6  
- 规划：`GET /app/instance/console/commands?instanceId=`  
- M0：`ContainerRuntime.logs` + `exec` 替代 `instanceRuntimeRegistry`

## 8. 异常与边界

| 场景 | 行为 |
|------|------|
| 未运行发送命令 | 业务错误提示 |
| 非白名单自由命令 | v1 允许任意 Lua（管理员信任）；后续可加开关 |
| SSE 断线 | 前端重连 |
| 面板重启 | 内存日志丢失；M0 从 Docker 拉历史 |

## 9. 验收标准

- [ ] running 时发 `c_save()` 日志有反馈。  
- [ ] stopped 时发送被拒绝。  
- [ ] 快捷按钮与手动输入效果一致。  
- [ ] 重置必须二次确认。

## 10. 不在本期范围

- 多实例日志聚合  
- 图形化玩家管理（见 FDS-10）

## 11. 依赖

- [FDS-02](02-node-instance.md)、[FDS-00](00-install-runtime.md)  
- [DST-OPS.md](../DST-OPS.md) §3

---

*实现：`server/src/modules/console`、`src/views/node/instance/console.vue`*
