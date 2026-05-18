# FDS-00：安装与容器运行时

- **里程碑**：M0  
- **优先级**：P0（阻塞）  
- **状态**：部分实现（2026-05-18；**仅验收场景 A**——面板一键安装与 Compose 部署）  
- **依赖**：[ADR-001](../adr/001-full-containerization.md)、[ARCHITECTURE.md](../ARCHITECTURE.md)

**实现说明（与 FDS 偏差）**：

- **场景 C 未验收**：节点资源、实例生命周期、SteamCMD 装服、Master 启停须在 panel 容器 + Compose 栈下回归（见 [FDS-02](02-node-instance.md)、模块 2、[ACCEPTANCE](../ACCEPTANCE.md) 场景 C）。  
- Caves Shard 独立容器未在本模块交付，见 [FDS-04](04-dst-shard.md) / 模块 4。  
- Compose 中 `steamcmd` 服务为 `tools` profile，生产安装以**按需拉取镜像执行任务**为主，非常驻 sidecar。  
- 实例控制台日志/命令部分仍为过渡态，见 [FDS-09](09-console.md)。

## 1. 背景与目标

实现 v1 **全容器化**交付：用户通过一键脚本获得完整 Compose 栈，面板通过 Docker 管理 SteamCMD 与 DST 实例，消除「面板在容器、游戏在宿主机」的分裂。

**目标**：

- 10 分钟内完成安装（[ACCEPTANCE](../ACCEPTANCE.md) 场景 A）。  
- 开发/生产使用同一套镜像与编排原则。

## 2. 用户角色与前置条件

| 角色 | 说明 |
|------|------|
| 服务器管理员 | 有 Linux 主机 root/sudo，出站网络可用 |

**前置**：Ubuntu 22.04+ / Debian 12+，x86_64 或 aarch64，磁盘 ≥ 4GB。

## 3. 名词

见 [DOMAIN.md](../DOMAIN.md)。本文涉及：**面板容器**、**SteamCMD 任务**、**Shard 容器**、**数据卷**。

## 4. 用户故事

1. **作为**管理员，**我希望**执行一条安装命令后得到可访问的面板 URL 和初始账号，**以便**无需手动装 Node/Docker。  
2. **作为**管理员，**我希望**创建游戏实例时自动在卷上安装 DST 并启动容器，**以便**不 SSH 手敲 SteamCMD。

## 5. 页面与信息架构

- 安装阶段：CLI 输出为主；可选未来「安装向导」页（v1 不做）。  
- 安装后：跳转登录页（现有）。  
- 系统设置中展示：面板版本、Compose 栈版本、Docker 状态（已有 Docker 卡片可扩展）。

## 6. 功能点清单

| 功能 | 版本 | 状态 | 说明 |
|------|------|------|------|
| Linux 一键脚本 | Community | [x] | `scripts/install.linux.sh`：仅 Docker + Compose |
| Compose 栈 | Community | [x] | `panel` + 卷 + socket；`steamcmd` 为 tools profile |
| 面板镜像构建 | Community | [x] | 根目录 `Dockerfile`，`.github/workflows/docker-publish.yml` |
| DST 游戏镜像 | Community | [x] | `docker/game-dst` 基底 |
| ContainerRuntime | Community | [~] | 代码已落地；Compose 下实例链路待回归 |
| 安装失败回滚 | Community | [~] | 脚本 `rollback_install` + `install.status`；无 UI |
| 开发 Compose | Community | [x] | `pnpm run dev:compose` + `docker-compose.dev.yml` |
| 加固镜像通道 | Pro | [ ] | 可选官方签名镜像 tag |

## 7. 数据与 API

### 7.1 卷布局（目标）

```text
/var/lib/game-server-hub/
├── data/              # SQLite 等（可合并到 panel 挂载）
├── instances/
│   └── {instanceId}/  # installPath
└── backups/           # 见 FDS-06
```

### 7.2 环境变量（panel.env）

| 变量 | 说明 |
|------|------|
| `PANEL_PORT` | 对外端口 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 初始账号 |
| `FORCE_PASSWORD_CHANGE` | 默认 1 |
| `GSH_EDITION` | community / pro（规划） |
| `DOCKER_HOST` | 默认挂载 socket |

### 7.3 API

安装本身无 REST；实例创建/启动走 [API](../API.md) §5，内部调 ContainerRuntime。

## 8. 异常与边界

| 场景 | 行为 |
|------|------|
| Docker 未安装 | 脚本尝试安装；失败则退出并提示 |
| 磁盘不足 | 预检失败，exit 1 |
| 镜像拉取失败 | 重试 3 次；失败回滚栈 |
| Socket 权限不足 | 面板容器用户需在 docker 组或 rootless 配置 |
| 安装中断 | 实例状态 `error`，可重试安装或删除 |

## 9. 验收标准

- [x] 干净 Ubuntu 上脚本一次成功，浏览器可登录（[ACCEPTANCE](../ACCEPTANCE.md) 场景 A，2026-05-18）。  
- [x] `docker compose ps` 显示 `panel` 为 running（SteamCMD 按需任务，非必须常驻）。  
- [ ] 创建 DST 实例后存在 Master 容器且可进服（场景 C；待模块 2 等在 Compose 栈回归）。  
- [ ] 停止/删除实例后容器被移除，无孤儿（建议场景 G 补测）。  
- [x] 开发文档说明 Compose 本地调试（[CONTRIBUTING](../CONTRIBUTING.md)、[RUNBOOK](../RUNBOOK.md)）。

## 10. 不在本期范围

- Windows 安装包  
- K8s Helm Chart  
- 无 Docker 的裸机 Node 安装（过渡态可在 RUNBOOK 注明开发专用）

## 11. 依赖

- 阻塞 M1 所有「需 M0 回归」项。  
- [FDS-02](02-node-instance.md) 生命周期实现依赖本 FDS。

---

*实现文件：`scripts/install.linux.sh`、`docker-compose.yml`、`Dockerfile`、`server/src/infra/container/*`*
