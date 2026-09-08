# 安装与运维指南

本文面向 Linux 生产部署。Docker 模式适合小型社区和托管商，Native systemd 模式适合个人服主。本地开发见 [DEVELOPMENT.md](DEVELOPMENT.md)。

## 1. 选择部署模式

| 对比项 | Docker | Native systemd |
| --- | --- | --- |
| 目标用户 | 社区、托管商 | 个人服主 |
| 隔离 | 容器 | 专用 Linux 用户与 systemd unit |
| 面板 | Docker Compose | `game-server-hub.service` |
| SteamCMD | 容器 | `/opt/game-server-hub/runtime/steamcmd` |
| 游戏进程 | Docker 容器 | systemd 用户服务 |
| 日志 | Docker logs | journald |
| 主机重启恢复 | Docker restart policy | systemd + linger |
| 支持架构 | x86_64；ARM64 实验性 | x86_64 |

Native 不安装、不调用 Docker，不支持 tmux、screen 或 PM2。两种模式之间暂不自动迁移。

## 2. 环境要求

| 项目 | 要求 |
| --- | --- |
| 系统 | Ubuntu 22.04 / 24.04，Debian 12 |
| 初始化系统 | systemd（Native 强制要求） |
| 内存 | 最低约 4 GiB；洞穴与中等 Mod 推荐 6 GiB；8 GiB+ 更稳妥 |
| 磁盘 | 根分区至少 4 GiB 空闲；游戏文件与存档另计 |
| 权限 | root 或 sudo |
| 网络 | HTTPS 出站；Docker 模式还需可访问所配置的镜像仓库 |

安装器会检查发行版、架构、磁盘、端口与运行时连通性。只支持 apt 系列，不支持 CentOS/RHEL/Alpine。

## 3. 一键安装

安装器支持：

```text
--mode auto|docker|native
--network auto|cn|global
--open-panel-port
--open-dst-ports
```

交互终端的 `--mode auto` 会在未安装 Docker 时询问；非交互管道默认选择 Docker。任何 Docker 失败都不会静默改为 Native，因此生产部署建议明确写模式。

### 3.1 Docker

```bash
curl -fsSL https://raw.githubusercontent.com/PMAT77/game-serve-hub/v0.2.2/scripts/install.linux.sh \
  | sudo bash -s -- --mode docker
```

安装器会：

1. 检测网络档位并准备 apt；
2. 尝试 Docker 官方仓库，失败后回退发行版签名软件包；
3. 获取并校验 Compose 文件；
4. 生成 `panel.env`，拉取统一镜像（面板 + DST 运行库 + SteamCMD 三合一）；
5. 启动 Compose 并等待 `/health`。

### 3.2 Native systemd

```bash
curl -fsSL https://raw.githubusercontent.com/PMAT77/game-serve-hub/v0.2.2/scripts/install.linux.sh \
  | sudo bash -s -- --mode native
```

安装器会：

1. 安装 SteamCMD 所需的 i386 运行库；
2. 创建无登录 shell 的 `gsh` 系统用户并启用 linger；
3. 下载 Native Release 与 `.sha256`，校验摘要及归档路径；
4. 安装到 `/opt/game-server-hub/releases/v0.2.0` 并原子切换 `current`；
5. 安装 SteamCMD；
6. 写入并启动 `game-server-hub.service`；
7. 等待 `/health`，失败时切回先前 Release。

Native Release 内置 Node.js Linux x64 运行时，宿主机无需另装 Node.js 或 pnpm。

### 3.3 国内网络档位

```bash
curl -fsSL https://cdn.jsdelivr.net/gh/PMAT77/game-serve-hub@v0.2.2/scripts/install.linux.sh \
  | sudo bash -s -- --mode native --network cn
```

`--network auto` 实测 GitHub Raw、Docker 仓库、GHCR 与国内镜像连通性；`cn` 会：

- 备份 Ubuntu/Debian 软件源并临时使用清华镜像；
- 软件源失败时恢复原配置；
- 将 SteamCMD 区域设为 `cn`；
- 将 SteamCMD 安装重试次数提高到 8。

