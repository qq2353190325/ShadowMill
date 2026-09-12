#!/usr/bin/env node
/**
 * s02: Tool Use —— Agent 工具循环（TypeScript + OpenAI SDK）
 * ==================================================================
 * 由原 Python 示例（Anthropic SDK）改写而来：
 *   - 语言：TypeScript（ESM）
 *   - SDK ：openai —— OpenAI 官方 Node SDK（兼容任意 OpenAI 兼容端点）
 * ==================================================================
 * 运行方式（任选其一）：
 *   npm i openai
 *   # 1) Node 22.6+ 自带 TypeScript 类型擦除，免编译直接运行
 *      set OPENAI_API_KEY=sk-xxx
 *      set OPENAI_BASE_URL=https://api.openai.com/v1   # 或任意 OpenAI 兼容端点
 *      set MODEL_ID=gpt-4o-mini
 *      node --experimental-strip-types src/agent/index.ts
 *   # 2) 或用 tsx 运行
 *      npx tsx src/agent/index.ts
 *   # 3) 或用 tsc 编译后运行
 *      npx tsc && node dist/agent/index.js
 * ==================================================================
 * 职责：在 WORKDIR 工作区内，与模型进行多轮对话，通过 5 个工具
 * （bash / read_file / write_file / edit_file / glob）持续解决任务。
 */
import { OpenAI } from 'openai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as readline from 'node:readline';
import { fileURLToPath } from 'node:url';

// 工作区根目录：默认当前目录，可用 MY_AGENT_WORKDIR 覆盖
export const WORKDIR = path.resolve(process.env.MY_AGENT_WORKDIR || process.cwd());

// 读取环境变量（OpenAI 兼容协议）
export const API_KEY = process.env.OPENAI_API_KEY || '';
export const BASE_URL = process.env.OPENAI_BASE_URL || undefined;
export const MODEL = process.env.MODEL_ID || 'gpt-4o-mini';

export const SYSTEM = `You are a coding agent at ${WORKDIR}. Use tools to solve tasks. Act, don't explain.`;

// ===== OpenAI 客户端（baseURL 可指向任意兼容端点） =====
export function createClient(): OpenAI {
  if (!API_KEY) {
    throw new Error('缺少 OPENAI_API_KEY 环境变量；可另设 OPENAI_BASE_URL / MODEL_ID');
  }
  return new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL });
}

// ===== 类型 =====
type ToolSchema = OpenAI.Chat.Completions.ChatCompletionTool;
type ToolHandler = (args: Record<string, unknown>) => string;

// ===== 工具定义（OpenAI function calling 格式） =====
export const TOOLS: ToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Run a shell command in the workspace.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'Shell command to run' } },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read file contents.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace' },
          limit: { type: 'integer', description: 'Max lines to read' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file, creating parent directories if needed.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace' },
          content: { type: 'string', description: 'Full file content' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Replace exact text in a file once.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace' },
          old_text: { type: 'string' },
          new_text: { type: 'string' },
        },
        required: ['path', 'old_text', 'new_text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'glob',
      description: 'Find files matching a glob pattern inside the workspace.',
      parameters: {
        type: 'object',
        properties: { pattern: { type: 'string', description: 'Glob pattern, e.g. **/*.md' } },
        required: ['pattern'],
      },
    },
  },
];

// ===== 路径安全校验：禁止逃逸出工作区 =====
export function safePath(p: string): string {
  const resolved = path.resolve(WORKDIR, p);
  const base = path.resolve(WORKDIR);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`Path escapes workspace: ${p}`);
  }
  return resolved;
}

// ===== 工具实现 =====
function runBash(args: Record<string, unknown>): string {
  const command = String(args.command ?? '');
  const dangerous = ['rm -rf /', 'sudo ', 'shutdown', 'reboot', '> /dev/'];
  if (dangerous.some((d) => command.includes(d))) return 'Error: Dangerous command blocked';
  try {
    const r = spawnSync(command, { shell: true, cwd: WORKDIR, encoding: 'utf8', timeout: 120_000 });
    const out = [r.stdout, r.stderr].filter(Boolean).join('').trim();
    return out ? out.slice(0, 50000) : '(no output)';
  } catch (e) {
    return `Error: ${(e as Error).message}`;
  }
}

function runRead(args: Record<string, unknown>): string {
  try {
    const p = safePath(String(args.path ?? ''));
    const limit = Math.max(0, Number(args.limit) || 0);
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    if (limit > 0 && limit < lines.length) {
      lines.splice(limit, lines.length - limit, `... (${lines.length - limit} more lines)`);
    }
    return lines.join('\n');
  } catch (e) {
    return `Error: ${(e as Error).message}`;
  }
}

function runWrite(args: Record<string, unknown>): string {
  try {
    const p = safePath(String(args.path ?? ''));
    const content = String(args.content ?? '');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf8');
    return `Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${p}`;
  } catch (e) {
    return `Error: ${(e as Error).message}`;
  }
}

