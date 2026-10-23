# src/main/castLibrary.ts

> **全局角色库**的纯逻辑：读库索引、校验角色文件在不在、把项目里的角色「存为全局」、把库里的角色「导入项目」、从库里删；库根目录由调用方给（`<userData>/cast-library/`），**不 import electron**

- **所在目录**：src/main/
- **类型**：纯逻辑 + 角色文件读写模块（**不调用模型、不注册 IPC、不 import `projects.ts` / 不 import `electron`**）
- **规模**：139 行（实测 `[IO.File]::ReadAllLines`）
- **对外导出**：5 个函数（`readLibrary` / `libraryFileExists` / `promoteFromProject` / `importToProject` / `removeFromLibrary`）

## 1. 作用与职责

「HTML生成」页 · 「角色」区里的**「存为全局」**与**「从全局库添加」**两个动作背后就是这一套东西。全局角色库 = 跨项目复用同一份角色绘制代码（品牌吉祥物、系列片主角那一类）。

**三层关系（别混）**：

| 层 | 位置 | 性质 |
| --- | --- | --- |
| 项目角色 | `projects/<名>/cast/<id>.js` | 这部片子的角色，随项目走（生成物） |
| **全局角色库** | `<userData>/cast-library/`（`index.json` + `<id>.js`） | 应用级的角色库，**用户资产**：可备份、可迁移、不进安装包 |
| 共享绘制助手 | 项目根 `./core.js` | 应用内置、按版本同步（见 [coreLib.ts](./coreLib.ts.md)） |

- **为什么全局库落在 `userData` 而不是随包 `vendor/`**：它是**用户资产**（自己攒的角色、能带走、能备份），`vendor/` 是应用资源（升级时被覆盖）。两者混在一起，一次升级就会把用户攒的角色冲掉。
- **为什么「导入」是复制而不是引用**：预览协议（`hgpreview://`）与渲染静态服务器都只认项目目录内的文件，项目外的文件页面读不到，所以只能在导入时复制进 `cast/`。也正因如此**全局库改了不会自动改已导入的项目**：角色是内容不是基础设施，用户很可能已经在项目里改过它——要更新就再点一次「从全局库添加」（同名覆盖）。
- **读库时把「索引有、文件不在」的条目标成 `missing`**（界面压暗、不可选），**不静默消失**。注意这一步不在本模块里做：本模块只提供 `libraryFileExists()`，`missing` 由 `projects.ts` 的 handler 现算并加到 `CastLibraryMember` 上（详见 §2.5、§5）。

模块本身是**纯逻辑 + 文件读写**：不 import `projects.ts`（避免循环依赖）、不调用模型、不注册 IPC、不认识项目名。与 [cast.ts.md](./cast.ts.md) 同一套写法：库根目录与项目目录一律作参数传入。

## 2. 导出与关键实现

| 名称 | 签名 | 说明 |
| --- | --- | --- |
| `readLibrary(root)` | `(root: string) => { members: ProjectCastMember[]; error?: string }` | 读库索引 `index.json`；**文件缺失 / 损坏都当空库，不抛**（见 2.1）。索引可以是裸数组，也可以是 `{ members: [...] }`（两种形态都认） |
| `libraryFileExists(root, id)` | `(root: string, id: string) => boolean` | 库里是否存在 `<id>.js`（界面 / 导入时校验；`missing` 标记就是用它现算的） |
| `promoteFromProject(root, projectDir, member)` | `(root: string, projectDir: string, member: ProjectCastMember) => { ok: boolean; message: string }` | 把项目里已有的角色**存为全局**：复制 `cast/<id>.js` 到库里 + 更新索引（**同 id 覆盖**） |
| `importToProject(root, projectDir, ids, existing)` | `(root: string, projectDir: string, ids: string[], existing: ProjectCastMember[]) => { ok: boolean; message: string; cast: ProjectCastMember[] }` | 把全局角色**导入项目**：复制进 `<项目>/cast/`，并返回合并后的角色表（`existing` = 项目当前的角色表） |
| `removeFromLibrary(root, id)` | `(root: string, id: string) => { ok: boolean; message: string }` | 从全局库删一个角色：**只删库里那份，不动任何已导入它的项目** |

内部实现细节：`LIB_INDEX = 'index.json'`、`ID_RE = /^[a-z][a-z0-9_]{0,23}$/`（与 `cast.ts` 的角色 id 规则一致）、私有 `indexPath(root)` / `writeLibrary(root, members)`（`mkdirSync` 后写 `{ members }`，2 空格缩进）。**本模块只有 `import type { ProjectCastMember }` 一个类型 import**，不另立角色结构。

