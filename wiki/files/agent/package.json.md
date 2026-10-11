# src/agent/package.json

> 仅声明 type:module，使 src/agent 目录内文件按 ESM 解析

- **所在目录**：`src/agent/`
- **类型**：目录级 ESM 标记（package.json 片段）
- **规模**：3 行
- **对外导出**：无（配置文件，不被 import）；内容为 `{"type":"module"}`，无 `name` / `version` / `dependencies` / `scripts`

## 1. 作用与职责

本文件是整个仓库中**最小的 package.json**，只包含一个字段：

```json
{
  "type": "module"
}
```

它的唯一职责是**就近设定 Node 的模块解析模式**。依据 Node 的"最近 package.json 优先"规则，凡是位于 `src/agent/` 目录（及其子目录）下的 `.js` 文件，一律按 **ESM**（`import` / `export` / `import.meta.url`）解析，而不是按默认的 CommonJS 解析。

由此支撑 `src/agent/index.ts` 中的两处强依赖 ESM 的写法：

| 写法 | 位置 | 为何需要 ESM |
| --- | --- | --- |
| `import.meta.url` | `isMain()` 函数中 | `import.meta` 只在 ESM 中可用；CJS 下必须改用 `__filename` |
| 顶层 `import { ... } from 'node:fs'` 等 | 文件开头 | 与 `--experimental-strip-types` / `tsx` 直接运行 `.ts` 的场景配合 |

## 2. 导出与关键实现

| 字段 | 值 | 说明 |
| --- | --- | --- |
| `type` | `"module"` | 该目录内 `.js`（及经类型擦除运行的 `.ts`）按 ESM 解析 |
| 其他字段 | 无 | 无 `name`、`version`、`private`、`dependencies`、`scripts` 等 |

作为对照，仓库根目录 `E:\my\package.json` **没有** `"type"` 字段，因此根部默认按 CommonJS 解析 —— 这正是 `src/preload/index.ts` 必须编译为 CJS 的前提（sandboxed preload 不支持 ESM）。

## 3. 关键流程或结构

### 3.1 目录级作用域示意

```
E:\my\package.json              （无 "type" → 默认 CJS，Electron 主进程/preload 产物）
├── src/main/*.ts               → CJS 语义（electron-vite 打包）
├── src/preload/*.ts            → CJS 语义（sandboxed preload 要求）
├── src/renderer/**             → 由 Vite 处理，与 Node 解析无关
└── src/agent/
    ├── package.json            ← 本文件：{"type":"module"}
    └── index.ts                → ESM 语义（import.meta.url 可用）
```

### 3.2 与构建/检查的关系

| 环节 | 是否涉及本文件 | 说明 |
| --- | --- | --- |
| `electron.vite.config.ts` | 否 | 只配置 main / preload / renderer 三段，无 agent 段 |
| `npm run build` / `pack` / `dist` | 否 | agent 目录不在打包入口图中 |
| `npm run typecheck` | 间接 | 第三段 `tsc --noEmit -p tsconfig.agent.json` 检查 `src/agent/**/*.ts`，其 `module: "ESNext"` 与本文件的 ESM 设定一致 |
| 直接运行 | 是 | `node --experimental-strip-types src/agent/index.ts`、`npx tsx src/agent/index.ts` 等依赖 ESM 解析 |

### 3.3 为什么不用根 package.json 声明

在根 `E:\my\package.json` 中加 `"type": "module"` 是**不可行**的做法：

| 方式 | 影响范围 | 结论 |
| --- | --- | --- |
| 根声明 `"type":"module"` | 全仓所有 `.js` 产物（含 Electron 主进程 / preload 的 out 产物） | ❌ sandboxed preload 必须是 CJS，会直接加载失败 |
| `src/agent/package.json` 就近声明 | 仅 `src/agent/` 目录 | ✅ 实验脚本用 ESM，主工程保持 CJS |

因此本文件是"在一个 CJS 主工程里为单个子目录开启 ESM"的标准做法，代价极低、隔离彻底。

## 4. 依赖与协作

| 方向 | 对象 | 说明 |
| --- | --- | --- |
| 依赖 | 无 | 配置片段，不声明任何依赖 |
| 影响 | `src/agent/index.ts` | 决定其按 ESM 解析，`import.meta.url` 与顶层 `import` 因此合法 |
| 配合 | `tsconfig.agent.json` | `module: "ESNext"` + `include: ["src/agent/**/*.ts"]`，类型检查侧保持一致的模块语义 |
| 隔离 | 根 `E:\my\package.json` | 根为 CJS，两套模块系统互不影响；`openai` 依赖在根部 `dependencies` 中声明并由根 `node_modules` 提供 |

## 5. 注意事项与实现要点

- **最小化是刻意的**：只写 `type` 可避免意外引入依赖、脚本或影响其他工具的目录扫描；不要为"完整"而补充 `name` / `version`。
- **作用域仅限本目录**：它不会改变 `src/main/`、`src/preload/` 的 CJS 语义，也不影响 Electron 产物。
- **不可删除**：删除后 Node 会回退到根 `package.json`（无 `type`）按 CJS 解析，`src/agent/index.ts` 中的 `import.meta.url` 将直接报错（`import.meta` 仅在 ESM 中可用）。
- **`.ts` 的类型擦除运行依赖 Node 22.6+**：`node --experimental-strip-types` 属于较新能力，旧版 Node 请改用 `tsx` 或先编译。
- **不进打包 `files`**：electron-builder 的 `files` 只列 `out/**/*`、`vendor/**/*`、`README.md` 与三条 `!node_modules/...` 排除项（`node_modules` 下其余内容由打包器按 `dependencies` 自动收集），`src/agent/` 不在其中，不会被分发。
- **与 `tsconfig.agent.json` 的 `noEmit: true` 配合**：类型检查不产出文件；文件头注释里的 `npx tsc && node dist/agent/index.js` 方式需另用允许 emit 的配置。
