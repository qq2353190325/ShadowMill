# src/agent/index.ts

> 独立于应用打包图的实验性 CLI Agent（Node 直接运行，不进构建）

- **所在目录**：`src/agent/`
- **类型**：独立实验脚本（ESM / TypeScript，CLI 入口）
- **规模**：336 行
- **对外导出**：`WORKDIR`、`API_KEY`、`BASE_URL`、`MODEL`、`SYSTEM`、`createClient()`、`TOOLS`、`safePath()`、`TOOL_HANDLERS`、`AgentLoopOptions`（interface）、`agentLoop()`

## 1. 作用与职责

本文件是一个**与 Electron 应用完全无关**的命令行 Agent 示例（文件头注释标记为 `s02: Tool Use`），由原 Python 示例（Anthropic SDK）改写为 TypeScript + OpenAI 官方 Node SDK。

它解决的问题是：在 `WORKDIR` 工作区内与模型进行多轮对话，由模型自主决定调用 5 个工具（`bash` / `read_file` / `write_file` / `edit_file` / `glob`）持续完成任务，直到模型不再请求工具为止。

关键定位：**它是独立实验脚本，不属于应用的打包图**。

- `electron.vite.config.ts` 只配置 `main` / `preload` / `renderer` 三段，入口分别是 `src/main/index.ts` 等默认路径，**不包含 `src/agent/`**。
- `src/` 下无任何模块 `import` 本文件（已核查：全仓仅本文件自身出现 `agent/index` 字样）。
- 它只被 `tsconfig.agent.json`（`include: ["src/agent/**/*.ts"]`，`noEmit: true`）纳入类型检查，`npm run typecheck` 的第三段会校验它。
- 它是 `openai` 依赖的实际使用者之一，`package.json` 的 `dependencies` 含 `"openai": "^7.15.0"`，且 electron-builder 的 `files` 白名单显式包含 `node_modules/openai/**/*`。

## 2. 导出与关键实现

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `WORKDIR` | `string`（const） | `path.resolve(process.env.MY_AGENT_WORKDIR \|\| process.cwd())`，工作区根目录 |
| `API_KEY` | `string`（const） | `process.env.OPENAI_API_KEY \|\| ''` |
| `BASE_URL` | `string \| undefined`（const） | `process.env.OPENAI_BASE_URL \|\| undefined`，未设则由 SDK 用官方默认 |
| `MODEL` | `string`（const） | `process.env.MODEL_ID \|\| 'gpt-4o-mini'` |
| `SYSTEM` | `string`（const） | 系统提示词：`You are a coding agent at ${WORKDIR}. Use tools to solve tasks. Act, don't explain.` |
| `createClient` | `function` | 返回 `OpenAI` 实例；`API_KEY` 为空时抛错 |
| `TOOLS` | `ToolSchema[]`（const） | 5 个工具的 OpenAI function calling schema |
| `safePath` | `function` | 路径校验，禁止逃逸出工作区；非法时抛 `Path escapes workspace: ${p}` |
| `TOOL_HANDLERS` | `Record<string, ToolHandler>` | 工具名 → 同步实现函数的分发表 |
| `AgentLoopOptions` | `interface` | `{ onTool?, system?, model?, maxTokens? }` |
| `agentLoop` | `async function` | 对话 + 工具调用循环，返回最终文本或 `null` |
| `ToolSchema` | `type`（内部，未导出） | `OpenAI.Chat.Completions.ChatCompletionTool` 别名 |
| `ToolHandler` | `type`（内部，未导出） | `(args: Record<string, unknown>) => string` |

### 2.1 环境变量