安装资源默认从 jsDelivr、GitHub 资源代理、GitHub Raw 依次回退。Compose 使用安装器内置 SHA256，不会为了校验再次访问 Raw。

v0.2.0 起官方容器镜像仅发布 GHCR（`ghcr.io/pmat77/game-server-hub`），一次拉取即包含面板、DST 运行库与 SteamCMD。GHCR 不可达时的国内安装路径（按优先级）：

1. **离线镜像包**：从 GitHub Release 下载 `game-server-hub-<tag>-docker-image.tar.gz`（可用 GitHub 加速代理），`docker load` 导入后运行安装器（镜像已存在，跳过在线拉取）；
2. **自选镜像代理**：在 `panel.env` 配置 `GSH_IMAGE_MIRRORS`（逗号分隔的 registry 主机名，面板按序回退拉取）；
3. **PANEL_IMAGE 覆盖**：安装时设置 `PANEL_IMAGE=<你控制的镜像仓库引用>`。

### 3.4 本地安装

```bash
git clone --branch v0.2.2 --depth 1 https://github.com/PMAT77/game-serve-hub.git
cd game-server-hub
sudo bash ./scripts/install.linux.sh --mode native --network auto
```

离线或内网安装 Native Release 时可指定本地包。旁边必须有同名 `.sha256`，或显式提供摘要：

```bash
sudo \
  GSH_RELEASE_TAG=v0.2.0 \
  GSH_NATIVE_RELEASE_ARCHIVE=/srv/packages/game-server-hub-native-v0.2.0-linux-x64.tar.gz \
  bash ./scripts/install.linux.sh --mode native
```

## 4. 安装后的文件与服务

### Docker

```text
/opt/game-server-hub/
  panel.env
  docker-compose.yml
  docker-compose.bind.yml
/var/lib/game-server-hub/
  game-server-hub.sqlite
  instances/
  backups/
/var/log/game-server-hub/
  install.status
  install.diagnostics.log
```

### Native

```text
/opt/game-server-hub/
  panel.env
  current -> releases/<version>
  releases/<version>/
  runtime/steamcmd/
/var/lib/game-server-hub/
  game-server-hub.sqlite
  instances/
  backups/
  runtime/
/var/lib/game-server-hub/home/.config/systemd/user/
  gsh-instance-<id>-master.service
  gsh-instance-<id>-caves.service
```

面板是系统服务；游戏实例是 `gsh` 的用户服务。这样面板可以保持受限的 `/opt` 只读权限，同时管理自己的游戏 unit。

## 5. 登录与安全

安装器默认使用管理员名 `superadmin`，并生成随机密码写入权限受限的 `panel.env`。摘要默认不显示密码：

```bash
sudo awk -F= '/^ADMIN_PASSWORD=/{print substr($0, index($0, "=") + 1)}' \
  /opt/game-server-hub/panel.env
```

也可以在首次安装时显式设置：

```bash
curl -fsSL https://raw.githubusercontent.com/PMAT77/game-serve-hub/v0.2.2/scripts/install.linux.sh \
  | sudo env ADMIN_USERNAME=admin ADMIN_PASSWORD='替换为强密码' \
      bash -s -- --mode native
```

首次登录会强制改密。不要把 `panel.env`、诊断之外的面板日志或授权文件发到公开 Issue。

## 6. 端口与防火墙

| 用途 | 协议 | 默认端口 |
| --- | --- | --- |
| 面板 | TCP | `9527` |
| DST 游戏 | UDP | `10999` |
| Steam 认证 | UDP | `8766` |
| DST 主服务器 | UDP | `12346` |

安装器默认不修改防火墙。需要时添加：

```bash
sudo bash ./scripts/install.linux.sh \
  --mode native \
  --open-panel-port \
  --open-dst-ports
```

云服务器安全组仍需单独放行。

## 7. 验证和常用命令

### 通用健康检查

```bash
curl -fsS http://127.0.0.1:9527/health
```

