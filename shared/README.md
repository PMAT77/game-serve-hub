# Shared 目录说明

该目录用于前后端共享的契约与类型定义。

## 目录结构

- `contracts/`：接口请求/响应契约与校验规则
- `constants/`：共享常量与枚举
- `types/`：共享 TypeScript 类型

请保持该目录无运行时副作用，便于后续平滑迁移到 Monorepo 根目录复用。
