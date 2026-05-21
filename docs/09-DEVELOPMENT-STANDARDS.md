# 开发规范文档

## 1. 通用规范

- 代码与文档使用 UTF-8 编码，命名语义化。
- 所有新功能必须附带对应文档更新（FDS 与 TODO）。
- 变更优先小步提交，避免跨模块无关改动。

## 2. 前端规范

- 使用 Vue 3 Composition API + `<script setup lang="ts">`。
- 优先使用 Naive UI 与框架内置组件，避免重复造轮子。
- 页面逻辑与视图解耦：复杂逻辑放入组合式函数或工具模块。
- API 调用统一经 `src/api`，禁止页面直接拼接请求层。

## 3. 后端规范

- Fastify 模块按领域拆分，路由聚合在模块入口。
- 接口遵循统一响应壳与错误码约定。
- 鉴权、参数校验、业务规则应在模块内显式实现。
- 外部依赖调用要有错误处理与日志上下文。

## 4. 数据与迁移规范

- 数据结构变更必须通过 Drizzle schema + migration 管理。
- 先迁移后依赖，避免运行态字段缺失。
- 枚举与状态字段须在文档中维护定义来源。

## 5. 文档规范

- PRS 负责需求总览，FDS 负责模块细节，TODO 负责执行状态。
- 文档状态必须明确“已实现/部分实现/规划态”。
- 禁止将规划功能描述为已交付能力。

## 6. 测试与质量规范

- 核心业务链路必须可手工回归验证。
- 新增复杂逻辑优先补充单测或最小可验证脚本。
- 改动后至少执行关键检查：类型检查、核心流程自测。

## 7. 安全规范

- 密码、Token、路径等敏感信息需最小暴露。
- 文件系统相关能力必须限制根路径与危险目录。
- 输入参数需做校验和容错处理。

## 8. 提交规范

- 提交信息采用 Conventional Commit 风格（中文语义）。
- 提交范围应准确反映变更模块。
- 不提交凭据文件、本地数据库、构建产物。

## 9. Windows 开发环境：Docker / WSL 网络异常

本节针对 **Windows + Docker Desktop（WSL2 后端）** 本地开发。典型现象：除 IDE 外其它应用网络流量为 0、浏览器/IM 无法联网；**执行 `wsl --shutdown` 后恢复**。根因多在 WSL2 虚拟网卡/NAT，而非本项目修改系统代理或 DNS。

### 9.1 与项目的关系

| 操作 | 风险 |
|------|------|
| 仅 `pnpm dev`（Vite + 本机 API） | 较低 |
| 启停实例、SteamCMD 安装、拉 Docker 镜像 | 较高 |
| Docker Desktop 常驻后台 | 中等 |

不做实例/Docker 相关功能时，可退出 Docker Desktop，仅跑 `pnpm dev`。

### 9.2 恢复顺序（从轻到重）

1. **Docker Desktop → Restart**（托盘图标或 Settings）。
2. 仍异常：在 PowerShell（管理员可选）执行：
   ```powershell
   wsl --shutdown
   ```
   然后重新打开 Docker Desktop，再执行 `pnpm dev`。  
   **注意**：会停止所有 WSL 发行版中的进程，不仅是 Docker。
3. 仍异常：重启 Windows 主机（最后手段）。

### 9.3 预防建议

- 使用实例/安装功能时再开启 Docker Desktop。
- 已关闭 VPN 仍复发时，检查是否与代理/杀软的网络 Hook 冲突。
- 大流量操作（拉 `ghcr.io` 镜像、SteamCMD 安装）期间避免同时压测网络。

Linux 生产环境排障见 [10-OPERATIONS-RUNBOOK.md](./10-OPERATIONS-RUNBOOK.md)。

## 10. Open Core / Pro 开发约束

涉及 Community / Pro 分层的模块须遵循 [`13-PRO-OPEN-CORE-ARCHITECTURE.md`](./13-PRO-OPEN-CORE-ARCHITECTURE.md)。开工前：

1. 在 FDS 中写明 **Open Core 落点**（edition 类型、Community 路径、Pro 包名、entitlement 键）。
2. 确认模块 edition：`community-only` / `hybrid` / `pro-only`（对照 [`TODO.md`](./TODO.md) §5）。

**禁止**

- 在 MIT 公开仓提交 Pro 业务逻辑（调度引擎、Pro-only API 实现、Pro 专有 DB migration）。
- Hybrid 模块在 Community API 返回 Pro 字段占位假数据。
- Hybrid 模块在 MIT 仓实现「灰态不可用」的 Pro UI 控件（应显示「升级 Pro」引导）。

**Community 仓允许**

- 扩展点接口与 no-op stub（M3-b 起）。
- Pro-only 模块的菜单占位与升级引导页。
- Hybrid 模块的基础能力与稳定扩展点（事件 / 端口 interface）。

**Pro 私有包**

- 包名 `@gsh/pro-*`；通过 `ProModuleRegistrar.register()` 注入路由与 migration。
- API 须挂载 entitlement middleware；校验在服务端完成。

功能边界与 entitlement 键见 [`TODO.md`](./TODO.md) §5 与 [`COMMERCIAL.md`](./COMMERCIAL.md)。