返回中的 `runtime.mode` 应为 `docker` 或 `native`，`runtime.status` 应为 `running`。

### Docker

```bash
cd /opt/game-server-hub
sudo docker compose --env-file panel.env \
  -f docker-compose.yml -f docker-compose.bind.yml ps
sudo docker logs -f game-server-hub-panel
sudo docker compose --env-file panel.env \
  -f docker-compose.yml -f docker-compose.bind.yml restart panel
```

### Native

```bash
sudo systemctl status game-server-hub.service --no-pager
sudo journalctl -u game-server-hub.service -f

GSH_UID="$(id -u gsh)"
sudo -u gsh \
  XDG_RUNTIME_DIR="/run/user/${GSH_UID}" \
  DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${GSH_UID}/bus" \
  systemctl --user list-units 'gsh-instance-*'
```

游戏日志进入对应 user unit 的 journald。面板控制台也会通过同一日志源持续推送。

## 8. 配置可信镜像或代理

Docker 模式若无法访问 GHCR，请优先使用自己控制的仓库：

```bash
sudo docker login registry.example.com
curl -fsSL https://raw.githubusercontent.com/PMAT77/game-serve-hub/v0.2.2/scripts/install.linux.sh \
  | sudo env \
      PANEL_IMAGE=registry.example.com/gsh/game-server-hub:v0.2.2 \
      bash -s -- --mode docker --network cn
```

统一镜像引用应与 Release tag 一致，并按 Release 的 `release-images.json` 核对 digest。不要使用无法说明来源的公共镜像。

SteamCMD 支持在 `panel.env` 中设置：

```bash
GSH_STEAMCMD_DOWNLOAD_REGION=cn
GSH_STEAMCMD_INSTALL_MAX_ATTEMPTS=8
GSH_STEAMCMD_HTTP_PROXY=http://proxy.example.com:7890
GSH_STEAMCMD_HTTPS_PROXY=http://proxy.example.com:7890
```

修改后重启面板。

## 9. 原地升级与回滚

同模式重跑新版安装脚本即原地升级：

```bash
curl -fsSL https://raw.githubusercontent.com/PMAT77/game-serve-hub/v0.1.5/scripts/install.linux.sh \
  | sudo env GSH_RELEASE_TAG=v0.1.5 bash -s -- --mode native
```

升级会：

- 保留 SQLite、`instances/`、`backups/`、管理员账号和自定义 `panel.env`；
- 先用 SQLite 在线备份保存一致性数据库快照，并备份 `panel.env` 与 Compose 文件；
- Docker 仅更新 Release/镜像键并重建面板栈，不删除数据卷；
- Native 解压到新目录后切换 `current`，健康检查失败则恢复旧链接、配置和数据库；
- 拒绝自动跨 Docker/Native 模式迁移。

Native 手动回滚：

```bash
sudo systemctl stop game-server-hub.service
sudo ln -sfn /opt/game-server-hub/releases/v0.2.0 /opt/game-server-hub/current.rollback
sudo mv -Tf /opt/game-server-hub/current.rollback /opt/game-server-hub/current
sudo systemctl start game-server-hub.service
```

Docker 回滚时，把 `/opt/game-server-hub/panel.env` 中镜像键（PANEL_IMAGE 与两个 GSH_*_IMAGE）改回同一旧版本 tag，再执行 `docker compose pull && docker compose up -d`。不要执行带 `-v` 的 `docker compose down`。

### 面板内备份与恢复（v0.2.0 起）

日常备份不再需要 SSH。面板「备份与恢复」页提供：

- **存档备份**：对单个实例的 `klei-storage`（世界数据、房间配置、集群令牌）打 tar.gz。实例运行中会先发送 `c_save()` 保存世界再打包；恢复前会自动创建一份安全备份。恢复要求实例已停止，恢复后可启动实例验证世界状态。
- **自动备份钩子**：更新服务端前、删除实例前自动创建备份（系统级开关，默认开启）。
- **保留策略**：每实例默认保留最近 10 份存档备份，超出自动淘汰最旧。
- **数据库快照**：面板 SQLite 的 `VACUUM INTO` 一致性快照，默认保留 5 份；升级前的数据库备份仍由安装脚本完成。
- **下载**：备份包可从面板直接下载到本地异地留存。