| 变量 | 必需 | 默认 | 说明 |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | ✅ | 无（空串） | 缺失时 `createClient()` 抛 `缺少 OPENAI_API_KEY 环境变量；可另设 OPENAI_BASE_URL / MODEL_ID`，`main()` 捕获后打印用法并 `process.exit(1)` |
| `OPENAI_BASE_URL` | ❌ | `undefined` | 任意 OpenAI 兼容端点（如 `https://api.openai.com/v1`） |
| `MODEL_ID` | ❌ | `gpt-4o-mini` | 模型标识 |
| `MY_AGENT_WORKDIR` | ❌ | `process.cwd()` | 工作区根目录（注意：文件头注释写的是 `WORKDIR` 语义，实际变量名是 `MY_AGENT_WORKDIR`） |

### 2.2 5 个工具的 schema

| 工具名 | description | 参数 | 必填 |
| --- | --- | --- | --- |
| `bash` | `Run a shell command in the workspace.` | `command: string`（Shell command to run） | `['command']` |
| `read_file` | `Read file contents.` | `path: string`（File path relative to workspace）、`limit: integer`（Max lines to read） | `['path']` |
| `write_file` | `Write content to a file, creating parent directories if needed.` | `path: string`、`content: string`（Full file content） | `['path', 'content']` |
| `edit_file` | `Replace exact text in a file once.` | `path: string`、`old_text: string`、`new_text: string` | `['path', 'old_text', 'new_text']` |
| `glob` | `Find files matching a glob pattern inside the workspace.` | `pattern: string`（Glob pattern, e.g. `**/*.md`） | `['pattern']` |

所有条目均为 `{ type: 'function', function: { name, description, parameters } }` 结构，`parameters.type` 统一为 `'object'`。

### 2.3 5 个工具的实现

| 工具 | 实现函数 | 关键行为 |
| --- | --- | --- |
| `bash` | `runBash` | 危险命令黑名单拦截；`spawnSync(command, { shell: true, cwd: WORKDIR, encoding: 'utf8', timeout: 120_000 })`；stdout+stderr 合并去空白；空输出返回 `(no output)`；输出截断到 50000 字符；异常返回 `Error: ...` |
| `read_file` | `runRead` | 经 `safePath` 解析；`limit > 0 && limit < 行数` 时把多余行替换为 `... (N more lines)` 占位行；按 `/\r?\n/` 切分后重连 |
| `write_file` | `runWrite` | 经 `safePath`；`mkdirSync(dirname, { recursive: true })` 自动建父目录；写后返回 `Wrote N bytes to <abs>`（N 由 `Buffer.byteLength(content,'utf8')` 计算） |
| `edit_file` | `runEdit` | 经 `safePath`；`text.includes(oldText)` 为假时返回 `Error: text not found in <abs>`；否则 `text.replace(oldText, newText)` **只替换第一处**（字符串字面量参数，非全局正则）；成功返回 `Edited <abs>` |
| `glob` | `runGlob` | 递归遍历整个 `WORKDIR`（目录项以 `/` 结尾）；把 pattern 编译为正则：`**` 段 → `(?:.*)?`，其余段转义后 `*` → `[^/]*`；无匹配返回 `(no matches)` |

### 2.4 agentLoop 与 AgentLoopOptions

| 成员 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `onTool` | `(name: string, output: string) => void` | 无 | 每执行完一个工具即回调，用于打印进度 |
| `system` | `string` | `SYSTEM` | 覆盖系统提示词 |
| `model` | `string` | `MODEL` | 覆盖模型 |
| `maxTokens` | `number` | `16000` | 传给 `max_tokens` |

## 3. 关键流程或结构

### 3.1 agentLoop 的工具调用循环

```
agentLoop(client, messages, options)
   └─ while (true)
        1. client.chat.completions.create({
             model, messages: [{role:'system',content:system}, ...messages],
             tools: TOOLS, max_tokens: maxTokens })
        2. msg = response.choices[0]?.message；为空 → return null
        3. 把 assistant 消息（content + tool_calls）push 进 messages
        4. 若 msg.tool_calls 非空：
             for each call：
               - 跳过 call.type !== 'function'
               - JSON.parse(call.function.arguments)（空串则 {}）
               - 查 TOOL_HANDLERS[name]，未命中返回 `Unknown tool: ${name}`
               - 解析异常 → `Error: ${message}`
               - options.onTool?.(name, output)
               - push { role:'tool', tool_call_id: call.id, content: output }
             继续下一轮 while
        5. 若无 tool_calls：return typeof msg.content === 'string' ? msg.content : null
```

