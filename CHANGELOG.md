# Changelog

本文件记录面向用户的版本变更，格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.4.1] - 2026-09-12

### Fixed

- **面板显示「已就绪」的 Mod 在游戏里不加载（例如本地开了两个 Mod、游戏里只出一个）**：面板一直把 Mod 下载到 SteamCMD 的 `steamapps/workshop/content/322330/<id>`，就据此认定「已安装」、写进 `modoverrides.lua` 并把状态标成「已就绪」；但 **DST 专用服只从实例目录的 `ugc_mods/<存档名>/<分片>/content/322330/<id>` 加载创意工坊 Mod**，完全不看 SteamCMD 的下载位置。于是服务器启动时会自行去创意工坊补下载：带 manifest 的新式包通常能补成功，而老式 **legacy 包**（目录里只有 `*_legacy.bin`，对应 `ugchandle` 且 `manifest=-1`）在容器网络下常下载超时（服务器日志 `ODPF failed entirely: 16`，紧接着 `DownloadServerMods timed out with no response from Workshop...`），DST 等待约 30 秒后放弃并继续启动——玩家进游戏只看到一部分 Mod。现在面板会在**下载完成、写入 Lua 之前以及面板启动时**把已下载内容落位到 `ugc_mods`（`*_legacy.bin` 实测为标准 zip，会自动解包出 `modinfo.lua`／`modmain.lua` 等文件），DST 启动时即识别为已安装（日志 `already have IDs`）并直接加载，不再依赖服务器自身联网下载；落位失败时该 Mod 会明确标记为「安装失败」并给出原因，而不是继续显示「已就绪」。**已有实例会在面板重启后自动补齐**，无需卸载重装 Mod。

## [0.4.0] - 2026-09-12

### Fixed

- **实例操作确认弹窗点了按钮却一直不关**（「准备启动服务器」、停止 / 重启 / 删除确认、更新确认、端口冲突处理）：这些弹窗会等 `onPositiveClick` 的返回值 resolve 之后才关闭（naive-ui 内部是 `Promise.resolve(...).then(() => hide())`），而返回的正是操作请求的 Promise；启动与重启还可能包含镜像准备等耗时步骤，弹窗于是长时间停在「等待实例启动」。现在点击后立即关闭，进度由按钮 loading 承载，启动 / 重启另给一条「正在…，请稍候…」的即时提示，结果仍由既有的成功 / 失败提示与端口冲突弹窗反馈。

### Changed

- **世界 / 房间设置页只保留需要处理的提示**：原先后端把整句说明塞进 `effectiveHints` 并逐条渲染成醒目横幅，导致同一条信息在页面上重复出现（未开洞穴时「洞穴已关闭」「洞穴未开启」再加洞穴开关卡片与洞穴页签，共 4 处），且静态说明每次进页面都重刷一遍。现在顶部只保留异常警告（合并为一条列表）与「实例运行中，配置变更需重启实例后生效」这条影响保存行为的条件提示；其余说明移入对应位置——「世界已生成」进世界规则/世界生成页签、「放行 UDP 端口」进网络页签、联网模式说明进模式选择下方、打开洞穴后从洞穴卡片直接进入世界设置。
- **分片摘要不再下发前端从未使用的 `warnings` 字段**；房间设置中「洞穴配置尚未就绪」由提示升级为警告，与其他异常一起出现在顶部。

### Deprecated

- `GET app/instance/shards` 与 `GET app/instance/cluster` 的 `effectiveHints` 恒为空数组，保留仅为兼容浏览器缓存中的旧前端，将在下个版本移除。

### Upgrade notes

- 面板与后端随统一镜像一起升级，无需迁移数据库或配置文件；浏览器缓存的旧页面不会因字段变更报错（`effectiveHints` 仍返回空数组）。
- 若有自建脚本调用 `GET app/instance/shards`：分片摘要的 `warnings` 字段已移除；`effectiveHints` 已弃用，请改读页面上展示的提示，或依据 `clusterShardEnabled` / `configured` / `worldGenerated` 自行判断。

## [0.3.10] - 2026-09-12

### Fixed

- **世界设置从未真正生效（严重）**：面板一直把世界规则写进 `leveldataoverride.lua`。DST 生成地图时的实际顺序是：先读 `leveldataoverride.lua`，再读 `worldgenoverride.lua`——而面板在安装/启动时写下的 `worldgenoverride.lua` 只带预设（`preset = "SURVIVAL_TOGETHER"`），DST 判定该预设同时命中 worldgen 与 settings 预设后会**用它整份替换世界配置**，于是面板里保存的世界规则、地图生成参数在生成地图时被全部丢弃，玩家看到的是预设默认地图。现在改为**只写 `worldgenoverride.lua`（预设 + 全部覆盖项）这一份真源**，本文件不再写 `leveldataoverride.lua`；启动或保存时会把存量 `leveldataoverride.lua` 的覆盖项迁移进来（迁移前备份、迁移后删除旧文件）。注意：**已生成的地图不会自动改变**，需要该分片重新生成地图才会按面板配置生成；世界设置页对此新增了提示。
- **「准备启动服务器」弹窗的「下次启动不再提示」勾不上**：该复选框的选中状态存在一个普通对象里（不是 Vue 响应式 ref），naive-ui 的 `NCheckbox` 在传入 `checked` 时按受控组件处理，点击后界面不会更新，看起来永远勾不上。现在改用真正的 `ref`；勾选后的记忆也从 `sessionStorage` 改为 `localStorage`，关掉浏览器后依然生效（旧键自动迁移）。
- **面板内「应用更新」在离线/受限网络下必然失败**：重建面板用的 updater 容器固定使用官方 CLI 镜像 `docker:27-cli`，本地没有该镜像时直接报 `(HTTP code 404) no such container - No such image: docker:27-cli`，而国内/离线部署通常也拉不到它。现在**优先使用本地已有的镜像**（目标镜像 → 当前面板镜像 → 官方 CLI 镜像，逐个试跑 `docker compose version` 探测），只有本地都不行时才按顺序拉取兜底镜像（走 `GSH_IMAGE_MIRRORS`），并在失败时列出试过的镜像、拉取原因与手动更新命令。
- **启动引导文案重复**：「已保存房间与地上世界设置，但地图尚未生成。」与「现在启动将按当前房间与世界配置生成地图。」合并为一句话。

