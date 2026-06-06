# modules 目录说明

该目录用于承载业务模块代码，是后端核心业务能力的组织入口。

## 当前模块

- `auth`：认证、登录态、权限、密码管理
- `system`：系统设置、网络入口配置与生效编排
- `node`：节点信息探测与节点控制
- `instance`：游戏实例生命周期管理
- `cluster` / `shard`：DST 房间与世界配置
- `console`：控制台日志流、命令下发与维护公告
- `mod`：Steam 工坊 Mod 管理能力

## 占位模块（目录已建，尚未在 `app.ts` 注册）

- `config`：实例配置读写与校验
- `backup`：备份与恢复（数据库 `backups` 表已预留）
- `file`：实例目录文件管理与沙箱访问控制

## 组织建议

- 每个模块独立目录，避免跨模块直接访问内部实现。
- 模块内建议分层：`controller -> service/usecase -> domain -> repository`。
- 模块对外仅暴露 `index.ts` 注册入口（路由、依赖注入）。
