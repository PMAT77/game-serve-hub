# FDS-04：DST 世界（Shard）

- 里程碑：M1
- 优先级：P0
- 状态：规划态

## 1. 背景与目标

提供 Master/Caves 世界配置与运行编排，补齐 DST 多世界管理能力。

## 2. 角色与前置条件

- 角色：实例管理员
- 前置：Cluster 可用且实例已安装

## 3. 功能范围

- 分片配置读写（server.ini、worldgen）
- Caves 启用/禁用
- 分片运行状态管理

## 4. 功能清单

- 分片状态展示（Community）
- 分片配置管理（Community）
- 分片编排自动化（Community）
- 高级 worldgen 编辑（Pro 规划）

## 5. 接口与输入输出（规划）

- `GET /app/instances/:instanceId/shards`
- `PUT /app/instances/:instanceId/shards/:shard`
- 输入：分片配置对象
- 输出：分片状态与配置生效结果

## 6. 业务规则

- 禁止仅启用 Caves 而不启用 Master。
- 配置变更需提示重启影响。

## 7. 异常与边界

- 端口冲突 -> 禁止启动并给出冲突端口
- 配置错误 -> 阻止保存

## 8. 非功能要求

- 分片操作需保证顺序与状态一致性

## 9. 验收标准

- 可完成 Master/Caves 配置管理闭环
- 分片启停行为可预测且可观测

## 10. 后续里程碑

- 高级生成参数模板
- 分片级日志与命令分流
