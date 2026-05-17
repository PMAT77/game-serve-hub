# GameServerHub 项目基础与工程规范（P0-0）

> 状态：已落地（首版）  
> 最后更新：2026-05-17

## 1. 目录边界（Monorepo / app 内）

`apps/game-server-hub` 采用「前端 + 后端 + 共享契约」三层边界：

- `src/`：前端应用（Vue 3 + Vite）
  - `views/<domain>/`：路由页面入口（薄 `index.vue`）+ 同域 `components/`、`utils.ts`
  - `api/`：前端 API 调用层
  - `store/`：Pinia 状态层（框架级，业务状态放 views 子目录 composables 或组件内）
- `server/src/`：后端应用（Fastify）
  - `modules/*`：业务模块入口
  - `shared/*`：后端共享基础能力（配置、DB、HTTP 响应等）
  - `infra/*`：外部系统适配层（Docker/SteamCMD/OS 等）
- `shared/`：前后端共享契约层（无运行时副作用）
  - `constants/`：共享常量（错误码、状态键）
  - `contracts/`：共享响应/请求类型契约
  - `types/`：共享类型
- `docs/`：需求、规范、执行清单文档

## 2. 命名规范

- 目录名：小写短词，按业务域命名（`auth`、`system`、`instance`）。
- 文件名：
  - Vue 组件：`PascalCase.vue`
  - TS 模块：`kebab-case.ts` 或 `index.ts` 作为出口
- 符号命名：
  - 类型/接口：`PascalCase`
  - 变量/函数：`camelCase`
  - 常量：`UPPER_SNAKE_CASE`（仅常量表内部键值可保持业务语义）

## 3. 分层约定

### 前端分层

`views -> api`（类型契约优先对齐 `shared/contracts`，前端 API 模块可逐步引用）

- `views/<domain>/index.vue` 仅做页面编排与路由入口，不承载重业务逻辑。
- `views/<domain>/components/` 承载该域业务组件；复用逻辑可提取为同目录 `composables/` 或 `utils.ts`。
- `api` 只负责请求封装，不放业务状态。

### 后端分层

`route(module) -> service/usecase -> domain -> repository/infra`

- 模块对外仅通过 `modules/*/index.ts` 注册。
- 跨模块复用能力沉淀到 `server/src/shared/*`。
- 禁止跨模块直接访问内部实现文件。

## 4. 本地一键启动规范

在 `apps/game-server-hub` 下统一使用：

- `pnpm run dev:prepare`：初始化运行时目录（数据库、日志）并输出环境加载信息。
- `pnpm run dev`：一键启动前后端，默认串行执行 `dev:prepare` 后并行启动 `dev:web` 与 `dev:server:watch`。

数据库采用 SQLite，本地开发默认路径：

- `server/data/game-server-hub.sqlite`

日志目录默认路径：

- `server/logs/`

## 5. 环境变量与配置校验

- 环境分层：`server/.env.development`、`server/.env.test`、`server/.env.production`
- 启动流程统一经 `server/src/shared/config/index.ts` 加载与校验（`zod`）：
  - `SERVER_HOST`
  - `SERVER_PORT`
  - `DB_PATH`
  - `SERVER_LOG_DIR`
  - `LOG_LEVEL`

配置校验失败应在启动阶段直接失败，不允许带错运行。

## 6. 统一错误码、日志、响应结构

### 错误码

- 统一定义：`shared/constants/error-code.ts`
- 已定义基础码：`OK`、`COMMON_INVALID_PARAMS`、`COMMON_BUSINESS_RULE_VIOLATION`、`AUTH_UNAUTHORIZED`、`COMMON_NOT_FOUND`、`COMMON_INTERNAL_ERROR`

### 响应结构

统一约定为：

- 成功：`{ status: 1, error: '', code, data, requestId }`
- 业务失败：`{ status: 1, error: '...', code, data: {}, requestId }`
- 鉴权失败：`{ status: 0, error: '...', code, data: {}, requestId }`

### 日志

- Fastify logger 统一挂载 `service`、`env` 基础字段。
- 所有请求输出结构化访问日志：`requestId / method / url / statusCode / durationMs`。
