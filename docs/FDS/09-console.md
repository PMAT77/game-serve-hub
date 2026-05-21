# FDS-09：实例控制台

- 里程碑：M1
- 优先级：P0
- 状态：已实现（连接信息卡片、分 Tab UI；命令模板/审计等增强项归 M1+）

## 1. 背景与目标

为**已启动**的 DST 实例提供运行时观测与游戏内运维：连接信息、游戏进程日志、Lua 命令下发。与主机监控台、实例生命周期管理职责分离。

## 2. 角色与前置条件

- 角色：实例管理员
- 前置：实例存在；控制台接口可访问；写命令需实例容器运行中

## 3. 职能边界（与相邻模块）

| 模块 | 入口 | 职责 | 不在本模块 |
|------|------|------|------------|
| 01 监控台 | `/console/monitor` | 主机 CPU/内存/网络 | 单实例游戏日志 |
| 02 实例管理 | 实例列表 | 创建/安装/启停/更新/删除 | 重复启停按钮 |
| 09 实例控制台 | `instance/console/:id` | 连接信息、游戏日志、游戏命令 | 主机指标、实例 CRUD |

## 4. 页面信息架构

- **连接与加入**（固定卡片）：`GET /app/instance/connect-info` 返回直连命令与房间摘要；**不写入**滚动日志。
- **运行日志** Tab：Docker 主世界 `stdout`/`stderr`（排障）。
- **游戏控制** Tab：快捷指令（`c_save`、`c_rollback` 等）+ 自定义命令输入；危险操作（如 `c_reset`）前端二次确认。
- **面板消息** Tab：`system` 流（日志采集、分片状态、命令回显 `> …`）。

底层仍为单一日志存储 + 单 SSE；前端/API 可按 `stream=game|panel|all` 过滤。

## 5. 功能清单

- 连接信息查询（Community，自动探测公网 IP）
- 实时日志（Community，轮询 + SSE）
- 命令执行（Community）
- 命令模板与审计（规划）

## 6. 接口与输入输出

- `GET /app/instance/connect-info?instanceId=` → `InstanceConnectInfoDto`
- `GET /app/instance/console/logs?instanceId=&afterId=&stream=`（`stream`：`game` | `panel` | 省略为全部）
- `POST /app/instance/console/logs/clear`
- `POST /app/instance/console/command`
- `GET /app/instance/console/stream`（SSE）

## 7. 业务规则

- 非运行态：可读取连接信息（基于磁盘配置）；**不允许**下发控制台命令。
- DST 命令经主世界容器 stdin 注入，需服务端 `-console` 启动。
- 直连主机地址：优先 `GSH_DST_CONNECT_HOST`，否则云元数据/出站 IP 探测，再回退网卡地址（见 `connect-host.ts`）。
- 高风险命令：`c_reset` 等由 UI 二次确认；服务端审计为后续里程碑。

## 8. 异常与边界

- SSE 中断 → 前端轮询兜底
- 公网 IP 探测失败 → `isPlaceholder` + hints，可复制后手动改 IP
- 命令执行失败 → 可读业务错误

## 9. 验收标准

- 启动实例后，连接卡片始终展示 `c_connect(...)`，运行日志 Tab 无直连文本块
- 运行日志与面板消息分 Tab 展示，互不淹没
- 运行中可发送 `c_save()`，面板消息可见 `> c_save()` 回显

## 10. 后续里程碑

- 命令模板库扩展
- 命令审计追踪
- 洞穴分片日志分流（FDS-04）
- **游戏内维护公告推送**（规划，未开工）：面板维护前编辑公告并手动推送到运行中房间，配合「仅重启面板、游戏容器保持在线」运维流程；需求与检查清单见 [TODO.md §3.2.1](TODO.md)
