# ADR-001：v1 采用全容器化部署

- **状态**：已接受  
- **日期**：2026-05-18  
- **决策者**：产品/技术（用户确认）

## 背景

早期实现采用宿主机 `child_process` 直启 DST，安装脚本将面板放入 Docker 而 SteamCMD 留在宿主机，导致开发/生产路径分裂，且难以稳定支持 DST 洞穴（Master + Caves）双进程。

## 决策

v1 生产与验收以 **Docker Compose 栈** 为准：

1. 面板、`steamcmd`、游戏实例（按 Shard 分容器）均容器化。  
2. 面板通过 Docker API（或 Compose）管理游戏容器生命周期。  
3. 实例数据落在命名卷或绑定挂载，路径约定见 [DOMAIN.md](../DOMAIN.md)。

## 理由

| 收益 | 说明 |
|------|------|
| 环境一致 | 开发/生产同一套 Compose，减少「我机器上能跑」 |
| 洞穴支持 | Master/Caves 独立容器，共享 Cluster 卷 |
| 资源隔离 | 端口与 cgroup 清晰 |
| 商业扩展 | 云厂商预装镜像 + Compose 易标准化 |

## 代价与风险

| 风险 | 缓解 |
|------|------|
| 实现工作量大 | 单独立项 M0，阻塞其他 P0 的生产验收 |
| Docker socket 安全 | 最小权限、输入校验、文档警示 |
| Steam 网络/NAT | 文档说明端口映射；必要时 ADR 补充 host 网络 |
| Windows 支持延后 | v1 仅 Linux；Windows 另立 ADR |

## 后果

- 重构 `server/src/modules/instance` 与 `console`。  
- 新增 `ContainerRuntime` 与镜像构建 CI。  
- 更新 `scripts/install.linux.sh` 仅部署栈，不在宿主机安装 Node 跑面板。  
- 模块 0（2026-05-18）：**面板**一键安装与 Compose 部署已验收（场景 A）；`ContainerRuntime` 与实例链路代码已合并，**须在 Compose 栈回归**（场景 C，模块 2 等）。其余「需 M0 回归」项见 [TODO.md](../TODO.md) §4。

## 参考

- [ARCHITECTURE.md](../ARCHITECTURE.md)  
- [FDS-00-install-runtime.md](../FDS/00-install-runtime.md)