要点：

- **messages 数组由调用方持有并被原地修改**（`push`），因此 CLI 中的 `history` 天然累积多轮上下文。
- **循环没有最大轮次限制**，只在"模型不再请求工具"或返回空 message 时退出。
- 工具实现全部是**同步**函数，异常一律被 `try/catch` 转成 `Error: ...` 字符串返回给模型，不会中断循环。
- 系统消息每轮都重新拼在最前（`[{role:'system'}, ...messages]`），而不是写进 `messages`，因此 `history` 中只有 user / assistant / tool 三类消息。

### 3.2 safePath 工作区逃逸防护

```
resolved = path.resolve(WORKDIR, p)
base     = path.resolve(WORKDIR)
若 resolved !== base 且 !resolved.startsWith(base + path.sep) → throw
```

- 先 `resolve` 归一化，因此 `..`、混合分隔符、绝对路径都会被还原后再判断。
- 允许 `resolved === base`（即工作区根目录自身）。
- 用 `base + path.sep` 前缀判断，避免 `/work` 与 `/workspace` 这类"前缀相同但其实是兄弟目录"的误判。
- `bash` 与 `glob` **不经过** `safePath`：`bash` 的 `cwd` 被限制在 `WORKDIR` 但命令本身可任意访问文件系统；`glob` 只遍历 `WORKDIR` 内部。

### 3.3 危险命令黑名单

`runBash` 中的黑名单数组为：

```ts
const dangerous = ['rm -rf /', 'sudo ', 'shutdown', 'reboot', '> /dev/'];
```

- 判定方式为 `dangerous.some((d) => command.includes(d))` —— **纯子串匹配**，命中即返回 `'Error: Dangerous command blocked'`，不执行命令。
- 这是**最低限度的护栏**，不是安全沙箱：大小写、变量拼接、等价命令都能绕过；真正的隔离依赖运行环境，不要把它当作安全边界。

### 3.4 isMain() 直接运行判定

```ts
function isMain(): boolean {
  const first = process.argv[1];
  if (!first) return false;          // -e / stdin / import 模式不是脚本直接运行
  return path.resolve(first) === fileURLToPath(import.meta.url);
}
```

- 用 `process.argv[1]`（Node 实际执行的脚本路径）与 `import.meta.url` 转换后的文件路径比较，判断"是否被直接运行"。
- 置于 `try/catch` 内，异常时返回 `false`；`process.argv[1]` 缺失（`node -e`、stdin、被 import）时也返回 `false`。
- 效果：`if (isMain()) { void main(); }` —— 被其他模块 import 或动态导入时**不会误启动交互循环**，导出项（`agentLoop`、`TOOLS`、`safePath` 等）可被复用。
- 注意本文件使用 **ESM** 的 `import.meta.url`，因此必须按 ESM 解析（见同目录 `package.json` 的说明）。

### 3.5 main() 交互流程

1. 打印 `[agent] workspace = ...` 与 `[agent] model = ... | base = ...`（`BASE_URL` 为空时显示 `(default)`）。
2. `createClient()`；抛错则打印错误与用法提示后 `process.exit(1)`。
3. 打印"输入问题，回车发送；输入 q / exit 退出。"。
4. `readline.createInterface` 建立 stdin/stdout 交互；`history` 数组持有会话。
5. `loop(query)`：空串或 `q` / `exit`（小写比较）则 `rl.close()`；否则 push user 消息 → `agentLoop(...)`，`onTool` 以黄色 `\x1b[33m> ${name}\x1b[0m` 打印工具名并截取前 200 字符输出；`.then` 打印回复，`.catch` 打印 `Agent 调用失败：`，`.finally` 再问 `s02 >> `。
6. 首次 `rl.question('s02 >> ', loop)` 启动循环（递归续问）。

