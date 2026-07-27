# 开发指南

面向参与 Game Server Hub 代码贡献的开发者。生产安装见 [INSTALL.md](INSTALL.md)。

> 模块级 FDS、TODO、验收标准等内部文档位于本地 **`docs_local/`**（已 `.gitignore`，不入库）。克隆后若无该目录，请向维护者索取或自行按团队规范维护副本。

---

## 环境要求

| 项 | 要求 |
|----|------|
| Node.js | `^20.19` / `^22.13` / `>=24` |
| 包管理 | pnpm `10.33+`（见 `packageManager` 字段） |
| Docker | 实例安装/启停依赖 Docker Engine（开发 Compose 模式亦需要） |
| 数据库 | SQLite（`pnpm run dev:prepare` 自动初始化） |

---

## 克隆与依赖

```bash
git clone https://github.com/PMAT77/game-serve-hub.git
cd game-server-hub
corepack enable
pnpm install
```

---

## 环境变量

```bash
cp .env.development.example .env.development
cp server/.env.development.example server/.env.development
```

按需修改 `VITE_APP_API_BASEURL`（默认 `http://127.0.0.1:9527`）与后端 `SERVER_PORT`（默认 `9527`）。

Docker Compose 开发模式使用 `panel.env.example`：

```bash
cp panel.env.example panel.env
```

---

## 初始化数据库

```bash
pnpm run dev:prepare
```

创建 SQLite、运行 Drizzle 迁移、初始化日志目录。

---

## 启动（宿主机 Node，推荐日常改代码）

```bash
pnpm run dev
```

| 服务 | 地址 | 说明 |
|------|------|------|
| 前端 | `http://127.0.0.1:9000` | Vite 开发服务器 |
| 后端 | `http://127.0.0.1:9527` | Fastify API |
| 健康检查 | `GET http://127.0.0.1:9527/health` | 含 Docker 状态 |

默认管理员（`panel.env` / 开发预填）：账号 `superadmin`，密码 `123456`（亦可在 `panel.env` 或 `.env.development` 中覆盖）。

---

## 启动（Docker Compose 开发栈，贴近生产）

需已安装 Docker。`dev:compose` 与 `dev:server` **不要同时运行**（实例卷 bind 会冲突）。

```bash
pnpm run dev:compose:prepare   # 可选：预拉 SteamCMD 镜像
pnpm run dev:compose             # 启动 panel + web 容器
```

停止：

```bash
pnpm run dev:compose:down
```

Compose 开发栈下面板端口见 `panel.env` 中 `PANEL_PORT`（示例默认 `3000`）。

端口说明（避免与安装文档混淆）：

- **源码开发（`pnpm run dev`）**：前端 `9000`，后端 `9527`（`SERVER_PORT` 默认值）。
- **Compose 开发栈（`pnpm run dev:compose`）**：容器内服务监听 `3000`，宿主机映射由 `PANEL_PORT` 控制（示例默认 `3000`）。
- **安装脚本（生产安装）**：默认对外端口为 `9527`（见 `INSTALL.md` 与 `scripts/install.linux.sh`）。

---

## 测试与代码检查

```bash
pnpm test:server
pnpm run lint
```

### 面板后端环境变量（`server/.env.*`）

| 变量 | 用途 |
|------|------|
| `CORS_ORIGIN` | 跨域：`true`/`false` 或逗号分隔白名单；开发默认可跨域，生产默认同源 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 初始化管理员；生产未设密码时自动生成并写日志 |
| `FORCE_PASSWORD_CHANGE` | `1` 时首次登录进入强制改密页 |

### Steam / Mod 相关环境变量（开发排查）

| 变量 | 用途 |
|------|------|
| `GSH_STEAM_WEBAPI_KEY` | Mod 市场走 Steam 官方 Web API（推荐，比 HTML 抓取稳定） |
| `GSH_STEAM_RELAY_URL` / `GSH_STEAM_RELAY_TOKEN` | 无法直连 Steam 时的中继 |
| `GSH_STEAMCMD_DOWNLOAD_REGION` | SteamCMD 下载区域（如 `cn`），影响实例安装与 Mod 订阅下载 |
| `GSH_STEAM_WORKSHOP_FETCH_TIMEOUT_MS` | Mod 市场 live 拉取超时，默认 12s |
| `GSH_STEAM_WORKSHOP_WARM_CACHE=0` | 关闭面板启动时 Mod 市场列表后台预热 |

完整示例见 [`panel.env.example`](../panel.env.example)。

---

## 从源码构建生产镜像

适用于自托管构建或 CI 调试。

### 构建前端

```bash
cp .env.production.example .env.production
cp server/.env.production.example server/.env.production
pnpm install
pnpm run build          # 输出 dist/
```

### 构建 Docker 镜像

```bash
# 面板镜像（含 dist + 后端）
docker build -t ghcr.io/pmat77/game-server-hub:local .

# DST 运行环境镜像
docker build -t ghcr.io/pmat77/game-server-hub-dst:local docker/game-dst
```

### 本地 Compose 启动（非安装脚本路径）

```bash
cp panel.env.example panel.env
# 编辑 panel.env，将 PANEL_IMAGE 改为本地 tag
docker compose --env-file panel.env -f docker-compose.yml -f docker-compose.bind.yml up -d
```

官方镜像由 GitHub Actions 在推送 `main` 或 `v*` tag 时发布至 GHCR：

- `ghcr.io/pmat77/game-server-hub:<tag>`
- `ghcr.io/pmat77/game-server-hub-dst:<tag>`

---

## 仓库结构

```text
game-server-hub/
├── docs/                   # 公开文档（本目录）
├── src/                    # Vue 3 前端
├── server/                 # Fastify 后端、Drizzle、SQLite 迁移
├── shared/                 # 前后端共享契约与错误码
├── scripts/                # 安装脚本、开发工具
├── packages/               # 工作区 UI 组件
├── docker/                 # DST 运行镜像等
├── docker-compose.yml      # 生产编排
├── docker-compose.dev.yml  # 开发 overlay
├── panel.env.example       # Compose / 安装脚本环境变量模板
├── .env.*.example          # 前端 Vite 环境变量模板
└── server/.env.*.example   # 后端环境变量模板
```

Standalone 副本与上游 fantastic-admin 母仓的同步说明见根目录 [MIGRATION.md](../MIGRATION.md)。

---

## 参与贡献

详见 **[CONTRIBUTING.md](../CONTRIBUTING.md)**（PR 流程、CHANGELOG、行为准则）。

CI 与本地检查保持一致：

```bash
pnpm run lint
pnpm test:unit
```

发布与版本号约定见 **[RELEASE.md](RELEASE.md)**。

**请勿提交**：`panel.env`、本地 SQLite、`docs_local/`、`.env` 凭据或任何密钥文件。
