# 开发指南

面向参与 Game Server Hub 代码贡献的开发者。生产安装见 [INSTALL.md](INSTALL.md)。

> 模块级 FDS、TODO、验收标准等内部文档位于本地 **`docs_local/`**（已 `.gitignore`，不入库）。克隆后若无该目录，请向维护者索取或自行按团队规范维护副本。

---

## 环境要求

| 项 | 要求 |
|----|------|
| Node.js | `^22.13` / `>=24`（后端使用内置 `node:sqlite`，Node 20 无法启动） |
| 包管理 | pnpm `10.33+`（见 `packageManager` 字段） |
| Docker | 实例安装/启停依赖 Docker Engine（开发 Compose 模式亦需要） |
| 数据库 | SQLite（`pnpm run dev:prepare` 自动初始化） |

---

## 平台定位

**Windows 仅用于本机开发调试，不是部署目标。** 本项目不提供 Windows 安装脚本，也不为"让他人联机"做兼容——生产环境是 Linux 服务器，见 [INSTALL.md](INSTALL.md)。

开发时只需保证一件事：**游戏客户端（与面板同一台电脑）能用「本机」档进服**：

```lua
c_connect("127.0.0.1", 10999, "<房间密码>")
```

- Rancher Desktop / Docker Desktop 的宿主侧端口转发（含 UDP）已覆盖这一点，无需额外配置。
- 面板控制台默认会选到「本机」档；若显示的是「公网」档且地址不是 `127.0.0.1`，点命令框右侧按钮切换即可。
- 不需要为了局域网或异地联机去打通 Windows 侧网络——那属于生产场景，且容器运行时会额外引入一层网络边界，让端口暴露成倍复杂（详见 [DST 开服教程 5.2](DST_TUTORIAL.md#52-windows-开发环境只保证本机进服)）。

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

按需修改 `VITE_APP_API_BASEURL`（默认 `http://127.0.0.1:8888`）与后端 `SERVER_PORT`（默认 `8888`）。前端开发端口默认 `9527`，可用 `VITE_DEV_WEB_PORT` 覆盖。

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
| 前端 | `http://127.0.0.1:9527` | Vite 开发服务器 |
| 后端 | `http://127.0.0.1:8888` | Fastify API |
| 健康检查 | `GET http://127.0.0.1:8888/health` | 含 Docker 状态 |

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

Compose 开发栈下面板端口见 `panel.env` 中 `PANEL_PORT`（示例默认 `8888`）。

端口说明（避免与安装文档混淆）：

- **源码开发（`pnpm run dev`）**：前端 `9527`（`VITE_DEV_WEB_PORT` 可覆盖），后端 `8888`（`SERVER_PORT` 默认值）。
- **Compose 开发栈（`pnpm run dev:compose`）**：容器内服务监听 `8888`，宿主机映射由 `PANEL_PORT` 控制（示例默认 `8888`）。
- **安装脚本（生产安装）**：默认对外端口为 `9527`（见 `INSTALL.md` 与 `scripts/install.linux.sh`）。

---

## 已知问题（Windows 开发环境）

### `pnpm run dev` 下后端日志中文乱码

pino 输出是 UTF-8，PowerShell 默认按系统区域（GBK）解码显示。任选其一修复：

- **仅当前终端**（每次开 shell 先执行）：

  ```powershell
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
  chcp 65001 > $null
  ```

- **所有新终端**：把上面两行写进 PowerShell 配置文件（`notepad $PROFILE`；文件不存在先 `New-Item -Force $PROFILE`）。
- **系统级一劳永逸**：设置 → 时间和语言 → 语言和区域 → 管理语言设置 → 更改系统区域设置 → 勾选 **“Beta: 使用 Unicode UTF-8 提供全球语言支持”** 后重启。副作用：极少数依赖 GBK 的旧程序可能反向乱码。

### `dev:compose` 下前端容器冷启动慢

Rancher Desktop（WSL2 后端）把 Windows 源码目录 bind mount 进容器，文件 IO 走跨 VM 通道（实测同目录遍历慢约 35 倍）。vite 冷启动 ready 需要 70~80 秒，期间浏览器打开 `localhost:9527` 无响应**属正常现象**，等日志出现 `VITE ready in ...` 再访问。日常改前端代码建议直接用 `pnpm run dev`（原生 NTFS，约 13 秒 ready，HMR 也更可靠）。

---

## 本地构建统一镜像

```bash
docker compose build
```

构建是多阶段的，会依次访问 Docker Hub（基础镜像）、Debian apt 源、npm registry 与 Steam CDN。国内网络下最后一项常常失败：

```text
curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to steamcdn-a.akamaihd.net:443
```

换用 Steam 的另一条官方 CDN 即可绕过（`docker-compose.yml` 已透传该参数，默认值不变）：

```bash
STEAMCMD_ARCHIVE_URL=https://media.steampowered.com/client/installer/steamcmd_linux.tar.gz \
  docker compose build
```

> 仅仅开发功能并不需要构建镜像：`pnpm run dev`（宿主机 Node）与 `pnpm run dev:compose`（容器开发栈）都跳过了这一步。发布用的镜像由 CI 构建，见 [RELEASE.md](RELEASE.md)。

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
# 统一镜像（面板 + DST 运行库 + SteamCMD）
docker build -t ghcr.io/pmat77/game-server-hub:local docker/unified
```

### 本地 Compose 启动（非安装脚本路径）

```bash
cp panel.env.example panel.env
# 编辑 panel.env，将 PANEL_IMAGE 改为本地 tag
docker compose --env-file panel.env -f docker-compose.yml -f docker-compose.bind.yml up -d
```

官方镜像由 GitHub Actions 在推送 `main` 或 `v*` tag 时发布至 GHCR：

- `ghcr.io/pmat77/game-server-hub:<tag>`（统一镜像，v0.2.0 起三合一）

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