### 2.1 `readLibrary()` 的容错（读库永远不抛）

1. `index.json` 不存在 ⇒ `{ members: [] }`（**不是错误**：库还没建起来）。
2. `JSON.parse` 失败 / 读失败 ⇒ `{ members: [], error: '全局角色库索引读取失败：…' }`（这时才带 `error`，`projects.ts` 会把它转成 `{ ok: false, message }`）。
3. 列表形态：裸数组或 `{ members: [...] }` 都认，其余当空。
4. 逐条归一：非对象跳过；`id` 转小写 + `trim` 后用 `ID_RE` 校验，**不合法的整条跳过**（防止路径穿越 / 非法文件名）；`name` 缺省用 `id`、`desc` 缺省空串、`units` 非正数落回 **8**、`uses` 只在是非空数组时保留。
5. **不检查文件是否存在**——索引里有的条目照样列出来（`missing` 由上层加），这样「库里有一条坏记录」用户能看见。

### 2.2 `promoteFromProject()`（存为全局）

1. `id` 转小写 + `trim`，过不了 `ID_RE` ⇒ `{ ok: false, message: '角色 id 不合法：…' }`。
2. `path.join(projectDir, 'cast', id + '.js')` 不存在 ⇒ `{ ok: false, message: '项目里找不到这个角色的文件：cast/<id>.js' }`。
3. `mkdirSync(root)` → `copyFileSync` 到 `<root>/<id>.js`（**同 id 直接覆盖**）。
4. `readLibrary(root).members` 过滤掉同 id 那条，再 `push` 新的一条（`name` / `desc` / `units` 归一，`uses` 有就 `slice()` 复制），`writeLibrary()` 落盘。
5. 成功文案 `'已存为全局角色：' + id`；任何异常 ⇒ `'存为全局角色失败：…'`。

> **元数据以项目里的 `member` 为准**（它是 `Project.cast` 里那条，用户看得到、也可能手改过），不是以库里旧的为准——「存为全局」就是「用项目这份覆盖库里那份」。

### 2.3 `importToProject()`（导入项目）

1. `readLibrary(root)` 拿库表；`next = (existing || []).slice()`（**不改调用方的数组**）。
2. `mkdirSync(<项目>/cast)`，逐个处理 `ids`：非法 id 静默跳过；库里没有该 id **或** `<root>/<id>.js` 不存在 ⇒ 收进 `missing` 列表继续下一个。
3. `copyFileSync` 到 `<项目>/cast/<id>.js`（**文件直接覆盖**——用户要的就是「用库里这份」）；角色表里已有的按 id **整条替换**（以库里元数据为准），没有的 `push`。
4. 一个都没导进来 ⇒ `{ ok: false, message: '没有导入任何角色' + （库里找不到：…）, cast: existing || [] }`。
5. 成功 ⇒ `{ ok: true, message: '已导入 N 个全局角色（…）' + 可选 '；库里缺文件跳过：…', cast: next }`。
6. 异常 ⇒ `{ ok: false, message: '导入全局角色失败：…', cast: existing || [] }`。

> **返回的 `cast` 是「合并后的完整项目角色表」**，`projects.ts` 直接把它赋给 `proj.cast` 并（章节模式下）重写骨架。

### 2.4 `removeFromLibrary()`（从库删）

`id` 校验不过 ⇒ `'角色 id 不合法'`；否则 `rmSync(<root>/<id>.js, { force: true })`（文件本来就不在也不报错）+ `writeLibrary(过滤掉该 id 的 members)`；成功 `'已从全局库移除：' + id`。

> 它**不碰任何项目**：已导入的项目里那份 `cast/<id>.js` 与 `Project.cast` 里的条目都原样留着。这也解释了为什么这条频道的载荷只有 `{ id }`（不需要项目名）。

### 2.5 `missing` 不在本模块里

本模块只提供判据 `libraryFileExists()`；`CastLibraryMember.missing` 由 `projects.ts` 的 `project:cast-library` handler 现算：

```ts
const members = lib.members.map((m) => ({ ...m, missing: !castLibrary.libraryFileExists(root, m.id) }))
```

这样 `index.json` 里不会写进一个「会过期的事实」——文件后来补上了，界面下次列库就自动恢复可选。

## 3. 关键流程 / 算法

### 3.1 四个动作的分工（谁调、调什么）

