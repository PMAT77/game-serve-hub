# FDS-01：面板监控台

- **里程碑**：M1  
- **优先级**：P0（增强项 P1）  
- **状态**：已实现主体，需 M0 回归

## 1. 背景与目标

让管理员一眼看到**面板所在主机**的健康状况与网络流量，区别于**游戏实例控制台**（FDS-09）。

## 2. 用户角色与前置条件

- 已登录管理员。  
- 本地节点已注册（进入页面时自动）。

## 3. 名词

- **监控台**：路由 `/console/monitor`。  
- **实例控制台**：`/node/instance/console/:instanceId`。

## 4. 用户故事

1. **我希望**看到 CPU、内存、磁盘与 Docker 概况，**以便**判断能否再开新实例。  
2. **我希望**看到网卡实时流量，**以便**发现异常带宽。

## 5. 页面与信息架构

| 区域 | 组件 | 数据源 |
|------|------|--------|
| 概览 | SystemOverviewCard | `/app/system/info` |
| CPU | CpuInfoCard、SystemLoadCard | 同上 |
| 内存 | MemoryInfoCard | 同上 |
| 磁盘 | DiskInfoCard | 同上 |
| Docker | DockerInfoCard | 同上 |
| 网络 | MonitorNetwork | `/app/system/network/realtime` |

轮询间隔：约 10s（与实现保持一致）。

## 6. 功能点清单

| 功能 | 版本 | 状态 |
|------|------|------|
| 系统信息卡片 | Community | [x] |
| 网卡流量图 | Community | [x] |
| 实例容器状态汇总 | Community | [ ] P1 |
| 端口监听摘要 | Community | [ ] P1 |
| 历史曲线 | Pro | [ ] |
| 告警规则 | Pro | [ ] |

## 7. 数据与 API

- `GET /app/system/info`  
- `GET /app/system/network/realtime`  
- 规划：`GET /app/system/containers/summary` 聚合实例容器状态

## 8. 异常与边界

| 场景 | 行为 |
|------|------|
| API 失败 | 卡片展示错误态，可重试 |
| Docker 未运行 | Docker 卡片提示未安装/未启动 |
| 多网卡 | 展示主要网卡或列表（以实现为准） |

## 9. 验收标准

- [ ] 登录后打开监控台，各卡片有数据且无持续 loading。  
- [ ] 流量图随时间变化。  
- [ ] 与实例控制台页面无菜单混淆。

## 10. 不在本期范围

-  per-实例 游戏内性能（玩家数、实体数）  
-  跨节点汇总（v2）

## 11. 依赖

- M0 后 Docker 卡片应反映真实游戏容器数量。  
- 网络配置页（系统 API 已有）前端为 P1，见 [ROUTES](../ROUTES.md)。

---

*实现：`src/views/console/monitor/`、`server/src/modules/system`*
