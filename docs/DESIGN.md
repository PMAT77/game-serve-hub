# Game Server Hub 设计系统

## 1. 目标与范围

本设计系统用于统一 `game-server-hub` 的视觉语言，覆盖：

- 颜色体系（Light / Dark 双主题）
- 排版层级
- 间距与尺寸节奏
- 圆角、边框、阴影
- 页面布局尺寸与断点策略
- 核心组件的视觉约束（按钮、卡片、输入、导航、状态）

该系统基于当前应用已落地实现抽取而来，优先兼容现有 `UnoCSS + shadcn token + Fa* 组件` 体系，避免大规模重构。

## 2. 现状观察（基于代码）

### 2.1 主题与色彩

- 主题已采用 `OKLCH`，并通过 `packages/themes/index.ts` 暴露 Light / Dark 变量。
- UnoCSS 配置为副本根目录自包含 [uno.config.ts](../uno.config.ts)（内嵌 `packages/themes`），已将 token 映射为语义色：`background / foreground / primary / secondary / muted / accent / destructive / border / input / ring`。
- 布局级 token 已存在：`--g-header-*`、`--g-main-sidebar-*`、`--g-sub-sidebar-*`、`--g-tabbar-*`、`--g-toolbar-bg`。
- 少量业务组件仍有硬编码色值（例如网络图中的 `#94a3b8`、状态颜色 `#10b981 #f59e0b #f97316 #ef4444`）。

### 2.2 排版与节奏

- 主要使用 UnoCSS 原子类，常见字号为 `text-xs / text-sm / text-base`。
- 常见间距落在 `p-3 / p-4 / p-5 / p-6 / p-12`，布局 gap 常见 `gap-2 / gap-3 / gap-4`。
- 当前全局变量提供了布局尺寸（顶部/侧边栏/标签栏），但缺少集中式 spacing token 文档。

### 2.3 形状与层级

- 圆角以 `rounded-lg / rounded-xl / rounded-full` 为主。
- 主题支持可配置圆角 `--radius`（0~1rem）。
- 阴影使用较克制，主要用于浮层或固定区域分隔（边界线阴影替代传统边框）。

## 3. 竞品启发（用于约束决策）

参考了 TailAdmin、AdminLTE 4、CoreUI 的公开设计系统资料，得到三条约束：

1. **Token first**：优先以语义 token 驱动组件，而不是直接写十六进制。
2. **Light/Dark parity**：暗色模式与亮色模式必须同等完整，避免“半暗黑”。
3. **Density control**：后台系统强调信息密度，视觉层级应“克制但明确”。

## 4. 设计决策

### 4.1 颜色系统

- 保留现有 OKLCH token 作为底层色彩标准。
- 追加业务状态语义色（success / warning / danger / info），用于图表与状态标签，统一替换硬编码色值。
- 定义图表轴线与辅助文字语义色（例如 `chart.axis` 对齐 `muted-foreground`）。

### 4.2 排版系统

- 字号分层：`xs(12) / sm(14) / base(16) / lg(18) / xl(20) / 2xl(24) / 3xl(30)`。
- 正文默认 `base`，表单和说明文本优先 `sm`，辅助信息用 `xs`。
- 行高采用 1.4~1.6，标题与数字卡片可降低到 1.2~1.3。

### 4.3 间距系统

- 采用 4px 基准网格（4 的倍数）。
- 常用映射：
  - `2 => 8px`（紧凑控件间距）
  - `3 => 12px`（卡片内二级间距）
  - `4 => 16px`（默认区块间距）
  - `5 => 20px`（大卡片内边距）
  - `6 => 24px`（模块级间距）
  - `12 => 48px`（登录/大表单外边距）

### 4.4 圆角与边框

- 全局基准圆角为 `--radius`，默认 `0.5rem`。
- 组件建议：
  - 输入框/按钮：`md`
  - 卡片/面板：`lg`
  - 悬浮按钮：`full`
- 边框色统一指向 `border` token，避免灰色硬编码。

### 4.5 阴影与层级

- 默认界面以“边框分层”为主，阴影仅用于浮层（弹窗、下拉、悬浮控件）。
- 建议阴影级别：`sm`（悬浮按钮）/ `md`（弹窗）/ `xl`（全局菜单浮层）。

## 5. 组件视觉规范（V1）

- **按钮 Button**
  - Primary: `bg-primary + text-primary-foreground`
  - Secondary: `bg-secondary + text-secondary-foreground`
  - Ghost/Link: 弱化背景，强调 hover 态
- **输入 Input**
  - 默认边框：`border`
  - 聚焦：`ring`
  - 错误：`destructive`
- **卡片 Card**
  - `bg-card + text-card-foreground + border`
  - 标准内边距建议 `p-4` 或 `p-5`
- **导航 Navigation**
  - 顶部、主侧边、次侧边均使用 `--g-*` 专属 token，不与业务页面样式混用
- **数据状态 Status**
  - 成功 / 警告 / 危险 / 信息色统一由 status token 提供

## 6. 落地文件

本次生成以下文件：

- `docs/design-tokens.json`：机器可读 token 源
- `docs/design-preview.html`：可独立打开的视觉预览页（自包含，无依赖）

## 7. 下一步建议（可选）

1. 将监控图表中的硬编码色值替换为 `status.*` 与 `chart.*` token。
2. 为 `FaButton`、`FaInput`、`FaCard` 增加 token 对应关系文档（组件库层）。
3. 在 CI 增加“硬编码颜色扫描”，限制新代码继续引入随机 hex 值。