### Changed

- **镜像内置 `docker` CLI 与 compose 插件**：统一镜像新增 `/usr/local/bin/docker` 与 `/usr/local/lib/docker/cli-plugins/docker-compose`，供面板内一键更新的 updater 容器直接使用，因此离线环境也能完成面板更新。构建可用 `DOCKER_CLI_URL` / `COMPOSE_PLUGIN_URL`（或 `DOCKER_CLI_VERSION` / `COMPOSE_VERSION`）指向可达的镜像站或内网制品库；代价是镜像约 +100 MB（未压缩）。
- **新增 `GSH_PANEL_UPDATER_IMAGE`**：可选，指定 updater 容器使用的镜像（需自带 docker CLI 与 compose 插件）。留空即自动挑选。
- **世界配置读写字段改名**：`GET /app/instance/shards` 的分片摘要字段 `leveldataOverrides` 改名为 `overrides`（真源变为 `worldgenoverride.lua` 的 `overrides`），语义不变；`ShardSavePayload` 的 `worldRuleOverrides` / `worldgenOverrides` 保持不变。
- **世界已生成时给出明确提示**：世界设置页提示「地上世界已生成：世界规则的改动会在该分片重新生成地图时生效，不会改变现有存档」。

### Removed

- 面板不再写入 `leveldataoverride.lua`，随之移除随包的 Klei leveldata 模板与「极简 leveldata 导致 DST 反复崩溃」的修复逻辑（该文件不再存在）。

### Upgrade notes

