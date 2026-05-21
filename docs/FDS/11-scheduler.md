# FDS-11：计划任务

- 里程碑：M3（Pro-only）
- 优先级：P1
- 状态：规划态
- Edition：**pro-only**（Community 仅升级引导）

## 1. 背景与目标

提供可配置的自动化任务能力，减少重复人工运维操作。本模块**整体归 Pro**，Community 版不实现调度核心。

## 2. 角色与前置条件

- 角色：管理员（Pro 许可证已激活）
- 前置：实例与系统模块可提供可调用动作；License entitlement `scheduler`

## 3. 功能范围

- 定时执行实例级任务（启停、更新检查、备份触发）
- 定时执行系统级任务（清理、巡检）
- 任务 CRUD、启停、手动触发
- 执行历史查询与失败追溯

## 4. 功能清单

| 能力 | Edition |
|------|---------|
| 升级 Pro 引导页（菜单占位） | Community |
| 任务创建/启停 | Pro |
| 执行历史查询 | Pro |
| 失败重试与通知联动 | Pro |
| 任务编排模板（后续） | Pro |

## 5. 接口与输入输出（规划，Pro 包）

- `POST /app/schedules`
- `GET /app/schedules`
- `POST /app/schedules/:id/run`
- `GET /app/schedules/:id/history`

Community 不暴露上述 API；未激活 Pro 时返回 404 或由路由未注册处理。

输入示例：

```json
{
  "name": "nightly-backup",
  "cron": "0 3 * * *",
  "action": "instance.backup",
  "targetId": "instance-001",
  "enabled": true
}
```

## 6. 业务规则

- 任务动作必须来自白名单。
- 同一目标互斥任务需避免并发冲突。
- 仅 `edition=pro` 且 entitlement 含 `scheduler` 时可调用。

## 7. 异常与边界

- Cron 非法 -> 阻止保存
- 执行超时 -> 标记失败并记录上下文
- Community 用户访问计划任务菜单 -> 跳转升级引导页

## 8. 非功能要求

- 任务执行日志需可追溯
- 调度器重启后任务状态可恢复

## 9. 验收标准

- Pro：任务可按计划触发；执行结果可查询；失败场景可定位原因
- Community：计划任务菜单可见；点击后展示升级 Pro 引导，无调度 API

## 10. Open Core 落点

| 字段 | 值 |
|------|-----|
| edition 类型 | `pro-only` |
| Community 实现边界 | `src/views/system/license.vue`（升级引导）；auth 动态路由占位菜单 |
| Pro 包名 | `@gsh/pro-scheduler` |
| 扩展点 ID | `pro.routes.scheduler`（Pro 包注册路由）；Community 无调度扩展点 |
| entitlement 键 | `scheduler` |
| 禁止事项 | 调度引擎、Cron 解析、任务表 CRUD 不得出现在 MIT 公开仓 |

## 11. 实现落点

### Community（MIT 公开仓）

- 动态路由：「计划任务」菜单项 → 升级引导组件
- 无 `server/src/modules/scheduler/` 业务实现

### Pro（`@gsh/pro-scheduler` 私有包）

- `registerSchedulerModule(app, ctx)` — 路由、调度引擎、DB migration
- 前端：`scheduler/` 视图与 API 封装
- 依赖：实例/备份等模块的可编排动作接口（Community 侧保持稳定契约）

## 12. 后续里程碑

- 任务编排模板
- 依赖图与执行窗口控制
