# src/main/account/

> **账号（可选登录）**的**目录模块**：一页覆盖 `src/main/account/` 下 **3 个文件**——账号后端 HTTP 客户端（`api.ts`）、登录令牌的本地持久化（`store.ts`）、把两者拼成「一条登录态」并挂 5 条 `account:*` 频道的装配层（`index.ts`）。
>
> **三条不变量**（与 `src/shared/types.ts` 的账号契约、`docs/account-integration.md` 一致）：① **未登录可用**——账号不 gate 任何本机流水线，断网或登录态失效只影响云端能力；② **令牌不出主进程**——渲染层拿到的只有 `AccountSession`（展示字段 + 过期时间），拿不到 token；③ **断网保留登录态**——只有服务端明确回 `UNAUTHORIZED` 才清令牌，网络错误 / 5xx 一律保留。
>
> 本模块**不碰项目、不碰设置、不调用模型、不注册其它域**；除 `src/main/index.ts` 的装配外**不被任何域依赖**。

- **所在目录**：`src/main/account/`（**同名目录 + `index.ts` 出口**，与 `cast/`、`voice/`、`projects/`、`agent/`、`updater/` 同一套约定；拆法见根 `AGENTS.md` 关键约定 9）
- **类型**：HTTP 客户端（`fetch`）+ 文件读写（`safeStorage` 加密的 `userData/account.bin`）+ 一个只做装配的出口
- **规模**：**3 个文件、合计 393 行、最长 221 行**（`api.ts` **221** / `store.ts` **96** / `index.ts` **76**；实测 `[IO.File]::ReadAllLines`）
- **对外导出**：`index.ts` 导出 `register(ctx)` 与 `currentToken()`；`api.ts` / `store.ts` 的具名导出供 `index.ts` 内部使用（**对外只为「将来的云端接口」留 `currentToken()`**）
- **目录级一篇**：本篇即 `src/main/account/` 的唯一说明文档——内部怎么分文件对外不可见，调用方不要 `import '../account/api'` 这种子文件路径

## 1. 作用与界面位置

先把界面上的位置认清楚，再看代码：

| 界面上的位置 | 走哪条频道 | 背后是本目录的哪份文件 |
|---|---|---|
| 左下角**用户区**（`components/UserArea.vue`）· 浮窗第二项**「登录」** → 登录 / 注册弹窗（`components/AuthDialog.vue`） | `account:send-code`（注册栏「获取验证码」）/ `account:register` / `account:login` | `index.ts` 的 handler → `api.ts` 的 `sendCode()` / `register()` / `login()` → `store.ts.save()` |
| 启动时校验登录态（`App.vue` 的 `onMounted` 里 `void restore()`） | `account:me` | `index.ts` 的 `currentSession()` + `api.me()` + `store.load()` |
| 用户区浮窗**「退出登录」** | `account:logout` | `index.ts` 的 `logout()` → `api.logout()` → `store.clear()` |
| 注册栏**开发模式验证码回显**（未打包时） | `account:send-code` 的回执 | `index.ts` 的 `handleSendCode()`：`app.isPackaged` 时剥掉 `devCode` |

> **它不在任何页面的主流程里**：没有「登录才能用」的页面 / 按钮 gate；`useAuth` 只做展示态镜像（见 [common.md](../renderer/src/common.md)），未登录时用户区显示「未登录」、其余功能照常。

### 1.1 为什么放主进程（而不是渲染层直接发 HTTP）

`api.ts` 头注释列了三条理由，缺一不可：

1. **渲染层 CSP 是 `connect-src 'self'`**（见 `src/renderer/index.html`）——页面里直接 `fetch` 后端会被浏览器拦掉；
2. **打包后页面 Origin 是 `file://`**，而后端的 CORS 只放行 `http://localhost:*`——直连连预检都过不去；
3. **令牌不该交给渲染层**：放在主进程的 `safeStorage` 里，XSS 拿不到它，也就偷不走会话。

因此渲染层只经 preload 的 `accountTools` 传「邮箱 / 密码 / 验证码」，拿回「展示字段 + 错误码」；HTTP、错误码映射与令牌落盘全在本目录。

### 1.2 三条不变量（代码里怎么体现）

| 不变量 | 代码落点 |
|---|---|
| **未登录可用** | `useAuth.ts` 的注释与实现都不 gate 任何页面；`account.me()` 在未登录时直接回 `UNAUTHORIZED`（不抛错）；`logout()` 未登录时也安全（幂等） |
| **令牌不出主进程** | `api.ts` 的 `IssuedSession` 只在本进程内流转；`index.ts` 的 `remember()` 把它换成 `AccountSession` 再过 IPC；`store.ts` 用 `safeStorage.encryptString` 写 `userData/account.bin`，**safeStorage 不可用时只存内存、绝不降级明文** |
| **断网保留登录态** | `index.ts` 的 `currentSession()`：`outcome.code === 'UNAUTHORIZED'` 才 `store.clear()`，其它错误原样返回；`useAuth.restore()` 同样只在 `UNAUTHORIZED` 清展示态 |

## 2. 目录结构（3 个文件）

