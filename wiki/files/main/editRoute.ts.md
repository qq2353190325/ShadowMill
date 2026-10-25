# src/main/editRoute.ts
> **⚠️ 本轮角色改造对本文件的影响（以本块为准）**
>
> 解析逻辑本身没变（`parseRouteReply(reply, allowed)`：`MAX_TARGETS = 6`、非法路径直接跳过、全无合法项则回退「发全部源码」），但**调用方传进来的 `allowed` 只剩章节**：`projects/chaptersFlow.ts` 的 `applyChapterEdit` 用 `cur.map(c => chapters.chapterRelPath(c.id))`，角色不在白名单里。源码里 `EditTargets.paths` 的注释仍写着 `pages/cNN.js` 或 `cast/<id>.js`（历史注记）——**现在路由结果里不会出现 `cast/*.js`**。

> 「按需求修改」第一段（**路由**）的纯逻辑：从模型回复里解析出「这次要改哪几个文件」，按项目里真实存在的文件做白名单过滤、去重、限 6 个；解析失败一律返回 `error`，由调用方回退成「发全部源码」

- **所在目录**：src/main/
- **类型**：纯逻辑模块（**不调用模型、不读文件、不注册 IPC**）
- **规模**：66 行（实测 `[IO.File]::ReadAllLines`）
- **对外导出**：`parseRouteReply` 1 个函数 + `EditTargets` 1 个类型

## 1. 作用与职责

「HTML生成」页 · 「按需求修改」在**章节模式**下分两段走：

1. **路由**：只发「章节大纲 + 角色表 + 用户的话」，让模型报这次要改哪几个文件（`<<<ROUTE>>> {"targets":[…],"restructure":bool,"reason":"…"} <<<END ROUTE>>>`，最多 6 个，只认项目里真实存在的 `pages/cNN.js` / `cast/<id>.js`）；
2. **定向编辑**：只读被点名的那几份源码（用 `<<<CURRENT 路径>>>` 包起来）连同大纲发给模型改。

**为什么分两段**：长片源码合计几百 KB（章节数 × 单章 30–70 KB + 角色 × 10–20 KB），一次全发会撞模型上下文上限。分两段后模型只看到它自己点名的一两份源码——用户说「把第 3 章改慢点」时就只发第 3 章。代价是多一次调用（路由调用输出很短、很便宜）。

本模块只回答**一个**问题：**这段回复说改哪几个文件、要不要改结构**。它不调模型、不读文件——`projects.ts` 的 `applyChapterEdit()` 负责发提示词、读源码、落盘。

## 2. 导出与关键实现

| 名称 | 签名 | 说明 |
| --- | --- | --- |
| `EditTargets` | `interface` | `{ paths: string[]; restructure: boolean; reason: string }`——`paths` 是**已过滤成 `allowed` 里的合法项**；`restructure` 表示这次要改结构（增删章节 / 增删角色 / 改时长），第二段就要求模型先交新表；`reason` 是给日志 / 文案用的原因（截到 200 字符） |
| `parseRouteReply(reply, allowed)` | `(reply: string, allowed: string[]) => { route: EditTargets \| null; error?: string }` | 解析路由回复；`allowed` = 当前项目里**存在**的文件（章节 + 角色）。返回 `route: null` 且带 `error` 时，调用方应回退成「发全部源码」 |

### 2.1 解析与过滤规则

| 环节 | 做法 |
| --- | --- |
| 找 JSON | 依次试 `<<<ROUTE>>> … <<<END ROUTE>>>` 块、Markdown 的 JSON 围栏、整段原文，取第一个能解析成对象的 |
| 没有 JSON | 返回 `{ route: null, error: '路由回复里找不到可解析的 JSON' }` |
| 路径归一 | 只做规范化（`\` → `/`、去 `./` 前缀、转小写），**不猜**「c03」/「第 3 章」这类模糊表达——对不上 `allowed` 的直接跳过（宁可回退成发全部，也不要猜错文件去改） |
| 白名单 | 只保留 `allowed` 里存在的路径，去重 |
| 数量 | 最多 **6** 个（再多说明需求本身该拆开提，硬着头皮全发等于没路由） |
| 空结果 | 一个合法目标都没有、且 `restructure !== true` ⇒ `{ route: null, error: '路由结果里没有任何合法目标文件（可能是模型给的路径与大纲不一致）' }`；`restructure` 为真时允许 targets 为空（改结构可能只交新表、不点名改哪份） |

## 3. 关键流程 / 算法

```
project:modify-html（章节模式）
  → projects.applyChapterEdit()
      ① 拼路由提示词：章节大纲 + 角色表 + 用户需求
      ② chatWithRoute() → 模型回 <<<ROUTE>>> JSON <<<END ROUTE>>>
      ③ parseRouteReply(reply, allowed)      ← 本模块
      ④ route 为空 → 回退成「发全部源码」（路由失败不能让改稿做不了）
      ⑤ route 有值 → 只读 paths 里那几份源码，用 <<<CURRENT 路径>>> 包起来发给模型
```

- **白名单口径**：`allowed` 由调用方给（当前项目里真实存在的 `pages/cNN.js` + `cast/<id>.js`），本模块不拼路径、不查磁盘。
- **回退是一条常规路径**：解析失败、目标全不在白名单、模型乱写，都走同一条回退——把全部源码发过去，保证「改稿不会因为路由猜不准而做不了」。
- **`restructure` 只做判定、不做校验**：是否真改了结构、新表合不合法，由第二段的角色表 / 章节表校验负责。

## 4. 依赖与协作

- **被 `projects.ts` 调用**：`applyChapterEdit()` 在路由调用之后调 `parseRouteReply()`，再按结果决定发哪几份源码；本模块**不 import `projects.ts`**（避免成环）。
- **提示词在 `agent/html.ts`**：`HTML_ROUTE_SYSTEM` 规定路由回复的形态与规则，`chatWithRoute()` 是它的调用包装；本模块只消费模型回复。
- **路径语义与 `chapters.ts` / `cast/table.ts` 一致**：章节是 `pages/cNN.js`（`chapters.chapterRelPath`）、角色是 `cast/<id>.js`（`cast.castRelPath`），三处拼法同源。
- **不注册 IPC、不碰渲染层**：路由是 `project:modify-html` 内部的两次模型调用，**没有新增频道**，界面上也看不到「路由」这一步（进度行仍是 `project:html-progress` 的阶段文案）。

## 5. 注意事项与实现要点

- **宁可回退、不许猜**：这是本模块最重要的一条——给错的路径直接跳过，回退成「发全部源码」虽然贵，但结果一定正确；猜错文件则会静默改错章。
- **6 个上限是硬停**：超过 6 个直接截断（按模型给的顺序），不报错——说明用户这一条需求本身该拆成几次提。
- **`reason` 只截不改**：原样 `trim()` 后截到 200 字符，不参与任何判断。
- **它没有状态**：不缓存、不记忆上次路由结果，每次改稿都重新路由——模型看的是本次的大纲与需求。
