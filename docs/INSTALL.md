# 安装指南

- **海外，或网络可直达 GitHub 与 GHCR** → [路线 A](#路线-a海外机器一个命令装完)，一个命令装完。
- **国内服务器** → [路线 B](#路线-b国内服务器debian-12-离线镜像包全程)，离线镜像包全程，按 Debian 12 验证。

**环境要求**：Debian 12 或 Ubuntu 22.04 / 24.04（只支持 apt 系列）；内存最低约 4 GiB，洞穴与中等 Mod 建议 6 GiB+（档位与预设见 [MEMORY.md](MEMORY.md)，安装器默认自动选档）；根分区至少 4 GiB 空闲；root 或 sudo。

> Windows 不受支持；本地开发见 [DEVELOPMENT.md](DEVELOPMENT.md)。

---

## 路线 A：海外机器（一个命令装完）

```bash
curl -fsSL "https://raw.githubusercontent.com/PMAT77/game-serve-hub/v0.4.1/scripts/install.linux.sh" \
  | sudo bash -s -- --mode docker
```

> 管道方式锁定的是当次下载内容，不会误用磁盘上的旧脚本。若想先确认拿到的是目标版本：
> `curl -fsSL "<上面的 URL>" | sed -n '9p'`，第 9 行应输出 `...:-v0.4.1}}` —— 这一行的默认 tag 决定安装器要装的镜像版本。

```bash
# 初始密码：安装器默认不打印，从 panel.env 读取（管理员名 superadmin，首登强制改密）
sudo sed -n 's/^ADMIN_PASSWORD=//p' /opt/game-server-hub/panel.env
# 若登录提示密码错误（容器没收到该变量）：docker exec game-server-hub-panel cat /app/data/admin-credentials.txt

# 健康检查：runtime.status 应为 running；或 gsh doctor 全面体检
curl -fsS http://127.0.0.1:9527/health
gsh doctor
```

浏览器访问 `http://<服务器IP>:9527`（默认端口，安装器结尾输出实际地址；安全组放行 TCP）。碰到任何报错 → [问题清单](#问题清单按报错关键词对照)。

---

## 路线 B：国内服务器（Debian 12 离线镜像包全程）

> 安装器要从 GHCR 拉统一镜像，其镜像层域名国内基本不可达（症状：能见镜像清单、层下载 `TLS handshake timeout`，重试无用）。正确顺序：先导入离线镜像包，再跑安装器 —— 检测到本地镜像即跳过拉取。

### 阶段一：Docker 引擎与 Compose 插件

```bash
# 下载安装器（gh-proxy 加速；不可用时换 https://ghfast.top/ 前缀）
# 用 curl -o 指定带版本号的文件名：wget 遇到同名文件不会覆盖而是另存为 .1，容易继续跑上一次的旧脚本
tag=v0.4.1
curl -fL --retry 3 -o "install-${tag}.sh" \
  "https://gh-proxy.com/https://raw.githubusercontent.com/PMAT77/game-serve-hub/${tag}/scripts/install.linux.sh"

# 自证版本：必须输出 ...:-v0.4.1}}，对不上就停下排查（这行的默认 tag 决定安装器要装的镜像版本）
sed -n '9p' "install-${tag}.sh"

# 第一次运行：自动装好 Docker 与 Compose 插件。
# 结尾报「Cannot reach GHCR / Image pull failed」属正常（镜像包未导入）→ 进入阶段二；阶段三原样重跑本命令
sudo GSH_PANEL_ENV_PRESET=small GSH_RELEASE_TAG="${tag}" bash "install-${tag}.sh" --mode docker --network cn

# 验证插件（期望输出：Docker Compose version v2.39.2）
docker compose version

# 仅当安装器提示自动补装失败时，手动装好插件，再重新执行上面的安装命令：
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -fL --retry 3 "https://gh-proxy.com/https://github.com/docker/compose/releases/download/v2.39.2/docker-compose-linux-x86_64" -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
```

> 兜底用的是二进制而不是 `apt install docker-compose`：源里那个是 1.x 旧版（命令叫 `docker-compose`），没有安装器所需的 v2 `docker compose` 子命令，装了也过不了安装器检查。

### 阶段二：导入离线镜像包

```bash
tag=v0.4.1
base="https://gh-proxy.com/https://github.com/PMAT77/game-serve-hub/releases/download/${tag}"

# 下载镜像包与校验文件（v0.4.1 约 200 MB；v0.3.5 是 420 MB，体积对不上说明下错了版本）
curl -fL --retry 3 -o "game-server-hub-${tag}-docker-image.tar.gz"        "${base}/game-server-hub-${tag}-docker-image.tar.gz"
curl -fL --retry 3 -o "game-server-hub-${tag}-docker-image.tar.gz.sha256" "${base}/game-server-hub-${tag}-docker-image.tar.gz.sha256"

# 校验完整性（期望输出末尾 OK）。.sha256 记录原始文件名，改过名需先改回
sha256sum -c "game-server-hub-${tag}-docker-image.tar.gz.sha256"

# 核对包内镜像 tag 与目标版本一致（RepoTags 应为 ghcr.io/pmat77/game-server-hub:v0.4.1）
tar -xOzf "game-server-hub-${tag}-docker-image.tar.gz" manifest.json | head -c 200; echo

# 导入镜像（解压约 3.2 GB，预留 4 GB 磁盘；-i 带进度条，不要用 gunzip 管道；
# 输出 Loaded image: ghcr.io/pmat77/game-server-hub:v0.4.1 即成功）
docker load -i "game-server-hub-${tag}-docker-image.tar.gz"

# 断言本地 tag 与目标版本一致：安装器只认完整引用字符串，tag 对不上即使内容相同也会重新拉取
docker images --format '{{.Repository}}:{{.Tag}}' | grep "^ghcr.io/pmat77/game-server-hub:${tag}$"
```

### 阶段三：重跑安装器完成部署

原样重跑[阶段一](#阶段一docker-引擎与-compose-插件)那条安装命令 —— 这次镜像已在本地，日志出现 `Runtime image already present locally, skipping pull` 后一路走完，结尾输出面板地址。

> 没出现 `skipping pull` 却又开始下载，就是脚本默认 tag 与本地镜像 tag 不一致：`sed -n '9p' "install-${tag}.sh"` 与 `docker images | grep game-server-hub` 两边都必须等于 `${tag}`；也可以显式覆盖重跑 `sudo GSH_RELEASE_TAG="${tag}" bash "install-${tag}.sh" --mode docker --network cn`。

```bash
docker ps   # game-server-hub-panel 应为 Up；起不来或反复重启 → 问题清单
```

### 阶段四：访问面板

安装器结尾会打印一个边框摘要块，其中的`面板地址`是内网地址：公网访问改用公网 IP 并放行面板端口，初始密码的读取命令也写在同一块里。初始密码获取见[登录与安全](#登录与安全)。

浏览器 `http://<服务器公网IP>:<PANEL_PORT>` 登录，首登强制改密。若之后「检查更新」超时，panel.env 追加 `GSH_GITHUB_API_BASE` 指向兼容反代后 `docker compose up -d panel` 重建即可。

---

## 装好之后

### 端口与防火墙

| 用途 | 协议 | 默认端口 |
| --- | --- | --- |
| 面板 | TCP | `9527` |
| 主世界 · 游戏端口 | UDP | `10999` |
| 主世界 · Steam 认证端口 | UDP | `8766` |
| 主世界 · Steam 主服端口 | UDP | `12346` |
| 洞穴 · 游戏端口 | UDP | `11000` |
| 洞穴 · Steam 认证端口 | UDP | `8768` |
| 洞穴 · Steam 主服端口 | UDP | `12348` |

开启洞穴后，洞穴的 3 个 UDP 端口同样必须放行，否则玩家一进洞穴就会崩线。

安装器默认不改防火墙；需要时加 `--open-panel-port` / `--open-dst-ports`（后者放行主世界与洞穴共 6 个 UDP 端口），云服务器安全组单独放行。宿主服务器本身在 NAT 转发（云平台端口映射 / 路由器映射）后面时，还要在那边按**与内部相同的端口**逐条添加转发规则，见 [DST 开服教程](DST_TUTORIAL.md) 5.4 节。

### 常用命令

```bash
# 健康检查（runtime.status 应为 running）
curl -fsS http://127.0.0.1:9527/health

# 面板容器：状态 / 日志 / 重启
cd /opt/game-server-hub
sudo docker compose --env-file panel.env -f docker-compose.yml -f docker-compose.bind.yml ps
sudo docker logs -f game-server-hub-panel
sudo docker compose --env-file panel.env -f docker-compose.yml -f docker-compose.bind.yml restart panel
```

### 镜像运行层说明

统一镜像的运行层只包含面板产物（前端 dist + 服务端 bundle + 数据库迁移），**不带 node_modules，也没有 pnpm / npm / tsx**：服务端依赖已在构建期全部打进 bundle，因此不要 `docker exec` 进容器执行包管理或 Node 工具链命令（会提示命令不存在）。排障走 `docker logs`、面板 API 与宿主机 `gsh` CLI。

### 登录与安全

管理员名默认 `superadmin`，初始密码默认不打印，从 panel.env 读取：

```bash
sudo sed -n 's/^ADMIN_PASSWORD=//p' /opt/game-server-hub/panel.env
```

面板首次启动时按 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 创建管理员：Docker 模式由 `docker-compose.yml` 的 `environment` 注入容器，Native 模式由 systemd `EnvironmentFile` 注入进程 —— 两条路径读的都是同一个 `panel.env`，改值后重启面板即生效。

未设置 `ADMIN_PASSWORD`、或容器没收到该变量（旧版 compose、手动 `docker run` 漏了 `-e`）时，面板会随机生成密码并写入容器内数据目录：

```bash
docker exec game-server-hub-panel cat /app/data/admin-credentials.txt
```

该文件只在"生成的密码确实写入了数据库"时才会生成（或重写）：管理员已存在且未开启 `GSH_SYNC_ADMIN_PASSWORD_FROM_ENV` 时不会生成新密码，避免给出一个登录不上的值。

`FORCE_PASSWORD_CHANGE=1`（安装器默认写入）时首次登录会拦截至 `/force-change-password`，改密成功后凭据文件自动删除。

也可安装时显式指定：`sudo env ADMIN_USERNAME=admin ADMIN_PASSWORD='强密码' bash install.linux.sh --mode docker`。不要把 `panel.env` 或授权文件发到公开 Issue。

### 升级（面板内一键更新）

「系统设置 → 面板与游戏版本」→「应用更新」：检查本地镜像 → 下载镜像（本地已有则跳过）→ 写入 panel.env → 重建面板容器。

国内先 `docker load` 离线镜像包（命令同[阶段二](#阶段二导入离线镜像包)）再点「应用更新」，秒级完成。按钮置灰时用面板给出的 `sudo gsh update`。

重建动作由一个临时的 updater 容器完成，它需要镜像里有 `docker` CLI 与 compose 插件。v0.3.10 起统一镜像自带这两样，面板会优先用**本地已有的目标镜像 / 当前面板镜像**当 updater 运行时，因此离线环境也能完成更新，不再去 Docker Hub 拉 `docker:27-cli`。若你所在网络要求固定某个 updater 镜像（例如内网制品库里的同等镜像），在 `panel.env` 里设置 `GSH_PANEL_UPDATER_IMAGE` 即可。

> 从 v0.3.9 及更早版本升到 v0.3.10：旧镜像不含 docker CLI，且本机也没有 `docker:27-cli` 时，面板内更新会失败并提示；按路线 B 用离线镜像包升到 v0.3.10 一次，之后面板内更新即可离线完成。

### 备份与恢复（v0.2.0 起）

面板「备份与恢复」页：实例存档备份/恢复（运行中自动 `c_save()`，恢复要求实例停止），更新与删实例前自动备份；每实例保留 10 份、SQLite 快照 5 份；备份包可直接下载，落在 `/var/lib/game-server-hub/backups/`。重要服自行异地留存。

---

## 问题清单（按报错关键词对照）

按安装时序排列，Ctrl+F 搜报错关键词。

### `download.docker.com` 不可达（装 Docker 时）

安装器会回退发行版自带的 `docker.io`，并在发行版源不含 Compose v2 时（Debian 12）自动从 GitHub Release 补装插件（gh-proxy 加速）。自动补装失败时按报错里的手动命令操作后重跑。apt 下载慢可加 `--network cn` 切国内源；其余排查 apt 源签名、系统时间和 HTTPS 出站。

### `Docker Compose v2 plugin is required but unavailable`（装 Docker 时）

仅当自动补装也失败时出现（加速节点全不可达或校验不过）：按报错信息里的手动命令安装插件后重跑安装器（命令见[路线 B 阶段一](#阶段一docker-引擎与-compose-插件)兜底小节）。正常情况下无需手动操作：Debian 12 由安装器从 GitHub Release 自动补装；Debian 13+ 与 Ubuntu 22.04（jammy-updates）起官方源已含 Compose v2（包名 `docker-compose` / `docker-compose-v2`），安装器直接装发行版包。

### `Cannot reach GHCR` / `Image pull failed`（拉镜像时）

国内服务器直接用[路线 B](#路线-b国内服务器debian-12-离线镜像包全程)。定位：`curl -I https://ghcr.io/v2/`（HTTP 401 属正常）；「清单能取到、层下载超时」是网络不可达而非鉴权失败，换代理或重试都不会成功。

### `checksum mismatch`（校验离线包时）

下载内容与 Release 不一致。清理代理/CDN 缓存，确认 `GSH_RELEASE_TAG` 与资源 URL 是同一版本，或改用本地 Release 包和官方 `.sha256`。

### 面板服务不断重启（部署后）

`docker logs --tail 100 game-server-hub-panel` 定位；常见为端口占用、panel.env 缺键或数据库权限，修正后 `docker compose up -d panel`。

### 忘记初始密码（登录时）

按[登录与安全](#登录与安全)提取 `ADMIN_PASSWORD`；已改密遗忘则用 `GSH_PASSWORD_RECOVERY_TOKEN`（在 panel.env 设置至少 16 位后重启面板）走登录页「忘记密码」，或重跑安装器并显式传 `ADMIN_PASSWORD`。两条路都要求变量真正进入面板进程，Docker 模式可先确认：`docker exec game-server-hub-panel sh -lc 'echo $ADMIN_PASSWORD'` 有值。

### SteamCMD 下载慢或失败（装游戏时）

`panel.env` 设 `GSH_STEAMCMD_DOWNLOAD_REGION=cn` 与 `GSH_STEAMCMD_INSTALL_MAX_ATTEMPTS=8` 后重启面板重试；安装前停掉运行中的实例（4 GiB 机器 SteamCMD 峰值 +1–1.5 GiB）。

安装进度停在同一百分比后失败、资源快照里 `timedOut: true`：这是单次 app_update 超时（默认 60 分钟），与内存无关。设 `GSH_STEAMCMD_APP_UPDATE_TIMEOUT_MS=7200000`（2 小时）后重启面板重试，已下载内容会断点续传。

### DST 启动后立即退出（开服时）

看实例日志；常见为 token 失效、Mod 下载不全、内存不足（exit 137 多为 OOM）。详见 [DST_TUTORIAL.md](DST_TUTORIAL.md)。

### 玩家看不到或连不上服务器（开服时）

放行 UDP `10999`/`8766`/`12346`；确认房间未勾选「离线」模式；集群配置见 [DST_TUTORIAL.md](DST_TUTORIAL.md)。

### `Native Release ... missing`（Native 安装时）

Release 未发布 `game-server-hub-native-<tag>-linux-x64.tar.gz` 及 `.sha256`。换已发布版本，或 `GSH_NATIVE_RELEASE_ARCHIVE` 指定本地包（见[附录 A](#附录-a-native-systemd-部署个人服主)）。

### `systemd user manager` / `Failed to connect to bus`（Native 运行时）

```bash
sudo loginctl enable-linger gsh
GSH_UID="$(id -u gsh)"
sudo systemctl restart "user@${GSH_UID}.service"
sudo systemctl restart game-server-hub.service
sudo loginctl show-user gsh -p Linger
```

不要用 tmux、screen 或 PM2 绕过；会破坏日志、自恢复和资源限制语义。

### `cross-mode migration is not supported`（重装时）

Docker 与 Native 之间不自动迁移。保留数据目录后按目标模式重装，再手工迁移 `/var/lib/game-server-hub` 下的数据。

---

## 附录 A Native systemd 部署（个人服主）

不安装、不调用 Docker；游戏进程为 systemd 用户服务，日志进 journald。只支持 x86_64，与 Docker 模式不互相迁移。

```bash
# 安装
git clone --branch v0.4.1 --depth 1 https://github.com/PMAT77/game-serve-hub.git
cd game-serve-hub          # 目录名取自仓库名（game-serve-hub），镜像名才是 game-server-hub
sudo bash ./scripts/install.linux.sh --mode native --network auto

# 离线安装：指定本地 Native Release 包（旁须有同名 .sha256）
sudo GSH_RELEASE_TAG=v0.4.1 GSH_NATIVE_RELEASE_ARCHIVE=/srv/packages/game-server-hub-native-v0.4.1-linux-x64.tar.gz \
  bash ./scripts/install.linux.sh --mode native
```

```bash
# 常用命令与回滚
sudo systemctl status game-server-hub.service --no-pager
sudo journalctl -u game-server-hub.service -f
GSH_UID="$(id -u gsh)"
sudo -u gsh XDG_RUNTIME_DIR="/run/user/${GSH_UID}" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${GSH_UID}/bus" \
  systemctl --user list-units 'gsh-instance-*'

# 回滚到旧版本
sudo systemctl stop game-server-hub.service
sudo ln -sfn /opt/game-server-hub/releases/v0.2.0 /opt/game-server-hub/current.rollback
sudo mv -Tf /opt/game-server-hub/current.rollback /opt/game-server-hub/current
sudo systemctl start game-server-hub.service
```

## 附录 B 安装器参数与自建仓库

```text
--mode auto|docker|native      交互终端 auto 在未装 Docker 时询问；非交互管道默认 Docker。
                               任何 Docker 失败都不会静默改为 Native，生产建议显式写模式
--network auto|cn|global       网络档位（影响镜像源与代理选择）
--open-panel-port              自动放行面板端口
--open-dst-ports               自动放行 DST 端口
GSH_FORCE_IMAGE_PULL=1         强制重新拉取镜像（默认本地已有即跳过）
GSH_PANEL_ENV_PRESET=auto      内存预设档位：auto|small|medium|large
```

自建仓库（先 `docker load` 离线包，再 `docker tag`/`push` 到内网）：

```bash
sudo docker login registry.example.com
# 版本三方必须一致：脚本默认 tag（sed -n '9p' 可查）= 本地镜像 tag = 这里 PANEL_IMAGE 的 tag
curl -fsSL https://raw.githubusercontent.com/PMAT77/game-serve-hub/v0.4.1/scripts/install.linux.sh \
  | sudo env PANEL_IMAGE=registry.example.com/gsh/game-server-hub:v0.4.1 bash -s -- --mode docker --network cn
```

镜像引用与 Release tag 一致，按 Release 的 `release-images.json` 核对 digest。

SteamCMD 可在 `panel.env` 设置（改后重启面板）：`GSH_STEAMCMD_DOWNLOAD_REGION=cn`、`GSH_STEAMCMD_INSTALL_MAX_ATTEMPTS=8`、`GSH_STEAMCMD_HTTP_PROXY` / `GSH_STEAMCMD_HTTPS_PROXY`。
