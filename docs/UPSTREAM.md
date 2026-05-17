# 与 Fantastic-admin 上游同步

本目录为 **独立 pnpm 工作区**（`apps/game-server-hub-standalone`），内嵌 FA 框架子包，不依赖母 monorepo 的 `packages/*` 与根 `uno.config.ts`。

## 建议同步范围

| 路径 | 说明 |
|------|------|
| `packages/components` | Fa* 组件与 resolver |
| `packages/settings` | 框架设置 API |
| `packages/types` | 路由/菜单类型 |
| `packages/themes` | OKLCH 主题 token |
| `packages/copyright` | Vite 构建版权插件 |
| `uno.config.ts` | UnoCSS 主题与快捷类（全文替换，勿 re-export 上级） |

## 同步步骤（从 fantastic-admin 母仓）

1. 在母仓更新对应 `packages/*` 或根 `uno.config.ts`。
2. 将变更 **整目录覆盖** 到本副本对应路径（保留本仓 `package.json` / `pnpm-workspace.yaml` 除非 catalog 键有新增）。
3. 若新增 `catalog:` 依赖：
   - 校验：`node scripts/generate-catalog.mjs`
   - 从母仓带入版本并写回：`node scripts/generate-catalog.mjs --write --import ../fantastic-admin/pnpm-workspace.yaml`（将路径改为你本机的母仓位置）
   - 然后执行 `pnpm install`
4. 执行 `pnpm run lint`、`pnpm build`；必要时 `pnpm dev` 做 UI 对照。

## 业务代码

Game Server Hub 业务（`src/`、`server/`、`shared/`）优先在母仓 `apps/game-server-hub` 开发，验证后 cherry-pick 或合并到本副本。详见 [MIGRATION.md](../MIGRATION.md)。
