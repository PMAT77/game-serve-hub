# 技术选型报告

## 1. 目标与原则

- 在 v1 阶段优先保证“可部署、可运行、可维护”。
- 选型遵循：成熟稳定、学习成本可控、与自托管场景匹配。

## 2. 技术栈总览

## 2.1 前端

- **框架**：Vue 3 + TypeScript + Composition API
- **构建**：Vite
- **UI**：Naive UI + Fantastic-admin 组件体系
- **状态管理**：Pinia
- **表单验证**：vee-validate + zod
- **图表**：ECharts

### 2.2 后端

- **运行时**：Node.js
- **框架**：Fastify
- **数据库访问**：Drizzle ORM
- **容器编排接口**：dockerode
- **配置校验**：Zod

### 2.3 数据与部署

- **数据库**：SQLite
- **容器运行时**：Docker
- **部署模式**：本地开发 + Docker Compose

## 3. 关键选型理由

### 3.1 Vue + Fastify 同仓

- 前后端统一 TypeScript 生态，协作成本低。
- 单仓工程便于快速追踪接口与页面联动问题。

### 3.2 SQLite + Drizzle

- 轻量自托管成本低，适合 v1 起步规模。
- Drizzle 的 schema 与迁移可读性好，易维护。

### 3.3 Docker Runtime

- 统一安装与运行路径，降低宿主机环境差异。
- 可为后续多节点与隔离策略提供基础。

## 4. 备选方案与取舍

| 维度 | 备选方案 | 当前选择 | 取舍结论 |
|---|---|---|---|
| 后端框架 | Express / NestJS | Fastify | 选择更轻量与高性能路径 |
| 数据库 | PostgreSQL / MySQL | SQLite | 优先部署简单，后续可迁移 |
| 前端 UI | Element Plus / Ant Design Vue | Naive UI | 与现有工程风格更一致 |
| 编排层 | 直接宿主机进程 | Docker | 隔离性与一致性更好 |

## 5. 风险与技术债

- 规划态模块较多，文档与实现同步压力大。
- SQLite 在多节点并发场景下存在扩展上限。
- 当前 API 权限粒度控制需继续完善。

## 6. 后续演进建议

- 增加统一任务调度与审计中台能力（模块 11/12）。
- 根据规模评估数据库升级路径。
- 建立适配器注册中心，支持多游戏扩展。
