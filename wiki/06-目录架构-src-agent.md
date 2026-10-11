# 06 · 目录架构：`src/agent/`（独立 Agent 脚本）

> 这不是应用的一部分。`src/agent/` 是一个**独立运行的实验性 Agent CLI**：不进构建图、不进打包产物、不被任何模块 import。它存在的意义是提供一份「工具调用循环（Tool Use）」的可运行参考实现。

---

## 1. 文件清单

| 文件 | 行数 | 角色 |
|---|---|---|
| [index.ts](./files/agent/index.ts.md) | 327 | Tool Use Agent 主体：OpenAI 客户端 + 5 个工具 + 对话循环 + CLI 交互 |
| [package.json](./files/agent/package.json.md) | 3 | 仅 `{"type": "module"}`，把该目录限定为 ESM 作用域 |

---

## 2. 与主工程的关系（最重要的一点）

| 维度 | 事实 |
|---|---|
| 构建 | `electron.vite.config.ts` 只有 `main` / `preload` / `renderer` 三段，**没有 agent 段**，它不参与任何 bundle |
| 打包 | `package.json` 的 `build.files` 白名单只含 `out/**`、`video-projects/**`、`README.md`、`node_modules/openai`、`node_modules/opencc-js`，`src/agent` 不在其中 |
| 引用 | 全仓无任何模块 `import` 它；它也不 import 工程内其它文件（只依赖 `openai` 与 Node 内置模块） |
| 类型检查 | 由 `tsconfig.agent.json` 单独覆盖（`include: src/agent/**/*.ts`，`noEmit: true`），与主工程的三份配置分开管理 |
| 模块体系 | 根 `package.json` 刻意不声明 `"type": "module"`（主进程/preload 需 CJS）；本目录用**目录级** `package.json` 单独声明 ESM，二者互不影响 |

> 注意区别：**应用内**负责生成/修改 HTML 的 Agent 是 `src/main/htmlAgent.ts`（经 `project:generate-html` 调用、写入项目 `index.html`）；`src/agent/index.ts` 是通用编码 Agent 样例，与应用 UI 完全无关。

---

## 3. 运行方式

三种方式（源码头注释给出）：

```bash
# 1) Node 22.6+ 原生类型擦除，免编译直跑
set OPENAI_API_KEY=sk-xxx
set OPENAI_BASE_URL=https://api.openai.com/v1   # 或任意 OpenAI 兼容端点
set MODEL_ID=gpt-4o-mini
node --experimental-strip-types src/agent/index.ts

# 2) tsx
npx tsx src/agent/index.ts

# 3) 编译后运行
npx tsc && node dist/agent/index.js
```

环境变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `MY_AGENT_WORKDIR` | `process.cwd()` | 工作区根目录，所有工具只允许在该目录内活动 |
| `OPENAI_API_KEY` | 空（缺失即报错退出） | API Key |
| `OPENAI_BASE_URL` | `undefined`（SDK 默认） | 兼容任意 OpenAI 协议端点 |
| `MODEL_ID` | `gpt-4o-mini` | 模型 ID |

> 方式 3 的现实约束：`tsconfig.agent.json` 是 `noEmit: true`，若要 `tsc` 产出 JS 需另用允许 emit 的配置（或改为 `--noEmit false --outDir dist`）。

---

## 4. 结构

### 4.1 导出面

| 导出 | 说明 |
|---|---|
| `WORKDIR` / `API_KEY` / `BASE_URL` / `MODEL` / `SYSTEM` | 运行期常量（工作区、凭证、模型、系统提示词） |
| `createClient()` | 构造 `OpenAI` 客户端；无 Key 抛中文错误 |
| `TOOLS` | 5 个工具的 function-calling schema |
| `safePath(p)` | 工作区逃逸防护：`path.resolve` 后必须落在 `WORKDIR` 内 |
| `TOOL_HANDLERS` | 工具名 → 处理函数映射 |
| `agentLoop(client, messages, options)` | 多轮工具调用循环，返回最终文本或 `null` |
| `AgentLoopOptions` | `{ onTool?, system?, model?, maxTokens? }` |

### 4.2 五个工具

| 工具 | 参数 | 行为 |
|---|---|---|
| `bash` | `command` | 在工作区内执行 shell 命令（超时 120s、输出截断 50000 字符）；命中危险命令黑名单（`rm -rf /`、`sudo `、`shutdown`、`reboot`、`> /dev/`）直接拒绝 |
| `read_file` | `path`、`limit?` | 读取文件，`limit` 行之后以 `... (N more lines)` 省略 |
| `write_file` | `path`、`content` | 自动创建父目录后整文件写入，返回写入字节数 |
| `edit_file` | `path`、`old_text`、`new_text` | 精确替换**一次**；未命中返回 `Error: text not found` |
| `glob` | `pattern` | 递归枚举工作区，把 `**` / `*` 转成正则匹配（`**` 匹配任意层级，`*` 不跨 `/`） |

所有工具的错误都转成字符串返回给模型（不抛异常中断循环），保证 Agent 能自我纠错。

### 4.3 循环与入口

- `agentLoop()`：每轮以 `[system, ...messages]` + `tools` 发起请求；若返回 `tool_calls`，逐个执行并把结果以 `role: 'tool'` 追加，继续下一轮；否则返回 `content`。`maxTokens` 默认 16000，`onTool` 回调用于打印工具名与输出摘要。
- `isMain()`：比较 `process.argv[1]` 与 `import.meta.url`，只有直接以脚本方式运行时才启动交互 CLI；被 `import` 时不会误启动 REPL（`-e` / stdin 模式也会正确判定为非直接运行）。
- CLI：`readline` 循环，输入 `q` / `exit` 退出，历史消息在会话内累积。

---

## 5. 注意事项

1. **不要把它接进构建图**：一旦被 main/renderer `import`，`openai` 之外的 Node 内置能力（`child_process` 任意命令执行）就会进入应用运行栈，属于安全回退。
2. **`safePath` 是唯一防线**：`bash` 工具本身可执行任意命令，工作区约束只能靠黑名单与人工使用纪律，切勿在不受信环境运行。
3. **该脚本的写法前提**：语法保持 erasable-only（不使用 `enum`、构造函数参数属性等需要运行时转换的特性），与 `src/main/vad.ts` 的约束同源。
4. **它用的是 `openai` 包**：与应用共用同一个依赖版本，但客户端配置（`baseURL` / `MODEL_ID`）来自环境变量，与应用内 `settings.json` 的配置**互不相通**。

---

## 6. 相关文档

- 逐文件说明：[files/agent/](./files/agent/)
- 应用内的 HTML Agent（不同东西）：[files/main/htmlAgent.ts.md](./files/main/htmlAgent.ts.md)