| 文件 | 行数 | 职责 | 导出 |
|---|---|---|---|
| `api.ts` | **221** | **账号后端 HTTP 客户端**：拼 URL、发请求、解包后端的统一响应体（`success` / `code` / `message` / `data`）、把业务码映射成 `AccountErrorCode`。内部有 `DEFAULT_BASE_URL = 'http://127.0.0.1:8080'`、`REQUEST_TIMEOUT_MS = 10_000`、`FALLBACK_MESSAGE`（**14 条**错误码兜底文案）、`SERVER_CODE_MAP`（**7 条**后端业务码直通）、`request()`（`fetch` + `AbortSignal.timeout(10_000)` + `X-Device-Name` 头） | `apiBaseUrl()` / `fail()` / `sendCode()` / `register()` / `login()` / `me()` / `logout()`；类型 `IssuedSession` / `ApiOutcome<T>` |
| `store.ts` | **96** | **登录令牌的本地持久化**：`safeStorage.encryptString(JSON.stringify(session))` 写 `userData/account.bin`，读时解密并校验形状 / 过期；`safeStorage` 不可用时**只存内存**（`save()` 回 `false`），**绝不降级成明文落盘**；模块级 `memory` / `loaded` 缓存，进程重启即失效 | `load()` / `save()` / `clear()`；类型 `StoredSession` |
| `index.ts` | **76** | **装配层**：`register(_ctx)` 挂 **5 条** `account:*` 频道；`currentToken()` 给将来的云端接口复用；`handleSendCode()` 在 `app.isPackaged` 时剥掉 `devCode`；`remember()` 把成功结果落盘；`currentSession()` 处理 401 / 网络错误；`logout()` 先撤销服务端再清本地 | `register()` / `currentToken()` |

依赖方向：`index.ts → api.ts` / `store.ts`（单向；`api.ts` 与 `store.ts` 互不引用），三者都只 import `electron` / `node:*` 与 `../../shared/{types,ipc}`；**`index.ts` 被 `src/main/index.ts` 单向依赖**（`import * as account from './account'` + `account.register(ctx)`），account **不被 `projects/` / `voice/` / `agent/` 等任何域依赖**。

## 3. 频道与契约（5 条）

| 频道 | preload 方法 | 语义 |
|---|---|---|
| `account:send-code` | `accountTools.sendCode(email)` | 发送注册验证码。载荷 `{ email }`；成功回 `AccountSendCodeOk`（`expiresInSeconds` / `resendAfterSeconds`，**开发模式下多一个 `devCode`**），失败回 `AccountFail` |
| `account:register` | `accountTools.register(payload)` | 注册（邮箱 + 密码 + 邮箱验证码，昵称可选）。成功后**同时登录**，回 `AccountResult`（`{ ok: true, session }`，**不含 token**） |
| `account:login` | `accountTools.login(payload)` | 登录（邮箱 + 密码），回 `AccountResult`。登录页的 401 被 `api.ts` 改写成 `WRONG_PASSWORD`（「邮箱或密码错误」），不沿用「登录已过期」 |
| `account:me` | `accountTools.me()` | 用已保存的令牌取当前用户。未登录 / 令牌过期回 `UNAUTHORIZED`（不抛错）；**401 清令牌、网络错误保留** |
| `account:logout` | `accountTools.logout()` | 先 `POST /api/auth/logout` 撤销服务端会话，再清本地令牌；服务端失败也照常清（否则用户会被卡在「登不出去」）。返回 `void` |

- **频道名集中在 `src/shared/ipc.ts` 的 `IPC.Account` 分组**（`SendCode` / `Register` / `Login` / `Me` / `Logout`），与其它域一样「三处齐改」；`src/shared/ipc.ts` 的注释写明这 5 条「只为云端能力服务」。
- **结果类型不是 `IpcResult`**：账号域用更窄的 `AccountResult` / `AccountSendCodeResult`（`ok` 必带 `session` 或 `code` + `message`），见 [shared/types.ts.md](../shared/types.ts.md) 的「账号」一节。这是刻意的——登录失败要让界面按 `code` 分流（如 `CODE_COOLDOWN` 提示稍后再试），不需要通用的 `detail` / `needPacks` 那套字段。
- **`devCode` 只在未打包时出现**：主进程 `handleSendCode()` 在 `app.isPackaged` 时把字段从回执里剥掉，渲染层不必自己做环境判断（`AuthDialog.vue` 只是「有就显示」）。

## 4. 令牌生命周期

```
注册 / 登录成功
  api.ts 收到后端 { token, tokenType, expiresInSeconds, user }
    → toIssuedSession()：expiresAt = Date.now() + expiresInSeconds * 1000
    → 回 ApiOutcome<IssuedSession>（token 只在本进程）
  index.ts 的 remember()：store.save({ token, expiresAt })
    → safeStorage.encryptString → userData/account.bin（不可用则只留内存）
    → 过 IPC 的只有 { user, expiresAt }（AccountSession）

启动校验（restore）
  useAuth.restore() → accountTools.me() → currentSession()
    → store.load()：解密 + 形状校验 + 过期校验（过期直接 clear）
    → api.me(token)
        ├─ ok       → { ok: true, session: { user, expiresAt } }
        ├─ UNAUTHORIZED → store.clear()
        └─ NETWORK / SERVER → 原样返回（保留登录态）

退出登录
  useAuth.logout() → accountTools.logout() → logout()
    → api.logout(token)（失败也不拦）→ store.clear()（内存 + account.bin）
```

