# 项目结构规范文档

## 1. 目录分层总览

```text
game-server-hub-standalone/
  docs/                 # 产品、架构、FDS、TODO 与验收文档
  src/                  # 前端应用
  server/               # 后端服务
  shared/               # 前后端共享常量与契约
  packages/             # 工作区内共享包（组件、主题、配置等）
  scripts/              # 工程脚本与安装脚本
```

## 2. 前端结构规范（`src/`）

- `views/`：按业务域组织页面（console/node/system 等）。
- `api/modules/`：按领域拆分 API 封装与 mock。
- `router/`：路由定义与守卫逻辑。
- `store/modules/`：全局状态分域管理。
- `components/`：复用组件与业务通用组件。

规范要求：

- 页面只做组合与交互，复杂业务逻辑沉淀到可复用模块。
- 同一业务域的页面、API、类型尽量同层聚合。

## 3. 后端结构规范（`server/src/`）

- `modules/`：业务模块（auth/system/node/instance/console）。
- `infra/`：运行时与平台基础设施能力（docker、adapter、filesystem）。
- `shared/`：配置、数据库、响应封装、通用工具。
- `main.ts/bootstrap.ts/app.ts`：服务启动与装配入口。

规范要求：

- 模块按“路由入口 + 领域服务 + 类型定义”组织。
- 禁止跨模块直接耦合内部实现，优先通过共享层抽象。

## 4. 文档结构规范（`docs/`）

- `01-11` 主文档：面向产品、技术、验收的一致性说明。
- `FDS/`：按模块编号维护详细设计（0-14）。
- `TODO.md`：项目执行状态唯一清单。

规范要求：

- 所有模块能力在 PRS/FDS/TODO 三处需可对齐。
- 删除或重命名文档时必须同步更新引用关系。

## 5. 共享与包规范

- `shared/` 放置跨端共享类型、错误码、契约。
- `packages/` 放置可复用 UI、配置与工具包，不承载业务状态。

## 6. 命名规范

- 文件名优先采用语义化英文或编号+主题模式。
- 模块目录与文档模块 ID 一致，便于自动化检索。
- 新增规划态模块需在 `docs/FDS` 与 `docs/TODO.md` 同步登记。

## 7. 变更流程规范

1. 先确认模块边界与 FDS。
2. 再进行代码实现。
3. 完工后同步 TODO 与主文档。