备份文件落在 `/var/lib/game-server-hub/backups/`（Docker 卷 `gsh-backups`）。面板内备份不覆盖异地容灾：重要服建议配合定时下载或自行 rsync。

## 10. 诊断文件

安装器按阶段写入：

```bash
sudo cat /var/log/game-server-hub/install.status
sudo cat /var/log/game-server-hub/install.diagnostics.log
```

诊断报告权限为 `600`，包含系统资源、服务或 Compose 状态，不包含管理员密码、Registry 凭据和面板业务日志。反馈安装问题时请同时附上失败阶段和诊断文件的脱敏内容。

## FAQ：按错误关键词排查

### `Cannot reach GHCR` / `Image pull failed`

仅影响 Docker。运行 `curl -I https://ghcr.io/v2/` 与 `sudo docker pull <完整镜像>` 区分 DNS、HTTPS 代理和 Registry 鉴权问题。配置可信镜像副本，或根据使用场景改为显式 `--mode native`。

### `download.docker.com` 不可达

安装器会尝试发行版自带的 Docker/Compose 包。若仍失败，使用 `--network cn`，检查 apt 源签名、系统时间和 HTTPS 出站。安装器不会悄悄切换运行模式。

### `checksum mismatch`

下载内容与指定 Release 不一致。不要关闭校验；清理代理/CDN 缓存，确认脚本的 `GSH_RELEASE_TAG` 与资源 URL 是同一版本，或改用本地 Release 包和官方 `.sha256`。

### `Native Release ... missing`

对应 GitHub Release 尚未发布 `game-server-hub-native-<tag>-linux-x64.tar.gz` 及 `.sha256`。换用已发布版本，或通过 `GSH_NATIVE_RELEASE_ARCHIVE` 指定本地包。

### `systemd user manager` / `Failed to connect to bus`

```bash
sudo loginctl enable-linger gsh
GSH_UID="$(id -u gsh)"
sudo systemctl restart "user@${GSH_UID}.service"
sudo systemctl restart game-server-hub.service
sudo loginctl show-user gsh -p Linger
```

不要用 tmux、screen 或 PM2 绕过该错误；这会破坏日志、自恢复和资源限制语义。

### 面板服务不断重启

Docker：

```bash
sudo docker logs --tail 200 game-server-hub-panel
```

Native：

```bash
sudo systemctl status game-server-hub.service --no-pager
sudo journalctl -u game-server-hub.service -n 200 --no-pager
```

重点检查 `panel.env` 路径、端口占用、SQLite 权限和 systemd user bus。

### SteamCMD 下载慢或失败

启用 `--network cn`，设置下载区域和重试；必要时配置 `HTTP_PROXY`/`HTTPS_PROXY`。检查磁盘、i386 依赖（Native）和镜像仓库（Docker）。

### DST 启动后立即退出

查看对应实例日志，确认安装完整、Cluster Token、端口、Mod 配置和内存。洞穴分片会增加内存占用，低于 6 GiB 的机器建议先关闭洞穴和大量 Mod。

### 玩家看不到或连不上服务器

同时检查 UDP 端口、本机防火墙、云安全组、NAT 和 Cluster Token。面板 TCP 端口开放不代表 DST UDP 已开放。

### 重跑脚本提示 `cross-mode migration is not supported`

检测到现有模式与请求模式不同。当前版本不会自动转换运行中的游戏实例。先备份 `/var/lib/game-server-hub` 和 `panel.env`，再按后续迁移文档操作。

### 忘记初始密码

尚未改密时可从 root 可读的 `/opt/game-server-hub/panel.env` 查看。已经在面板内改密后，以数据库中的凭据为准；不要通过反复重跑安装器覆盖认证状态。
