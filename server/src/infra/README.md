# infra 目录说明

该目录用于外部系统适配层，负责与第三方依赖或系统能力对接。

## 职责边界

- 封装对 Docker、SteamCMD、文件系统、进程管理、网络探测等外部能力的访问。
- 将第三方 SDK / 命令行调用转换为内部可用的统一接口。
- 屏蔽第三方差异，降低业务模块对外部实现的耦合。

## 设计建议

- 按外部系统拆分子目录（例如 `docker/`、`steamcmd/`、`os/`）。
- 面向接口编程，由业务模块依赖抽象，不直接依赖外部 SDK 细节。
- 外部调用异常统一转换为业务可识别错误。

## 已落地适配（2026-05-17）

| 文件 | 职责 |
|------|------|
| `powershell.ts` | Windows PowerShell 命令执行 |
| `docker.ts` | Docker 运行状态探测与缓存 |
| `steamcmd.ts` | SteamCMD 路径解析与 Linux 自动安装 |
| `filesystem-browse.ts` | 受控目录浏览与搜索 |

业务模块 `server/src/modules/system/` 通过上述适配层访问外部能力，路由注册保留在 `system/index.ts`，指标采集在 `system/metrics.ts`。