function runEdit(args: Record<string, unknown>): string {
  try {
    const p = safePath(String(args.path ?? ''));
    const oldText = String(args.old_text ?? '');
    const newText = String(args.new_text ?? '');
    const text = fs.readFileSync(p, 'utf8');
    if (!text.includes(oldText)) return `Error: text not found in ${p}`;
    fs.writeFileSync(p, text.replace(oldText, newText), 'utf8');
    return `Edited ${p}`;
  } catch (e) {
    return `Error: ${(e as Error).message}`;
  }
}

function runGlob(args: Record<string, unknown>): string {
  try {
    const pattern = String(args.pattern ?? '');
    const results: string[] = [];
    const walk = (dir: string, base: string) => {
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const ent of entries) {
        const rel = base ? `${base}/${ent.name}` : ent.name;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) { results.push(rel + '/'); walk(full, rel); }
        else if (ent.isFile()) { results.push(rel); }
      }
    };
    walk(WORKDIR, '');
    // pattern（支持 ** 与 *）→ 正则
    const esc = (s: string) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const reSrc = '^' + pattern.split('/')
      .map((seg) => (seg === '**' ? '(?:.*)?' : esc(seg).replace(/\\\*/g, '[^/]*')))
      .join('/') + '$';
    const re = new RegExp(reSrc);
    const matches = results.filter((r) => re.test(r));
    return matches.length ? matches.join('\n') : '(no matches)';
  } catch (e) {
    return `Error: ${(e as Error).message}`;
  }
}

// ===== 工具分发映射 =====
export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  bash: runBash,
  read_file: runRead,
  write_file: runWrite,
  edit_file: runEdit,
  glob: runGlob,
};

// ===== Agent 循环：与模型多轮对话，直到不再需要工具 =====
export interface AgentLoopOptions {
  onTool?: (name: string, output: string) => void;
  system?: string;
  model?: string;
  maxTokens?: number;
}

export async function agentLoop(
  client: OpenAI,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  options: AgentLoopOptions = {},
): Promise<string | null> {
  const system = options.system ?? SYSTEM;
  const model = options.model ?? MODEL;
  const maxTokens = options.maxTokens ?? 16000;

  while (true) {
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: 'system', content: system }, ...messages],
      tools: TOOLS,
      max_tokens: maxTokens,
    });
    const msg = response.choices[0]?.message;
    if (!msg) return null;

    messages.push({
      role: 'assistant',
      content: msg.content,
      tool_calls: msg.tool_calls,
    } as OpenAI.Chat.Completions.ChatCompletionMessageParam);

    if (msg.tool_calls && msg.tool_calls.length) {
      for (const call of msg.tool_calls) {
        if (call.type !== 'function') continue;
        const name = call.function.name || '';
        let output: string;
        try {
          const args = call.function.arguments
            ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
            : {};
          const handler = TOOL_HANDLERS[name];
          output = handler ? handler(args) : `Unknown tool: ${name}`;
        } catch (e) {
          output = `Error: ${(e as Error).message}`;
        }
        if (options.onTool) options.onTool(name, output);
        messages.push({ role: 'tool', tool_call_id: call.id, content: output });
      }
    } else {
      return typeof msg.content === 'string' ? msg.content : null;
    }
  }
}

// ===== CLI 入口 =====
async function main(): Promise<void> {
  console.log(`[agent] workspace = ${WORKDIR}`);
  console.log(`[agent] model = ${MODEL} | base = ${BASE_URL ?? '(default)'}`);

  let client: OpenAI;
  try {
    client = createClient();
  } catch (e) {
    console.error((e as Error).message);
    console.error('用法：先设置环境变量 OPENAI_API_KEY（可选 OPENAI_BASE_URL / MODEL_ID），再运行本脚本。');
    process.exit(1);
  }

  console.log('输入问题，回车发送；输入 q / exit 退出。\n');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const history: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  const loop = (query: string): void => {
    const q = query.trim();
    if (!q || q.toLowerCase() === 'q' || q.toLowerCase() === 'exit') { rl.close(); return; }
    history.push({ role: 'user', content: q });
    agentLoop(client, history, {
      onTool: (name, output) => {
        console.log(`\x1b[33m> ${name}\x1b[0m`);
        console.log(String(output).slice(0, 200));
      },
    })
      .then((reply) => {
        if (reply) console.log(reply);
      })
      .catch((e) => console.error('Agent 调用失败：', (e as Error).message))
      .finally(() => rl.question('s02 >> ', loop));
  };

  rl.question('s02 >> ', loop);
}

// 仅作为脚本直接运行时才启动 CLI（便于被其他模块 import 复用，
// 例如被主进程或 Node -e 动态导入时不会误启动交互循环）
function isMain(): boolean {
  try {
    const first = process.argv[1];
    if (!first) return false; // -e / stdin / import 模式不是脚本直接运行
    return path.resolve(first) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) {
  void main();
}