### 3.6 三种运行方式（文件头注释给出）

| 方式 | 命令 | 说明 |
| --- | --- | --- |
| Node 22.6+ 类型擦除 | `set OPENAI_API_KEY=sk-xxx` + `set OPENAI_BASE_URL=...` + `set MODEL_ID=gpt-4o-mini` + `node --experimental-strip-types src/agent/index.ts` | 免编译直接运行；配合 ESM 的 `package.json` |
| tsx | `npx tsx src/agent/index.ts` | 需要先 `npm i openai` |
| tsc 编译后运行 | `npx tsc && node dist/agent/index.js` | 常规编译路径（注意：项目 `tsconfig.agent.json` 为 `noEmit: true`，走此方式需另用支持 emit 的配置） |

## 4. 依赖与协作

| 方向 | 对象 | 说明 |
| --- | --- | --- |
| 依赖 | `openai` | `import { OpenAI } from 'openai'`，`dependencies` 中为 `^7.15.0` |
| 依赖 | `node:fs` | `readFileSync` / `writeFileSync` / `mkdirSync` / `readdirSync` |
| 依赖 | `node:path` | `resolve` / `dirname` / `join` / `sep` |
| 依赖 | `node:child_process` | `spawnSync` |
| 依赖 | `node:readline` | `createInterface` |
| 依赖 | `node:url` | `fileURLToPath` |
| 被 include | `tsconfig.agent.json` | `include: ["src/agent/**/*.ts"]`，`noEmit: true`，`types: ["node"]` |
| 被检查 | `npm run typecheck` 第三段 | `tsc --noEmit -p tsconfig.agent.json` |
| **不**被引用 | `electron.vite.config.ts` / `src/main/**` / `src/renderer/**` | 不在打包入口图中 |

## 5. 注意事项与实现要点

- **不进构建**：不要把它 import 进 `src/main/`，否则它的顶层 `import`（`node:readline` 等）与 `isMain()` 语义会进入应用运行时；它只应作为独立脚本或库被外部调用。
- **`agentLoop` 会原地修改传入的 `messages`**：若要复用同一历史做分支对话，需先自行浅/深拷贝。
- **无最大轮次保护**：模型若持续请求工具，循环不会自行终止；生产使用建议加计数器。
- **同步工具阻塞**：5 个 handler 均为同步（`spawnSync` / `readFileSync`），`bash` 超时上限 120 秒，期间事件循环被阻塞。
- **输出截断**：`bash` 输出截断到 50000 字符，`read_file` 用 `limit` 截断，`glob` 结果不截断（大仓库下可能返回很长列表）。
- **`edit_file` 只替换第一处**：`String.prototype.replace` 传字符串参数时只替换首个匹配，且 `old_text` 为空串时 `includes('')` 恒为真、`replace('', newText)` 会在开头插入。
- **黑名单可绕过**：`runBash` 的子串黑名单只是防误操作，不是安全机制。
- **`glob` 是自实现匹配**：不是标准 glob 库，只支持 `**`（整段通配）与 `*`（段内非 `/` 通配），不支持 `?`、`{a,b}`、字符类等语法；目录在结果中以 `/` 结尾。
- **环境变量名易混**：工作区变量是 `MY_AGENT_WORKDIR`（非 `WORKDIR`）；文件头的示例使用 `set`（Windows 语法），在类 Unix 下需改为 `export`。
- **`createClient()` 允许无 `BASE_URL`**：此时交由 SDK 使用官方默认端点；若使用第三方兼容端点务必设置 `OPENAI_BASE_URL`。