- **后端地址**：`apiBaseUrl()` 取环境变量 `SHADOWMILL_API_BASE`，缺省 `http://127.0.0.1:8080`（本地后端），并去掉末尾斜杠。**设置页里加输入框是后续的事**（见 `docs/account-integration.md` §6）。
- **超时 10 秒**：`AbortSignal.timeout(10_000)`；连不上 / DNS 失败 / 超时统一映射成 `NETWORK`（对用户而言都是「网络不通」，不细分）。
- **`X-Device-Name`**：`deviceName()` 按平台给 `windows` / `macos` / 其它 `process.platform`，只用于后端「设备管理」的展示，取不到也不影响登录。
- **令牌形态由后端定**：不透明会话令牌（后端表 `auth_sessions`、`sm_` 前缀 + 43 字符、30 天滑动续期），所以**客户端没有 refresh、也不解析 JWT**；撤销走 `POST /api/auth/logout`。后端在另一个仓库（`E:\my\demo`），方案与实施记录见 `docs/account-integration.md`。

## 5. 错误码（14 个）

`AccountErrorCode`（定义在 `src/shared/types.ts`）与后端业务码同名，共 **14 个**：

| 分类 | 错误码 |
|---|---|
| 渲染层本地校验产出（前 3 个） | `INVALID_EMAIL` / `WEAK_PASSWORD` / `EMAIL_TAKEN`（注册时后端也回它） |
| 账号与密码 | `ACCOUNT_NOT_FOUND` / `WRONG_PASSWORD` |
| 验证码 | `CODE_INVALID` / `CODE_EXPIRED` / `CODE_TOO_MANY` / `CODE_COOLDOWN` |
| 通用请求 | `BAD_REQUEST` / `UNAUTHORIZED` |
| 传输与本地 | `NETWORK` / `SERVER` / `STORAGE_FAILED` |

- **文案两层来源**：后端给了 `message` 就用后端的（更具体），没有才用 `api.ts` 的 `FALLBACK_MESSAGE` 兜底；`fail(code, message?)` 是唯一的失败构造入口。
- **业务码映射**：`SERVER_CODE_MAP` 直通 7 个后端码（`EMAIL_TAKEN` / `CODE_INVALID` / `CODE_EXPIRED` / `CODE_TOO_MANY` / `CODE_COOLDOWN` / `BAD_REQUEST` / `UNAUTHORIZED`）；其余按 HTTP 状态兜底（401 → `UNAUTHORIZED`、409 → `EMAIL_TAKEN`、429 → `CODE_COOLDOWN`、400/422 → `BAD_REQUEST`、其它 → `SERVER`）。
- **`STORAGE_FAILED` 是声明里的码**：当前 `store.save()` 失败只 `console.warn` 并回 `false`，**不拦登录**（本次会话照常可用，只是下次启动要重新登录）——这条码留给将来的「明确提示持久化失败」用。

## 6. 注意事项

1. **不要在渲染层再发一份账号请求**：CSP 与 CORS 两条都是硬拦（§1.1）；要加新接口就加一条 `account:*` 频道 + `PreloadApi['accountTools']` 方法。
2. **不要把 token 塞进 IPC 回执**：`remember()` 只回 `AccountSession`；将来加「额度 / 项目同步」之类的云端能力，令牌由主进程用 `currentToken()` 自己取。
3. **safeStorage 不可用时不要「想办法落盘」**：`store.ts` 的取舍是**只存内存**——代价是下次启动要重新登录，远小于「令牌明文躺在 `%APPDATA%` 里」。
4. **过期时间以主进程算的 `expiresAt` 为准**：后端只给 `expiresInSeconds`，换算在 `toIssuedSession()` 一处；`useAuth` 只拿它做展示（不据此 gate 请求）。
5. **清态只认 `UNAUTHORIZED`**：`currentSession()` 与 `restore()` 都只在明确「未授权」时清；断网 / 5xx / IPC 异常一律保留（离线可用）。

## 7. 相关文档

- 频道常量：[shared/ipc.ts.md](../shared/ipc.ts.md)（`Account` 分组 5 条）
- 契约类型：[shared/types.ts.md](../shared/types.ts.md)（账号一节 + `PreloadApi.accountTools`）
- 桥接层：[preload/index.ts.md](../preload/index.ts.md)（`accountTools` 命名空间）
- 主进程总览：[02-目录架构-src-main.md](../../02-目录架构-src-main.md)（文件清单与依赖图）
- 渲染层半边：[common.md](../renderer/src/common.md)（`useAuth` / `useAuthDialog` / `localAccount`）、[components.md](../renderer/src/components.md)（`AuthDialog` / `UserArea`）
- 方案与后端实施记录：`docs/account-integration.md`（仓库内，非 wiki）