```
「HTML生成」页 · 「角色」区
  ├─ 行内「存为全局」          → project:promote-cast        → promoteFromProject(<userData>/cast-library, <项目>, member)
  ├─ 「从全局库添加」→ 弹窗勾选 → project:import-cast         → importToProject(<userData>/cast-library, <项目>, ids, proj.cast)
  ├─ 弹窗列库（打开时）        → project:cast-library        → readLibrary + libraryFileExists（现算 missing）
  └─ 从库里删（界面动作）      → project:remove-cast-from-library → removeFromLibrary(<userData>/cast-library, id)
```

- **四个动作全是「搬文件 + 改索引」，一个模型调用都没有**（「改这个角色」才走模型，它属于「按需求修改」那条链）。
- **库根目录只在 `projects.ts` 拼**：`castLibraryRoot()` = `path.join(app.getPath('userData'), 'cast-library')`；本模块只接收 `root`。
- **导入后要重写骨架**：`projects.ts` 在章节模式下会调 `writeChapterSkeleton(...)`，否则新角色不会被引入 `index.html`，章节里 `window.__cast[id]` 是 `undefined`。

### 3.2 索引的读写序（先复制文件、后写索引）

- `promoteFromProject`：**先 `copyFileSync`、后 `writeLibrary`**——索引里出现一条记录时，文件一定已经在盘上；反过来（先写索引再复制）在中途失败时会留下「索引有、文件不在」的条目。
- `importToProject`：**先复制、后返回合并表**（索引不动——库是源，项目角色表由 `projects.ts` 落到 `project.json`）。
- `removeFromLibrary`：先删文件、后写索引；文件本来不在也照样写索引（把那条记录摘掉）。

## 4. 依赖与协作

- **被 `projects.ts` 调用**：四个 `ipcMain.handle`（`project:cast-library` / `promote-cast` / `import-cast` / `remove-cast-from-library`）逐一对应本模块的四个函数；`projects.ts` 负责 `userData` → 库根的拼装、`Project.cast` 的读写、骨架重写与 `missing` 标记。
- **不 import `projects.ts`**：否则与 `projects → castLibrary` 成环。库根目录与项目目录一律作参数传入。
- **不 import `electron`**：`app.getPath('userData')` 在调用方（`projects.ts` 的 `castLibraryRoot()`）里取；本模块只吃一个字符串 `root`，因此可离线测试。
- **类型真源在 `src/shared/types.ts`**：只用 `ProjectCastMember` 描述库条目（`CastLibraryMember` 是它在共享层加 `missing` 后的派生，`ProjectCastResult` 是导入回执的形状）——本模块不需要认识这两个，`missing` 是界面/契约层的事。
- **不注册 IPC、不碰渲染层**：界面是 `HtmlGenPage/CastSection.vue`（「存为全局」/「从全局库添加」弹窗 / 行内两个动作），它只经 preload 的 `projectTools` 调频道。
- **与 `cast.ts` 的分工**：`cast.ts` 管**项目内**的角色文件（解析模型回复、校验、写 `cast/<id>.js`、清孤儿），`castLibrary.ts` 管**库与项目之间**的文件搬移；两者都只用 `ProjectCastMember` 这一个结构，但**互不 import**。

## 5. 注意事项与实现要点

- **导入是复制、不是引用**：项目里那份从导入那一刻起就归项目管；**全局库改了不会自动改已导入的项目**——要更新就再导入一次（同 id 覆盖）。这不是偷懒，是因为预览与渲染两条链路都只认项目目录内的文件。
- **库是用户资产**：它落在 `<userData>/cast-library/`，可备份、可迁移、**不进安装包**；升级应用不会动它（与 `vendor/` 的应用资源刻意分开）。
- **`missing` 只算不加**：不要往 `index.json` 里写 `missing`（那是派生事实，会过期）；也不要让缺文件的条目从列表里消失（用户得看见库里有一条坏记录）。
- **id 规则与 `cast.ts` 完全一致**（`^[a-z][a-z0-9_]{0,23}$`）：读库、存为全局、导入、删库**四个入口都过这条正则**，因为 id 直接当文件名用——这是本模块唯一的越权防护点。
- **`units` 的容错是静默的**：非正数 / 非数字落回 **8**，不报错（角色是「画得出来就行」的东西，不值得因为一个单位数字打断整次操作）。
- **`importToProject` 不改调用方数组**：`existing` 只 `slice()`，替换发生在副本上；`projects.ts` 拿到返回值再赋值，避免「失败时把项目角色表清空」这类事故。
- **没有「库 → 项目」的自动同步**：没有监听、没有启动时对账、没有版本号。库与项目之间只有用户点出来的四条动作。
- **失败文案一律人话 + 带 id**：`'项目里找不到这个角色的文件：cast/<id>.js'`、`'已从全局库移除：<id>'`、`'库里找不到：a、b'`——界面 toast 直接展示，不需要再拼。
