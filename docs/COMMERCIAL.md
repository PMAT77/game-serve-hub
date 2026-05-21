# Game Server Hub 商业与授权说明

> 最后更新：2026-05-21  
> 状态：草案（Pro 产品尚未公开发售）  
> 技术架构：[13-PRO-OPEN-CORE-ARCHITECTURE.md](./13-PRO-OPEN-CORE-ARCHITECTURE.md)  
> 功能对照：[TODO.md §5](./TODO.md#5-community--pro-功能对照表)

## 1. 产品版本

| Edition | 许可证 | 获取方式 | 说明 |
|---------|--------|----------|------|
| **Community** | [MIT](../LICENSE) | 公开 GitHub 仓库、Community Docker 镜像 | 完整自托管 DST 核心闭环 |
| **Pro** | 商业许可（另行书面协议） | Pro Docker 镜像、私有 npm 源 `@gsh/pro-*` | 自动化、多节点、企业治理等增强能力 |

Community 源代码采用 MIT 发布，**个人与组织均可自由使用、修改与再分发**（遵守 MIT 条款）。  
Pro 功能**不包含**在 MIT 默认可用范围内，须购买或签署商业许可后方可合法使用 Pro 包与 Pro 镜像。

## 2. Open Core 策略摘要

- **Community（MIT）**：公开仓库承载核心能力；利于社区贡献与二次集成。
- **Pro（商业）**：私有仓库 / 专有 npm 包，通过扩展点注入同一 Hub 运行时。
- **升级**：换 Pro 镜像或安装 Pro 包 + 激活 License + 重启；**无需重装、无需迁移实例与存档**。

详见 [13-PRO-OPEN-CORE-ARCHITECTURE.md](./13-PRO-OPEN-CORE-ARCHITECTURE.md)。

## 3. Community / Pro 功能对照

功能边界以 [TODO.md §5](./TODO.md#5-community--pro-功能对照表) 为准；下表为对外摘要。

| 模块 | 类型 | Community | Pro |
|------|------|-----------|-----|
| 00 安装运行时 | Hybrid | 安装脚本、Compose、Hub 自更新 | 运行时安全加固 |
| 02 节点实例 | Hybrid | 单节点、实例生命周期 | 远程节点、多节点调度 |
| 03 Cluster | Hybrid | 单房间配置闭环 | 多 Cluster、配置模板库 |
| 04 Shard | Hybrid | 分片配置与双容器编排 | 高级 worldgen 编辑 |
| 05 Mod | Hybrid | 列表、基础依赖提示 | 自动更新、批量策略 |
| 06 备份 | Hybrid | 手动备份与恢复 | 自动备份、云存储 |
| 07 配置中心 | Hybrid | INI/LUA 编辑与校验 | diff、导入导出 |
| 08 文件 | Hybrid | 沙箱浏览、文本编辑 | 大文件、断点续传 |
| 10 玩家访问 | Hybrid | 名单维护 | 规则策略增强 |
| **11 计划任务** | **Pro-only** | 升级引导页 | 任务 CRUD、调度引擎、执行历史、编排 |
| 12 通知审计 | Hybrid | 站内通知、关键操作审计 | 外部通知通道（邮件/Webhook 等） |
| 横切 | Pro-only | — | 许可证管理、Entitlement 中间件 |

## 4. 授权与激活（规划）

> 以下流程在 M3-d 里程碑实现；正式发布 Pro 前须律师审阅商业协议正文。

### 4.1 License Key

- 购买 Pro 后获得 License Key（格式与签发方式待定）。
- 在 Hub 面板「系统设置 → 许可证」页录入，或通过环境变量 `GSH_LICENSE_KEY` 配置。

### 4.2 校验方式

- **在线激活**：Hub 向授权服务验证 Key，缓存签名凭证。
- **离线宽限期**：默认 **30 天**；断网期间 Pro 仍可用；超期后 Pro 模块停止加载，Community 不受影响。
- 校验在**服务端**完成；Pro API 受 entitlement middleware 保护。

### 4.3 Entitlement

License 可包含一项或多项 entitlement，例如：

| 键 | 能力 |
|----|------|
| `scheduler` | 计划任务（模块 11） |
| `cloud_backup` | 自动备份与云存储 |
| `multinode` | 远程节点与多节点编排 |
| `external_notify` | 外部通知通道 |
| `config_advanced` | 配置 diff / 导入导出 |

具体 SKU 与 entitlement 组合以正式定价页为准。

## 5. 升级步骤（自托管）

1. 备份 Hub 数据目录（含 SQLite，可选但推荐）。
2. 将 Docker 镜像标签从 `community` 换为 `pro`，或按文档从私有 registry 拉取 Pro 镜像。
3. 启动容器，在面板激活 License Key。
4. 重启 Hub 服务（若安装脚本未自动重启）。
5. 确认「许可证」页显示 Pro 已激活；Pro 菜单（如计划任务）可用。
6. **实例、DST 配置、Docker 卷无需迁移**。

降级：移除 Pro 包或换回 Community 镜像后，Pro 功能不可用；Community 数据与实例配置保留。Pro 专属表数据是否保留由 Pro migration 策略决定（正式文档发布前补充）。

## 6. 私有仓库与 npm 包（规划）

| 名称 | 说明 |
|------|------|
| `game-server-hub-pro` | 私有 Git 仓库，商业许可 |
| `@gsh/pro-core` | 许可证、路由注册、共享 Pro 基础设施 |
| `@gsh/pro-scheduler` | 模块 11 计划任务（首个 Pro 包，M3-c） |
| `@gsh/pro-audit` | 模块 12 外部通知等（M4） |

包名前缀 `@gsh/` 为规划命名，正式发布前可能调整。

## 7. 支持与联系

Pro 商业支持、定制集成、Enterprise 报价：**待定**（公开发售前在此补充联系方式）。

Community 支持：GitHub Issues / Discussions。

## 8. 免责声明

本文档为产品与授权说明草案，**不构成法律意见**。  
MIT Community 版按 [LICENSE](../LICENSE) 提供，不提供任何明示或暗示的保证。  
Pro 商业许可条款以正式签署的协议为准。正式发布 Pro 产品前，请咨询专业法律顾问。
