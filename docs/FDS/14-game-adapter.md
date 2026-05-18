# FDS-14：游戏适配器框架

- **里程碑**：M0/M1 框架，v1.x 第二游戏  
- **优先级**：P0（框架）  
- **状态**：仅 DST 硬编码分支

## 1. 背景与目标

用统一接口隔离「面板通用能力」与「各游戏差异」，v1 仅实现 DST，后续泰拉瑞亚等以新 adapter 注册方式接入。

## 2. 适配器接口（规划）

```typescript
interface GameAdapter {
  readonly gameCode: string
  readonly displayName: string
  readonly steamAppId: string

  validateInstallPath(path: string): string | undefined
  install(ctx: InstallContext): Promise<void>
  ensureDefaultLayout(ctx: InstanceContext): Promise<void>

  buildShardContainers(ctx: InstanceContext): ShardContainerSpec[]
  getConsolePresets(): ConsolePreset[]

  getBackupPaths(ctx: InstanceContext): string[]
  getModPaths?(ctx: InstanceContext): ModPaths
}
```

注册表：`registerGameAdapter(adapter)`，`getAdapter(gameCode)`。

## 3. DST 实现要点（v1）

| 职责 | 实现位置（规划） |
|------|----------------|
| SteamCMD 343050 | `infra/game-adapter/dst/install.ts` |
| Cluster/Shard 初始化 | 自 `ensureDstClusterConfig` 迁移 |
| 启动参数 | `-cluster`、`-shard`、`-console` |
| 控制台预设 | FDS-09 表 |
| 备份范围 | Cluster 根目录 |

## 4. 与实例模块协作

```text
instance.create → getAdapter(gameCode).install
instance.start  → runtime.start(adapter.buildShardContainers(...))
mod.install     → adapter.getModPaths
backup.create   → adapter.getBackupPaths
```

## 5. 可安装游戏列表

`GET /app/instance/games` 返回注册表中游戏元数据（封面、简介、appId），v1 数组长度 1。

## 6. 验收标准

- [ ] 新增 mock adapter 可在不改编核心的情况下注册（开发自测）。  
- [ ] DST 行为与迁移前一致（M0 后容器态）。  
- [ ] 文档列出添加新游戏检查清单。

## 7. 添加新游戏检查清单（v1.x）

- [ ] 实现 `GameAdapter`  
- [ ] Steam AppID 与安装脚本  
- [ ] FDS 房间/世界等价物（若有）  
- [ ] 控制台命令表  
- [ ] ACCEPTANCE 场景扩展  
- [ ] `app.fake.ts` 游戏市场卡片

## 8. 不在 v1 范围

- 热加载 adapter 插件（无需动态 so，npm 注册即可）  
- 非 Steam 游戏

## 9. 依赖

- [FDS-00](00-install-runtime.md)  
- [DOMAIN.md](../DOMAIN.md) gameCode 约定

---

*当前代码：`server/src/modules/instance/index.ts` 内 `gameCode === '343050'` 分支*
