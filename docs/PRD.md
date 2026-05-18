# GameServerHub 产品需求说明（PRD）

> 精简版：愿景与 v1 边界。执行排期见 [TODO.md](TODO.md)；功能细节见 [FDS/](FDS/)。  
> 最后更新：2026-05-18

## 1. 文档说明

本文档描述 **为什么做、为谁做、做到什么算成功**，不替代：

- 执行排期与 Community/Pro 边界 → [TODO.md](TODO.md)（§2、§8、§9）
- 交互与验收细节 → [FDS/](FDS/)
- 技术实现 → [ARCHITECTURE.md](ARCHITECTURE.md)

## 2. 产品愿景

打造 **Steam 游戏一键开服面板**：让无运维经验的玩家能在自有服务器上快速部署并管理专用服务器。

- **Community（开源）**：单节点 DST 全流程闭环，可自托管。
- **Pro（商业）**：在闭环上售卖省心（自动化、云备份）、规模（多节点等），M3 前以 `GSH_EDITION` 功能开关占位。

> 非 Klei / Valve 官方产品；饥荒相关内容仅用于兼容专用服务器配置。

## 3. 目标用户

| 用户 | 核心诉求 |
|------|---------|
| 个人开服玩家 | ≤10 分钟装面板，≤15 分钟 DST 可进服 |
| 小团队/公会 | 房间/世界/Mod/备份可视化，少碰 SSH |
| 云厂商运营（v2+） | 标准 Compose、预装镜像 |

v1 **不面向**：大型多租户平台、复杂企业 RBAC（v2+）。

## 4. v1 产品范围

### 必须交付

- **游戏**：仅 DST（Steam AppID `343050`）。
- **部署**：Linux，面板 + SteamCMD + 游戏实例全容器化（[ADR-001](adr/001-full-containerization.md)）。
- **节点**：单本地节点（`local-node`）。
- **模块**：安装、监控、实例、DST 房间/世界、配置、控制台、Mod、备份、文件（见 [TODO.md](TODO.md) §3）。

### 明确不做（v1）

- 第二款游戏、多节点 Agent、云 SaaS 控制面、白标、Windows 安装包、多用户 RBAC。

### 成功指标

| 指标 | 目标 | 验证 |
|------|------|------|
| 安装 | ≤ 10 分钟 | [ACCEPTANCE.md](ACCEPTANCE.md) 场景 A |
| 开服 | ≤ 15 分钟（Master 可进服） | 场景 C |
| 面板空闲 | CPU &lt; 5%，内存 &lt; 200MB | 监控台 |
| 质量 | 阻塞/严重 Bug 0；一般 ≤ 10 | 发布清单 |
| 商业就绪 | Community 可独立闭环；Pro 边界见 TODO §8 | 对照 §8 与实现 |

## 5. 相关文档

- [TODO.md](TODO.md) — 里程碑、任务、Community/Pro  
- [DOMAIN.md](DOMAIN.md) — 名词与数据模型  
- [FDS/README.md](FDS/README.md) — 功能设计索引  
- [ACCEPTANCE.md](ACCEPTANCE.md) — 发布验收  

---

*PRD 变更需同步评估 [TODO.md](TODO.md) 里程碑。*
