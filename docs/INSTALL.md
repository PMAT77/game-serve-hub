# 安装与运维指南

本文面向 Linux 生产部署。Docker 模式适合小型社区和托管商，Native systemd 模式适合个人服主。本地开发见 [DEVELOPMENT.md](DEVELOPMENT.md)。

> **Windows 不受支持，也不是部署目标。** 它只用于本机开发调试，不提供安装脚本，也不为"让他人联机"做兼容。开发时的进服方式见 [DEVELOPMENT.md 平台定位](DEVELOPMENT.md#平台定位)；容器网络边界的说明见 [DST 开服教程 5.2](DST_TUTORIAL.md#52-windows-开发环境只保证本机进服)。

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

> **中国大陆服务器请先读 [3.3 离线镜像包完整步骤](#离线镜像包完整步骤国内推荐先读这一节)，再回来执行下面的命令。** 安装器要从 GHCR 拉取统一镜像，而 GHCR 的镜像层域名在国内基本不可达，直接执行几乎必然失败（`net/http: TLS handshake timeout`）。先用 `docker load` 导入离线包，安装器会自动跳过拉取。Native 模式不涉及容器镜像，无需此步。

```bash
curl -fsSL https://raw.githubusercontent.com/PMAT77/game-serve-hub/v0.3.5/scripts/install.linux.sh \
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
curl -fsSL https://raw.githubusercontent.com/PMAT77/game-serve-hub/v0.3.5/scripts/install.linux.sh \
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
curl -fsSL https://cdn.jsdelivr.net/gh/PMAT77/game-serve-hub@v0.3.5/scripts/install.linux.sh \
  | sudo bash -s -- --mode native --network cn
```

`--network auto` 实测 GitHub Raw、Docker 仓库、GHCR 与国内镜像连通性；`cn` 会：

- 备份 Ubuntu/Debian 软件源并临时使用清华镜像；
- 软件源失败时恢复原配置；
- 将 SteamCMD 区域设为 `cn`；
- 将 SteamCMD 安装重试次数提高到 8。

安装资源默认从 jsDelivr、GitHub 资源代理、GitHub Raw 依次回退。Compose 使用安装器内置 SHA256，不会为了校验再次访问 Raw。

v0.2.0 起官方容器镜像仅发布 GHCR（`ghcr.io/pmat77/game-server-hub`），一次拉取即包含面板、DST 运行库与 SteamCMD。**中国大陆服务器请把下面第 1 条当作默认路径，而不是等报错后再回来查** —— GHCR 的镜像层域名在国内基本不可达，直连拉取的成功率可以忽略。按优先级：

1. **离线镜像包**：从 GitHub Release 下载 `game-server-hub-<tag>-docker-image.tar.gz`（可用 GitHub 加速代理），`docker load` 导入后运行安装器（镜像已存在，跳过在线拉取）；
2. **自选镜像代理**：在 `panel.env` 配置 `GSH_IMAGE_MIRRORS`（逗号分隔的 registry 主机名，面板按序回退拉取）；
3. **PANEL_IMAGE 覆盖**：安装时设置 `PANEL_IMAGE=<你控制的镜像仓库引用>`。

#### 离线镜像包完整步骤（国内推荐先读这一节）

> **怎么用本节**：下面 1–4 步解释每一步的**原理与排错**；在全新机器上操作时，直接照抄文末的[端到端命令清单](#端到端命令清单国内--debian-12从零到面板运行)即可 —— 它从安装 Docker 引擎开始，额外覆盖 Debian 12 缺失 Compose v2 插件的修复与初始密码获取，两套内容一致、清单是唯一需要照抄的路径。

安装器需要从 GHCR 拉取统一镜像，而 GHCR 的**镜像层域名** `pkg-containers.githubusercontent.com` 在国内基本不可达。典型症状是「能看见镜像列表、但下载层时超时」，重试多少次都一样：

```text
failed to copy: ... Get "https://pkg-containers.githubusercontent.com/ghcrblobs/...":
net/http: TLS handshake timeout
```

所以国内 Docker 部署的正确顺序是：**先用每个 Release 附带的离线镜像包把镜像导进本机，再运行安装器**。

**1. 下载镜像包与校验文件**（用安装器同款的 GitHub 加速代理）

```bash
tag=v0.3.5
base="https://gh-proxy.com/https://github.com/PMAT77/game-serve-hub/releases/download/${tag}"
curl -fL --retry 3 -o gsh-image.tar.gz          "${base}/game-server-hub-${tag}-docker-image.tar.gz"
curl -fL --retry 3 -o gsh-image.tar.gz.sha256   "${base}/game-server-hub-${tag}-docker-image.tar.gz.sha256"
```

> `gh-proxy.com` 不可用时换成 `https://ghfast.top/` 前缀（两者都在安装器的代理清单里）。

**2. 校验**

`.sha256` 内记录的是**原始文件名**。本地另存成别的名字会报 `No such file or directory`，改名或手工比对即可：

```bash
mv gsh-image.tar.gz "game-server-hub-${tag}-docker-image.tar.gz"
sha256sum -c gsh-image.tar.gz.sha256      # 期望输出：...: OK
```

**3. 导入镜像**

```bash
docker load -i "game-server-hub-${tag}-docker-image.tar.gz"
docker images | grep game-server-hub
```

> 用 `docker load -i` 而不要用 `gunzip -c ... | docker load`：管道方式没有进度输出，大文件会看起来像卡住（实际在解压）。离线包约 420 MB，导入后镜像约 3.2 GB，请预留 4 GB 以上磁盘。

**4. 运行安装器**

```bash
curl -fsSL "https://raw.githubusercontent.com/PMAT77/game-serve-hub/${tag}/scripts/install.linux.sh" \
  | sudo bash -s -- --mode docker
```

镜像已在本地，安装器会**跳过拉取**（日志打印 `Runtime image already present locally, skipping pull`）。确实需要强制重新拉取时，加 `GSH_FORCE_IMAGE_PULL=1`。

#### 端到端命令清单（国内 + Debian 12，从零到面板运行）

把上述步骤与 Compose 插件修复串成一份可照抄的速查清单，适用于「全新 Debian 12 机器 + 国内网络 + 离线镜像包」。其他发行版把 apt 相关步骤替换为对应包管理即可。

**阶段一：Docker 引擎与 Compose 插件**

```bash
# 下载安装器（gh-proxy 加速 raw.githubusercontent.com，国内直连不通）
tag=v0.3.5   # 与目标 Release 一致，后续发布流程会同步替换
wget "https://gh-proxy.com/https://raw.githubusercontent.com/PMAT77/game-serve-hub/${tag}/scripts/install.linux.sh"

# 第一次运行安装器：自动 apt 安装 Docker Engine + containerd（Debian 官方源）。
# Debian 12 的 docker.io 不含 Compose v2 插件，预期结尾报
# 「Docker Compose v2 plugin is required but unavailable」——正常，按下一步手动补装
sudo bash install.linux.sh --mode docker

# 手动安装 Compose v2 CLI 插件（gh-proxy 加速 GitHub Release）
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -fL --retry 3 \
  "https://gh-proxy.com/https://github.com/docker/compose/releases/download/v2.39.2/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# 验证插件被 docker 识别（期望输出：Docker Compose version v2.39.2）
docker compose version
```

> 不要 `apt install docker-compose`：那是 v1 独立命令，安装器全程使用 v2 的 `docker compose` 子命令，二者不通用。

**阶段二：导入离线镜像包**

```bash
tag=v0.3.5
base="https://gh-proxy.com/https://github.com/PMAT77/game-serve-hub/releases/download/${tag}"

# 下载镜像包与校验文件（420 MB，gh-proxy 加速）
curl -fL --retry 3 -o "game-server-hub-${tag}-docker-image.tar.gz"        "${base}/game-server-hub-${tag}-docker-image.tar.gz"
curl -fL --retry 3 -o "game-server-hub-${tag}-docker-image.tar.gz.sha256" "${base}/game-server-hub-${tag}-docker-image.tar.gz.sha256"

# 校验完整性（期望输出末尾 OK，防止大文件下载中断损坏）
sha256sum -c "game-server-hub-${tag}-docker-image.tar.gz.sha256"

# 导入镜像（420 MB 解压为约 3.2 GB，预留 4 GB 以上磁盘；-i 带进度条）
docker load -i "game-server-hub-${tag}-docker-image.tar.gz"

# 确认镜像存在（应看到 ghcr.io/pmat77/game-server-hub，tag 与版本一致）
docker images | grep game-server-hub
```

**阶段三：重跑安装器完成部署**

```bash
# 镜像已在本地，安装器跳过 GHCR 拉取（日志出现
# "Runtime image already present locally, skipping pull" 即正确）。
# 内存预设默认 auto 按总内存自动选档；4 GiB 机器可显式指定 small（见 docs/MEMORY.md）
sudo GSH_PANEL_ENV_PRESET=small bash install.linux.sh --mode docker

# 验证面板容器 Up、日志无循环重启
docker ps
docker logs --tail 50 game-server-hub-panel
```

**阶段四：访问面板**

```bash
# 查看面板端口（安装器写入 panel.env，默认见安装器输出）
grep PANEL_PORT /opt/game-server-hub/panel.env

# 本机防火墙放行（云服务器同时在控制台安全组放行同端口）
sudo ufw allow 9527/tcp   # 未启用 ufw 可跳过
```

安装器结尾输出的 `Panel URL` 是服务器**内网地址**，从本地访问请改用公网 IP 并在安全组放行面板端口。管理员名默认 `superadmin`，**初始密码默认不打印**，从 panel.env 读取（详见[登录与安全](#5-登录与安全)）：

```bash
sudo awk -F= '/^ADMIN_PASSWORD=/{print substr($0, index($0, "=") + 1)}' \
  /opt/game-server-hub/panel.env
```

浏览器访问 `http://<服务器公网IP>:<PANEL_PORT>`，用 `superadmin` 与初始密码登录，首次登录会强制改密，**监控台会显示内存档位**。若后续「检查更新」超时（国内直连 api.github.com 不通），在 panel.env 追加 `GSH_GITHUB_API_BASE` 指向兼容反代后 `docker compose up -d panel` 重建即可。

**相关 FAQ**：[`Docker Compose v2 plugin is required but unavailable`](#docker-compose-v2-plugin-is-required-but-unavailable)、[`Cannot reach GHCR` / `Image pull failed`](#cannot-reach-ghcr--image-pull-failed)、[`download.docker.com` 不可达](#downloaddockercom-不可达)、[`checksum mismatch`](#checksum-mismatch)、[SteamCMD 下载慢或失败](#steamcmd-下载慢或失败)。

### 3.4 本地安装

```bash
git clone --branch v0.3.5 --depth 1 https://github.com/PMAT77/game-serve-hub.git
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
curl -fsSL https://raw.githubusercontent.com/PMAT77/game-serve-hub/v0.3.5/scripts/install.linux.sh \
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

Docker 模式若无法访问 GHCR，首选[离线镜像包](#离线镜像包完整步骤国内推荐先读这一节)；若你已自建仓库（可先 `docker load` 离线包、再 `docker tag`/`push` 到内网仓库），用法如下：

```bash
sudo docker login registry.example.com
curl -fsSL https://raw.githubusercontent.com/PMAT77/game-serve-hub/v0.3.5/scripts/install.linux.sh \
  | sudo env \
      PANEL_IMAGE=registry.example.com/gsh/game-server-hub:v0.3.5 \
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

### 面板内一键更新

面板「系统设置 → 面板与游戏版本」里的「应用更新」需要同时满足三个条件：

- 使用 Docker 部署。Native（systemd）安装没有容器镜像可换，需在服务器终端重跑安装脚本；
- `panel.env` 中的 `GSH_STACK_DIR` 是安装目录的**绝对路径**（安装脚本默认写为 `/opt/game-server-hub`）；
- compose 叠加了 `docker-compose.bind.yml`，使面板容器能通过 `/stack` 读到 `panel.env` 与 compose 文件。

面板内更新会把 Release 对应版本的镜像准备到本地（**本地已有该镜像时完全跳过下载**），再把目标镜像写进 `panel.env` 并重建面板容器。整个过程在区块内显示阶段：检查本地镜像 → 下载镜像 → 重建面板；面板重启期间页面会提示正在重启，恢复后自动继续。

国内服务器的主要瓶颈就是从 GHCR 下载镜像。推荐顺序：

1. 先下载离线镜像包（Release 附件）并导入：

   ```bash
   wget https://github.com/PMAT77/game-serve-hub/releases/download/<tag>/game-server-hub-<tag>-docker-image.tar.gz
   wget https://github.com/PMAT77/game-serve-hub/releases/download/<tag>/game-server-hub-<tag>-docker-image.tar.gz.sha256
   sha256sum -c game-server-hub-<tag>-docker-image.tar.gz.sha256
   gunzip -c game-server-hub-<tag>-docker-image.tar.gz | docker load
   ```

2. 回到面板点「应用更新」：检测到本地已有目标镜像后直接重建，秒级完成，不再产生任何下载。

任一条件不满足时按钮置灰，面板只说明「当前部署方式不支持面板内自动更新」并给出一条可复制的手动更新命令：

```bash
sudo gsh update
```

注意：**只按面板给出（或历史文档里）那条 `docker compose pull && up -d` 升级，不会更新宿主机上的 compose 文件**。如果一键更新一直不可用，说明 compose 文件或 `/stack` 挂载停留在旧版本，在服务器终端重跑一次安装脚本即可补齐并恢复（脚本默认 `auto`，有 Docker 的机器会自动判定为 Docker 模式）：

```bash
curl -fsSL https://raw.githubusercontent.com/PMAT77/game-serve-hub/<版本 tag>/scripts/install.linux.sh | sudo env GSH_RELEASE_TAG=<版本 tag> bash -s
```

### 安装脚本原地升级

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

仅影响 Docker。**国内服务器请直接用[离线镜像包](#离线镜像包完整步骤国内推荐先读这一节)**，这是成功率最高的路径，不必先花时间区分是 DNS、代理还是鉴权问题。

若仍要定位：`curl -I https://ghcr.io/v2/` 探测连通性，`sudo docker pull <完整镜像>` 复现拉取。注意「清单能取到、层下载超时」（`pkg-containers.githubusercontent.com` / `TLS handshake timeout`）属于网络不可达而非鉴权失败，换代理或重试都不会成功。备选路径是配置可信镜像副本，或按使用场景改为显式 `--mode native`。

### `download.docker.com` 不可达

安装器会尝试发行版自带的 Docker/Compose 包。若仍失败，使用 `--network cn`，检查 apt 源签名、系统时间和 HTTPS 出站。安装器不会悄悄切换运行模式。

### `Docker Compose v2 plugin is required but unavailable`

Debian 12 官方源的 `docker.io` **不包含** Compose v2 插件（`docker-compose-v2` 与 `docker-compose-plugin` 包都不存在），Docker 官方 apt 源不可达时安装器会在 dependencies 阶段报此错。手动安装插件后重跑安装器：

```bash
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fL --retry 3 \
  "https://gh-proxy.com/https://github.com/docker/compose/releases/download/v2.39.2/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
docker compose version   # 期望输出：Docker Compose version v2.39.2
```

> gh-proxy.com 不可用时换 `https://ghfast.top/` 前缀。不要 `apt install docker-compose` —— 那是 v1 独立命令，安装器全程使用 v2 的 `docker compose` 子命令，二者不通用。

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