- 从 v0.3.9 及更早版本升级：这些版本的镜像不含 `docker` CLI，若本机也没有 `docker:27-cli`，面板内一键更新仍会失败并给出提示；请按 [INSTALL.md 路线 B](docs/INSTALL.md#路线-b国内服务器debian-12-离线镜像包全程) 用离线镜像包升级到 v0.3.10 一次，之后面板内更新即可离线完成。
- 世界配置改动需重新生成地图才生效（生成地图后 DST 不会重读这些文件）。
## [0.3.9] - 2026-09-12

### Added

- **端口提示覆盖洞穴分片**：控制台「直连进服需放行 UDP 端口」此前只列主世界的 3 个端口，照它配置防火墙或 NAT 转发后玩家一进洞穴就会崩线；已生成洞穴分片时现在一并列出洞穴的 3 个端口（11000 / 8768 / 12348）。

### Changed

- **`--open-dst-ports` 同时放行洞穴端口**：此前只放行主世界的 10999 / 8766 / 12346，用户会以为端口已经开好，实际洞穴 3 个端口仍未放行。安装时无法预知之后是否开启洞穴，因此改为一律放行主世界 + 洞穴共 6 个 UDP 端口。
- **单次安装超时改为可配置**：新增 `GSH_STEAMCMD_APP_UPDATE_TIMEOUT_MS`（毫秒），默认上限由 30 分钟提高到 60 分钟；超时失败改为可重试，重试走 Steam 断点续传并保留下载缓存，不再直接判失败。

### Fixed

- **宿主机在 NAT 转发后面的端口与转发规则说明**：[DST 开服教程](docs/DST_TUTORIAL.md) 新增 5.4 节 —— 明确安全组之外还要在云平台端口转发 / 路由器映射里为主世界与洞穴的 6 个 UDP **各加一条**规则、外部端口必须与内部一致（DST 会按 `server_port` 上报 Klei/Steam，公网端口被改成随机高位会导致「列表搜得到、点不进去」），并说明分片间通信的 `10888` 不需要对外开放。同时修正 6.1 节「公网端口映射到内部 8888」的示例：Docker 模式下应映射**宿主机的面板端口**（生产安装默认 9527）。
- **安装器提示的文档路径失效**：未启用 `--open-dst-ports` 时提示的 `docs/others/DST.md` 在本仓库已不存在，改为 `docs/DST_TUTORIAL.md`。
- **SteamCMD 超时被误判为内存 OOM**：单次 `app_update` 超过上限后面板会 SIGKILL 容器，退出码同样是 137，原实现只看退出码就记成「容器可能因硬上限 OOM 被终止」并建议调高 `GSH_STEAMCMD_CONTAINER_MEMORY_MB`——慢速 CDN 下 4 GiB 以上游戏下不完时会被误导去调内存。现在超时终止会写入 `GSH-STEAMCMD-TIMEOUT` 标记，只有面板未主动杀容器时才记录 `oomKilled` 并提示调内存。

## [0.3.8] - 2026-09-12

### Added

- **Release 附带安装脚本与校验和**：发布流程新增 `install-<tag>.sh` 与 `install-<tag>.sh.sha256` 资产，文档可据此改为「下载 → `sha256sum -c` → 执行」，让安装脚本自身也可被校验。

### Changed

- **安装器自证版本**：安装启动时打印实际执行的文件名、目标 Release 与目标镜像；当目标镜像缺失但本地存在同仓库其他 tag 时，先列出本地已有 tag 并提示可用 `GSH_RELEASE_TAG=<tag>` 复用，避免整份重拉。
- **`gsh doctor` 的 Native 升级命令改为固定版本**：不再指向 `main` 分支脚本（main 的默认 tag 可能与已安装版本不一致），改用 `panel.env` 中记录的实际版本。
- **安装器结尾摘要改为醒目的边框区块**：面板地址、管理员账号、初始密码读取命令、常用命令与后续步骤集中展示，不再混在 `[INFO]` 日志流里；`compose ps`、面板日志等长排障命令保留在区块之后。

### Fixed

- **Docker 部署的管理员凭证与首登策略未进容器**：`docker compose --env-file panel.env` 只做 compose 文件插值，而 `docker-compose.yml` 的 panel 服务没有映射 `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `FORCE_PASSWORD_CHANGE` / `GSH_SYNC_ADMIN_PASSWORD_FROM_ENV` / `GSH_PASSWORD_RECOVERY_TOKEN`，导致容器按"未配置密码"自行生成随机密码、且首次登录不触发强制改密 —— 用户照着安装摘要从 `panel.env` 读到的密码必然登录失败。现已补齐透传，并新增 compose 透传防回归测试；存量部署需把新版 `docker-compose.yml` 覆盖到 stack 目录后重建面板容器。
- **初始凭据文件不再落盘未生效的随机密码**：`admin-credentials.txt` 原先只要判定"密码是自动生成的"就写入，而管理员已存在且未开启 `GSH_SYNC_ADMIN_PASSWORD_FROM_ENV` 时该密码根本没写库，且每次启动都会被新的随机值覆盖 —— 用户照它登录同样失败。现在仅在密码确实创建/更新了数据库记录时才写文件，其余情况保持文件原样（它记录的仍是首次创建管理员时的初始密码）并给出明确日志。
- **安装文档不再静默使用旧脚本**：路线 B 的 `wget` 改为 `curl -fL -o "install-${tag}.sh"`，并新增 `sed -n '9p'` 版本自证、离线包内镜像 tag 核对与 `docker load` 后的 tag 断言。此前 `wget` 遇到同名文件不会覆盖而是另存为 `.1`，继续执行旧脚本会得到「脚本 v0.3.5 + 离线包 v0.3.7」的错配；安装器只按完整引用判断镜像，于是重新拉取一个并不需要的版本。同步修正附录 A 的 `cd` 目录名（clone 出来的是 `game-serve-hub`）。

## [0.3.7] - 2026-09-11

### Changed

- **安装器 Debian 12 自愈**：Docker 官方源不可达而回退发行版 `docker.io` 时，若发行版源不含 Compose v2（Debian 12），安装器自动从 GitHub Release（gh-proxy 加速 + 官方 sha256 校验）补装 Compose v2 CLI 插件，不再要求手动安装；自动补装失败时错误信息直接给出与文档一致的手动命令。路线 B 安装命令追加 `--network cn` 加速 apt 下载，文档与安装器冒烟测试同步更新。

## [0.3.6] - 2026-09-11

### Changed

- **镜像体积大幅瘦身（解压约 3.2 GB → 约 2.2 GB）**：服务端打包改为全量自包含（与 Native 发行包同款配置，已在生产验证），统一镜像与 Docker 运行层不再携带 node_modules；镜像内不再提供 pnpm / npm / tsx 等包管理工具，排障请使用 `docker logs`、面板 API 与宿主机 `gsh` CLI。
- **前端产物瘦身**：移除未被使用的图标集数据死重（主包 -404 KB）；网卡监控图表改为 echarts/core 按需注册（chunk 1.09 MB → 0.53 MB）；生产构建默认不再生成无消费方的 `.gz/`.br` 预压缩文件。

### Fixed

- **Debian 13+ 安装兼容**：安装器支持官方源打包的 Compose v2（`docker-compose` 包，版本为 2 时才安装，Debian 12 同名 v1 包不会误装）。
- **安装指南重构**：整理为路线 A（一键安装）/ 路线 B（国内离线镜像包）两条主线，并修正 README 等关联文档锚点。

## [0.3.5] - 2026-09-11

### Fixed

- **面板检查不到跨版本更新（Docker 模式）**：检查更新只比对 `PANEL_IMAGE` 固定 tag 的本地与远端镜像摘要 —— 面板跑 v0.3.3 时永远拿 v0.3.3 与 v0.3.3 比，结论恒为「无更新」，GitHub Release 上的新版本号被短路、不参与判断。现在只要读取到更新的 Release 版本，就改以该版本的目标镜像作为远端基准重新比对，跨版本提示恢复生效。
- **GitHub Release 查询可走反代**：更新检查直连 `api.github.com`，失败时静默返回，国内服务器表现为「检查不到新版本」。新增 `GSH_GITHUB_API_BASE` 配置（默认 `https://api.github.com`），可指向任意兼容 GitHub API 的反代地址。

## [0.3.4] - 2026-09-11

### Added

- **实例管理节点监控自动刷新**：展开「运行环境与安装镜像」面板后，节点 CPU/内存/磁盘卡片每 10 秒静默刷新，不再需要手动点「刷新节点」；面板折叠或离开页面时自动停止，后端恢复后自动续传。

### Fixed

- **实例管理折叠面板不再闪动**：面板默认保持折叠，节点列表与 SteamCMD 安装状态改为页面挂载时预取 —— 首次进入顶部标签即显示「就绪/需要初始化」，不再依赖手动展开面板。

- **空状态观感统一**：所有空态统一 24px 上下留白；表格空态图标与文字放大一档；模组管理空表格的空态不再贴顶，改为垂直居中。

- **开发环境热更新偶发失效**：Vite 文件监听排除 .pnpm-store、.ci-node22 等数万文件的缓存目录，避免监听器过载导致改动不生效（需重启 dev server 生效）。

## [0.3.3] - 2026-09-11

### Fixed

- **面板内「应用更新」升不动版本**：此前它只重新拉取 `panel.env` 里写死的当前镜像 tag，从不理会 Release 上的新版本号 —— v0.3.1 点更新会白白下载几百 MB 的 v0.3.1 镜像再原样重建，版本号纹丝不动。现在以 Release tag 为目标镜像，一次点击即可真正跨版本升级。
- **「更新失败」多半是假象**：下载镜像动辄数分钟，而前端请求 60 秒就超时，界面必然弹出「更新失败」，服务端却还在继续拉取 —— 刷新页面后按钮才变成「更新中」，用户无从判断到底成没成。现在请求立即返回，界面按「检查本地镜像 → 下载镜像 → 重建面板」显示实时阶段，失败时给出具体原因。
- **更新状态会永久卡在「更新中」**：updater 容器启动失败（例如 `docker:27-cli` 拉不到）时状态不复位，按钮从此禁用。现在任何失败路径都会复位，另有 30 分钟看门狗兜底。
- **离线镜像包导入后仍会重新下载**：即使用 `docker load` 把目标镜像导入本地，更新仍会强制拉取并因此失败。现在先检查本地镜像，命中就跳过一切下载直接重建；面板容器对 `/stack` 只读，改由 updater 容器写入 `panel.env` 并重建面板。设置页同时新增「下载慢或失败？改用离线镜像包」折叠块，直接给出下载与导入命令。

## [0.3.2] - 2026-09-11

### Fixed

- **面板更新提示永远显示「镜像内容有更新」**：Docker 部署下更新只按镜像摘要比对，而同一个镜像在不同层级各有一个摘要 —— 多架构镜像的 manifest list（索引入口）、各平台清单、平台清单里的 config，以及 config 内部的未压缩层摘要。`docker pull` 在本地记录的是 manifest list 摘要，检查更新时却把远端索引下钻成平台清单摘要来比，两侧口径不同，v0.3.1 对 v0.3.1 也永远对不上号：每次检查都报「镜像内容有更新」，把镜像重新拉取一遍也照报不误。现在改成成套比对 —— 本地收集 `RepoDigests`、镜像 Id 与 `RootFS.Layers`，远端收集 manifest list、各平台清单、config 摘要与层摘要，任何一种凭据对上就认定是同一个镜像。这条链也顺带修好了**离线镜像包安装**（`docs/INSTALL.md` 推荐的国内路径）：离线包经 `docker save`/`load` 或 buildx 重新导出后，其 config 摘要与 registry 上的并不一致（`docker inspect` 看到的镜像 Id 因此对不上，在 ghcr 上也查不到这个摘要），此前同样必然误报，现在靠层指纹即可认出是同一份内容。

## [0.3.1] - 2026-09-10

### Fixed

- **安装器内存预设未写入**：`write_builtin_panel_env_preset_asset` 把 heredoc 包在 `bash -c "..."` 内部，内层 shell 拿不到后续行，于是预设内容被当作命令执行（安装日志里出现 `small.env: command not found`），`panel.env` 实际没有写入内存上限参数 —— 小内存机器因此缺少运行时内存守卫。已改为命令替换内的 heredoc + `tee` 落盘，并修正内置 `small.env` 的 `GSH_DST_CONTAINER_MEMORY_MB`（768 → 1536，与 `config/panel.env.presets/small.env` 对齐）。
- **原地升级缺失必需键**：升级路径只更新镜像相关键，不会补 `PANEL_DATA_DIR` / `PANEL_LOG_DIR` / `PANEL_PORT` 等。老 `panel.env` 里若没有这些键，会先后导致 `docker-compose.bind.yml` 报 `invalid spec: :/app/data: empty section between colons`，以及端口回退到默认值后与宿主机已有服务冲突（`address already in use`），而报错信息完全指不出原因。现在升级时会**仅补齐缺失键，不覆盖用户显式设置过的值**。
- **离线镜像包导入后安装器仍尝试拉取**：`docker pull` 失败会中止整个安装，使「下载 Release 离线包 → `docker load` → 跑安装器」这条国内推荐路径失效（与 `INSTALL.md` 的描述不符）。现在安装器会先检查本地是否已有该镜像（`v*` tag 不可变，无需重复拉取），有则跳过；确需强制拉取可设 `GSH_FORCE_IMAGE_PULL=1`。拉取失败时的报错也会明确指向离线镜像包方案。

## [0.3.0] - 2026-09-10

### Added

- **计划任务**：实例定时重启、定时备份、定时更新检查、面板数据库定时快照四类任务，支持间隔（1–168 小时）与每日固定时刻（HH:MM）两种调度。执行前先推进下次执行时间（崩溃不重复执行）；面板离线期间错过的任务在启动时标记为「已跳过」并顺延，绝不补跑；安装/更新中的实例自动跳过本轮；数据库快照任务全局唯一。入口在运维「计划任务」页。
- **崩溃感知**：面板每分钟对账数据库运行状态与实际运行时——Docker `on-failure` 重试耗尽或 systemd 放弃拉起后实例「静默死亡」的场景下，自动将实例标记为已停止、记录异常退出时间并在状态列显示「异常退出」徽标；启动宽限期（90 秒）与探测失败不产生误报。
- **通知渠道**：新增钉钉群机器人（支持加签）、企业微信群机器人、飞书群机器人、Server酱、PushPlus 五类国内直连可达渠道。实例异常退出、主机 CPU/内存/磁盘超阈值、计划任务备份结果自动推送；同实例同事件默认 15 分钟冷却窗口；渠道连续失败 5 次标记「连续失败」（健康状态可自愈恢复）；支持发送测试消息验证连通性；渠道配置（密钥/Token）在列表中脱敏展示。设置入口在「系统设置 → 通知渠道」。
- **计划任务时区可选**：每日固定时刻任务支持「北京时间」（默认，固定 UTC+8，与部署环境时区无关）与「服务器所在时区」（面板进程本地时区）两种选择，创建/编辑弹窗中选择并在列表展示。存量任务自动迁移为北京时间；间隔类任务不涉及时区。
- **计划任务触发通知与执行中状态**：任务被触发时在面板右上角弹出通知（任务类型、目标实例、执行结果，点击可跳转「计划任务」页），无需停留在计划任务页；执行期间任务列表「执行状态」显示「执行中」，结束后自动刷新为成功/失败/跳过。
- **实例详情页**：新增独立的实例详情页，按「房间概览 / 世界概览 / 实例控制 / 命令中心」四块组织信息，不必在实例列表、世界设置与控制台之间来回跳转；配套新增后端对存档世界状态的解析。原「实例管理」页相应瘦身，只保留列表与批量操作。

### Fixed

- **计划任务中断恢复**：面板在任务执行过程中被重启时，数据库中残留的「执行中」状态会在启动时标记为「失败（面板重启导致上次执行中断）」并顺延下次执行时间，不再永久停在执行中；已停用任务的残留状态同样会被清理。
- **计划任务时区**：Docker 镜像与 compose 默认注入 `TZ=Asia/Shanghai`（可通过 `TZ` 环境变量覆盖）。此前容器内未设置时区，Node 按 UTC 计算「每日 HH:MM」计划任务，北京时间用户创建 08:40 的每日备份会显示并在 16:40 执行。修正后重启面板即可：已过期的任务相位在启动时按新时区顺延，未过期的在下一次执行后自动修正，无需迁移数据。
- **分片状态标签**：「世界设置」页 tab 上「地上 / 洞穴」的状态标签此前在实例停止时显示「未创建」，容易被误读为存档丢失。该标签反映的是运行容器是否存在——面板停止实例时会连同容器一起删除以释放内存，而导入存档又要求实例先停止，所以停止状态下必然没有容器。现在容器不存在但分片已有配置或存档时显示「未运行」，只有确实既无配置也无存档时才显示「未配置」，用词与颜色同「世界列表」「实例详情」保持一致。
- **面板更新提示自相矛盾**：Docker 部署下镜像更新只按摘要比对，此前把「摘要不同」直接写成「面板版本：v0.2.2（有新版本）」，与同行的「最新版本：v0.2.2」互相打架。现在改为一句话结论「镜像内容有更新」（版本更高时显示「有新版本 v0.3.0」，读不到版本号时显示「检测到镜像有更新」）。更新通知里「系统设置 → Hub 版本」的指路也与实际标题不符，一并修正为「面板与游戏版本」。
- **控制台直连命令默认档位**：此前固定默认展示「公网」档。在容器 / 家用 NAT / 开着系统代理的环境下该地址常常无法直连（面板跑在容器里时，出站 IP 探测甚至可能返回代理出口地址而非本机地址），照抄命令只会得到「服务器没有响应」。现在按地址来源自动选择默认档位：出站 IP 探测得到的地址默认展示「本机」档（`c_connect("127.0.0.1", …)`），云厂商元数据与手动配置仍默认「公网」档；手动切换后不会被轮询覆盖。地址来源为出站探测时，命令下方额外说明其适用范围；检测到 `HTTP_PROXY` / `HTTPS_PROXY` 时提示该地址可能指向代理出口。
- **进服地址逃生口在 Docker 模式下不生效**：`panel.env` 中的 `GSH_DST_CONNECT_HOST` 与 `GSH_DST_AUTO_PUBLIC_IP` 此前不会被注入面板容器——两份 compose 的 `environment` 白名单里没有这两个键，而 `--env-file` 只提供变量插值。多网卡 / NAT / 代理环境按文档设置这两个变量不会生效，现已补齐。
- **面板端口默认值统一**：面板端口的出厂默认值此前在数据库兜底与系统设置中写作 `80`，现统一为 `9527`。同时收紧启动同步逻辑：仅在生产部署且显式声明发布端口时才初始化或校正面板端口，开发与测试环境不再回写数据库。**用户手动设置过的端口不受影响。**

### Changed

- **计划任务列表与文案**：原「最近执行」列拆分为「执行状态」与「最近执行时间」两列，状态与时间不再挤在同一列；新建/编辑弹窗底部说明精简为一句「运行中实例的定时备份会先发送 c_save() 热保存。」；「备份与恢复」列表的创建者列将调度器标识 `scheduler` 显示为「计划任务」，人工备份仍显示登录账号。
- **存档导入改为本地上传**：「导入外部存档」不再要求填写面板宿主机上的目录路径，改为直接上传自己电脑上的存档压缩包（zip 或 tar.gz，如压缩后的 `Cluster_x` 目录、`DoNotStarveTogether` 目录或面板下载的备份包），面板在服务端解压识别集群候选后一键导入。上传上限 2GB 并展示上传进度；导入成功后自动清理临时文件，未完成导入的记录 24 小时后自动清理。原「选择服务器目录」入口已移除。
- **「面板与游戏版本」区块整块瘦身**：「应用更新」置灰时不再罗列「未配置 `GSH_STACK_DIR`」「安装目录不是绝对路径」「容器内看不到 compose 目录」「Native/systemd 安装」这些用户既看不懂、也不影响操作的原因——四种情况对用户而言都只是「去服务器终端跑一条命令」，现在统一成一句「当前部署方式不支持面板内自动更新」加一条可复制的 `sudo gsh update`；长 `docker compose` 命令收进默认折叠的「其他更新方式」，并说明重跑安装脚本可恢复面板内一键更新（详见 `docs/INSTALL.md` 第 9 节）。
- **面板不再原样展示 GitHub Release 正文**：此前把 Release 说明整段摊在设置页——镜像不可变 digest、离线镜像包 `.sha256`、发布流水线描述、升级须知连同 Markdown 的 `**`/`##` 标记和「Full Changelog」比较链接。现在只保留一句结论与一个「更新说明」外链（指向 GitHub Release 页），区块描述也从两句话缩到一句。
- **明确平台边界**：文档不再暗示 Windows 可作为部署平台。Windows 仅用于本机开发调试（用「本机」档 `c_connect("127.0.0.1", …)` 进服即可），生产部署以 Linux 为目标平台，且不提供 Windows 安装脚本——桌面 Windows 会休眠、会自动更新重启，无法承担长期在线的游戏服务器。同时 README 调整为面向服主的顺序（适合谁 → 它能做什么 → 快速开始 → 常见问题），并新增 QQ 群交流入口。

## [0.2.2] - 2026-09-08

### Fixed

- **发布流程**：candidate 镜像清理失败不再阻塞发布结果（GHCR 首次发布后需在 Package settings 手动授予 Actions 访问权限）。正式镜像与 Release 产物自 v0.2.0 起均发布成功，本次为获得绿色 CI 的流程重发；代码与 v0.2.1 一致，无功能性变更。

## [0.2.1] - 2026-09-08

### Fixed

- **安装器**：移除多仓库探测与阿里云 ACR / Docker Hub 中转（`--registry` 参数删除）。统一镜像仅发布 GHCR；此前 `--registry auto` 在国内会默认探测并指向从未发布镜像的 ACR 仓库，导致 `docker pull` 失败。国内安装路径改为 Release 离线镜像包、`GSH_IMAGE_MIRRORS` 自配镜像代理或 `PANEL_IMAGE` 覆盖。
- **数据库迁移**：补齐 0012/0013 迁移遗漏的 drizzle 快照（新增 0014 迁移，重复列由迁移执行器的 duplicate-column 容错保证幂等），修复 CI schema 漂移检查失败。

## [0.2.0] - 2026-09-08

### Added

- **统一镜像**：面板（Node.js）+ DST 运行库 + SteamCMD 合并为单一 `game-server-hub` 镜像（Debian 12 基础），镜像保持中性（无 ENTRYPOINT/HEALTHCHECK/USER），面板入口由 compose 提供，健康检查移至 compose。镜像更新只需拉取应用代码层。
- **国内可达分发**：Release 附带离线 `docker save` 压缩镜像包（加速代理可下载，`docker load` 导入）；安装资源镜像池更新国内加速节点（gh-proxy.com/ghfast.top 等）并支持 `GSH_GITHUB_PROXY` 强制指定；镜像仅发布 GHCR，面板侧支持 `GSH_IMAGE_MIRRORS` 自选镜像代理。
- 新增 `gsh` 装后管理命令（`scripts/gsh.sh`）：status/start/stop/restart/logs/update/doctor/setup-swap 与交互菜单，Docker/Native 双模式适配；`doctor` 一键收集脱敏诊断，`setup-swap` 缓解小内存机 OOM。
- 新增 `GSH_IMAGE_MIRRORS`：面板拉取镜像的备选 registry 候选（泛化自 `GSH_STEAMCMD_IMAGE_MIRRORS`，后者保留兼容）。

### Changed

- 新增「存档导入」：将外部 Klei DST 集群存档目录（支持集群目录、`DoNotStarveTogether/<用户ID>/Cluster_N` 等层级）一键导入为指定实例的世界存档。导入前自动创建「导入前」安全备份；世界数据与房间设置保留源档，端口自动重写为本实例配置并同步数据库，避免多实例端口冲突；源档 Mod 反向写入面板 Mod 列表（`pre_import` 备份类型，工作坊内容缺失时提示）；导入与恢复共用实例级互斥锁。入口在「备份与恢复」页。

- 新增「备份与恢复」：实例存档一键备份/恢复（klei-storage 全量 tar.gz）、流式下载、保留策略（默认每实例 10 份）、更新/删除实例前自动备份钩子；面板 SQLite 数据库快照（VACUUM INTO，默认保留 5 份）。恢复前自动创建安全备份，运行中实例拒绝恢复。配套新增 `ops:read`/`ops:manage` 权限点与导航「备份与恢复」页。

### Changed

- 后端默认监听端口从 `3000` 迁移至 `8888`（避免与本机常驻开发环境服务冲突，详见 `docs/DEVELOPMENT.md` 已知问题）；生产安装的对外端口仍为 `9527`（安装脚本显式写入 `SERVER_PORT`），不受影响。

- 新增 Docker / Native systemd 双运行时；Native 模式下的面板、SteamCMD 和 DST 分片均不依赖 Docker。
- Linux 安装器新增 `--mode auto|docker|native` 与 `--network auto|cn|global`，支持国内 apt 镜像、SteamCMD 重试和多源安装资源回退。
- GitHub Release 流程新增 Linux x64 Native 包与同名 SHA256 文件。
- 新增中文架构、双模式安装、升级回滚与按错误关键词排查文档。

### Changed

- 监控与 SteamCMD 页面改用通用运行时语义，不再假定 Docker。
- 同模式重跑安装器改为原地升级：保留 `panel.env`，并在升级前备份 SQLite 与部署配置。
- **破坏性**：新增 `GSH_INSTALL_PATH_POLICY`（默认 `instances-root`），创建实例的安装路径必须位于 `GSH_INSTANCES_ROOT` 之下；确需自定义目录请显式设置 `GSH_INSTALL_PATH_POLICY=any` 并自行承担隔离风险。既有实例不受影响，可继续启动与删除。
- **破坏性**：Node.js 引擎要求收敛为 `^22.13.0 || >=24`。后端使用 Node 内置 `node:sqlite`，Node 20 无法启动后端，此前文档标注的 `^20.19` 支持不成立。
- **公告补记**：0008 迁移（随 v0.1.4 发布）会把全部已启用的实例 Mod 强制禁用（`UPDATE instance_mods SET enabled = 0`），需要手动重新启用；此行为此前未在变更记录中说明。0010 迁移已把 `instance_mods.enabled` 默认值修正为 0，此后新加入的 Mod 默认禁用。

### Fixed

- 清除 Native 安装、资源快照、定时更新检查中的隐式 Docker 依赖。
- 修复已有前端类型错误，使完整 `vue-tsc` 与生产构建重新通过。
- 新增 0010 迁移补账全部影子 schema（`auth_sessions` 7 列、`game_instances` 12 列、`users.must_change_password`、维护公告两张表），并在 CI 增加 `drizzle-kit generate` 无差异门禁，防止迁移与 schema 再次漂移。
- 修复删除实例的顺序：先删数据库记录再清理磁盘目录，目录清理失败只告警，不再出现“记录仍在、文件已没”的不一致状态。
- **公告补记**：修正安装器内置 `docker-compose.yml` 校验和（`eb30aeae…` → `a34665e2…`）。旧 pin 与 tag 内文件 blob 不匹配，v0.1.4 的 Docker 安装在默认严格校验（`STRICT_INSTALLER_ASSET_CHECKSUM=1`）下会因校验失败中止；此前未被发现是因为 `install-linux-smoke.sh` 直接哈希工作区文件，Windows CRLF 检出下不会暴露真实差异。smoke 现已先归一化为 LF 再校验。
- 修复"取消安装后立即重新安装"竞态：取消不再提前清除进行中标记，取消与完成两个方向的终态写入均加前置状态守卫，任何一方都不会覆盖另一方的结果。
- SteamCMD 排队任务在获得锁时检查取消标记：排队期间被取消的任务直接跳过执行，且不再污染后续重试。
- Docker 日志 follow 流补齐销毁逻辑并接入中止信号，消费方退出时不再泄漏 docker 连接句柄。
- `updateGameInstanceRuntime` 支持 `whereStatus` 前置状态守卫，安装管线全部终态写入接入。
- 登录限流、找回/改密失败计数落 SQLite（新增 `auth_rate_limits` 表，0011 迁移），面板重启后限流状态不再清零，表容量由定期清理保证有界。
- 业务模块不再直接实例化 dockerode，统一经 infra 层 `createDockerClient` 工厂获取客户端。
- CI 质量门禁新增 release 引用一致性校验与生产构建（含服务端打包）；镜像新增 `HEALTHCHECK`（node fetch 探活 `/health`）。
- 服务端新增 esbuild 打包（`pnpm run build:server`）：Docker 镜像 production 阶段复用打包产物，`node` 直跑不再经 tsx 转译，镜像不再拷贝 server/shared 源码；运行时仓库资源（迁移目录、前端产物、DST leveldata 模板）改为从部署根统一探测定位。
- 说明：镜像暂不以非 root 用户运行——docker.sock 的宿主 gid 因发行版而异，非 root 需 entrypoint 动态调组或 compose `group_add`，且数据/日志绑定挂载需属主匹配，待部署矩阵验证后启用。
- 修复 Mod 管理在快速切换实例时旧实例响应覆盖新实例列表的竞态。
- 引入 oxlint 静态检查（`pnpm run lint:ox`，CI 以 `--deny-warnings` 门禁），清零全部告警：未用导入、多余展开拷贝、正则冗余转义等。

### Security

- Compose 安装资源使用安装器内置 SHA256，校验过程不再强制二次访问 GitHub Raw。
- Native systemd 服务采用专用无登录用户、只读 Release、受限可写路径和权限受控的控制台 FIFO。
- 登录限流不再无条件信任 `X-Forwarded-For`：仅当连接对端命中 `GSH_TRUST_PROXY` 配置的可信代理列表时才采信，并新增不可伪造的 socket 地址限流维度，阻断伪造请求头的密码喷洒。
- 自动生成的管理员初始密码不再写入日志，改为写入数据库同目录的 `admin-credentials.txt`（0600 权限），首次登录改密后自动删除。
- 前端“记住我”不再把明文密码写入 localStorage（历史遗留值会在下次访问登录页时自动清除），密码请交给浏览器密码管理器。
- 安装器写入 `panel.env` 改为 printf 逐行写入后原子落盘：环境变量传入的凭证含 `$`、反引号、引号时不再被 shell 展开破坏。
- 镜像发布流水线强制要求仓库变量 `STEAMCMD_ARCHIVE_SHA256` 非空，拒绝发布未校验的 SteamCMD 二进制。
- 安装器管理员密码回退生成改用 `/dev/urandom`（约 128 bit 熵），移除秒级时间戳弱熵回退。
- 找回密码接口新增找回口令哈希维度的失败封锁：攻击者更换 IP 也无法对同一口令持续爆破，超限后该口令在窗口内临时失效。
- CORS 反射任意 Origin（`CORS_ORIGIN=true/*`）时自动禁用凭据，消除"反射 + 凭据"组合放行任意站点携带凭据跨域调用的风险。

## [0.1.4] - 2026-07-26

### Changed

- Linux 一键安装默认预拉 SteamCMD 镜像；首次打开面板即可创建实例，仍可通过 `INSTALL_STEAMCMD_IMAGE=0` 跳过预拉。
- 实例创建流程不再要求管理员先到镜像管理页手动拉取 SteamCMD；后端统一确保容器运行时就绪。
- CI 在 PR 与 `main` 推送时仅执行轻量质量检查；生产构建、GHCR 镜像发布与 GitHub Release 仅在 `v*` Release tag 时执行。
- Release 成功后自动清理本次 candidate 镜像，避免 GHCR 存储累积。

### Security

- 所有 GitHub Actions 均固定到完整 commit SHA，并保留来源版本注释，避免可变 Action tag 改写发布行为。

## [0.1.3] - 2026-07-18

### Changed

- 容器发布改为构建验证、candidate 推送、完整镜像集提升三个阶段，正式 tag 不再边构建边发布。
- 移除公开 CI/CD 中的个人 ACR 同步链路；GHCR 是唯一官方镜像源。
- CI 合并为单次依赖安装的 `Quality Gate`，同时保留类型检查、233 项单测与生产构建。

### Security

- Release tag 必须匹配 `package.json`、存在 Changelog 条目并指向已经合并进 `main` 的提交。
- 正式镜像附带 provenance、SBOM 与 `release-images.json` digest 清单，且禁止覆盖已有 tag。

## [0.1.2] - 2026-07-18

> 发布失败：仅部分镜像 tag 写入 GHCR，不可作为安装版本。

### Fixed

- SteamCMD 镜像构建时的预热步骤在 Valve 服务出现短暂网络故障时自动重试，避免取消同批镜像发布。

## [0.1.1] - 2026-07-18

> 发布失败：三类镜像未形成完整集合，不可作为安装版本。

### Added

- 发布 SteamCMD 基础镜像，并将面板、DST、SteamCMD 三类镜像纳入同一个 Release 与 digest 清单。

### Changed

- 生产安装默认锁定同一个不可变 Release 的安装资源与镜像，不再默认使用可变的 `latest`。

## [0.1.0] - 2026-06-06

首个带版本号与 CI 门禁的公测发行版。

### Added

- **CI 质量门禁**：PR / `main` 推送自动执行 `lint`、`test:unit` 与生产构建（[`.github/workflows/ci.yml`](.github/workflows/ci.yml)）
- **社区基础设施**：`CONTRIBUTING.md`、`SECURITY.md`、`CODE_OF_CONDUCT.md`、`docs/RELEASE.md`
- **Issue / PR 模板**：Bug、功能建议、使用提问
- **Dependabot**：npm 与 GitHub Actions 每周依赖更新检查
- 强制改密页 `/force-change-password` 与完整拦截流程
- 共享宿主机指标模块 `server/src/shared/host-metrics.ts`
- 实例管理页拆分：`InstanceInstallLogModal`、`useInstanceRuntimeObservability`
- 安全与配置相关单测（强制改密、CORS、生产密码、宿主机指标）

### Changed

- `FORCE_PASSWORD_CHANGE=1` 时首次登录须完成改密后方可进入面板（不再仅 toast 提示）
- 生产环境 CORS 默认同源（`false`）；开发环境默认允许跨域，可通过 `CORS_ORIGIN` 配置白名单
- `node` 与 `system` 模块共用宿主机 CPU/磁盘采样状态
- README / INSTALL / 模块文档与 Mod、占位模块实现状态对齐

### Security

- 生产环境未配置 `ADMIN_PASSWORD` 时自动生成强随机密码并写入启动日志
- 生产初始化不再种子化 `superadmin/123456` 弱密码演示账号
- 未改密用户访问受保护 API 返回 `AUTH_FORCE_PASSWORD_CHANGE`

## [0.0.0] - 公测基线

首个公开仓库版本，核心能力：

- Linux 一键安装与 Docker Compose 部署
- DST 实例生命周期、监控台、控制台
- DST 房间 / 世界 / Mod 管理
- 面板与 DST 镜像 GHCR 发布（`v*` tag）

[Unreleased]: https://github.com/PMAT77/game-serve-hub/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/PMAT77/game-serve-hub/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/PMAT77/game-serve-hub/compare/v0.3.10...v0.4.0
[0.3.10]: https://github.com/PMAT77/game-serve-hub/compare/v0.3.9...v0.3.10
[0.3.9]: https://github.com/PMAT77/game-serve-hub/compare/v0.3.8...v0.3.9
[0.3.3]: https://github.com/PMAT77/game-serve-hub/compare/v0.3.2...v0.3.3
[0.3.4]: https://github.com/PMAT77/game-serve-hub/compare/v0.3.3...v0.3.4
[0.3.5]: https://github.com/PMAT77/game-serve-hub/compare/v0.3.4...v0.3.5
[0.3.2]: https://github.com/PMAT77/game-serve-hub/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/PMAT77/game-serve-hub/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/PMAT77/game-serve-hub/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/PMAT77/game-serve-hub/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/PMAT77/game-serve-hub/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/PMAT77/game-serve-hub/compare/v0.1.4...v0.2.0
[0.1.4]: https://github.com/PMAT77/game-serve-hub/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/PMAT77/game-serve-hub/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/PMAT77/game-serve-hub/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/PMAT77/game-serve-hub/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/PMAT77/game-serve-hub/compare/v0.0.0...v0.1.0
[0.0.0]: https://github.com/PMAT77/game-serve-hub/releases
