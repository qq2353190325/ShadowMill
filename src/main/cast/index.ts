// src/main/cast/index.ts
// 角色（**只有全局一份**：<userData>/cast-library/ <id>.js，项目里只有产物副本）——本目录的统一出口。
// 外部（projects/ 的四个域、main/index.ts）只从 '.../cast' 取，不关心内部怎么分文件——
// 与 src/main/agent/、src/main/updater/、src/main/projects/ 同一套「同名目录 + index.ts」约定。
//
// 目录结构（依赖单向：table 在最上游，edit 依赖 table，其余互不依赖，故不会成环）：
//   table.ts   角色表与角色文件：解析 / 规范化 / 校验 / 读写 cast/<id>.js / 提示词大纲
//   edit.ts    改稿用的角色块：只读角色表 + 剥回复里的角色文件块（依赖 table）
//   inject.ts  单文件模式注入：core.js + 角色脚本整组插在模型第一个 <script> 之前（纯字符串）
//   library.ts 全局角色库 <userData>/cast-library/：读库 / 新建与改画法落盘 / 改元数据 / 删除 /
//              把选中的角色同步成项目副本（syncProjectCast）
//   preview.ts 角色静态预览页拼装：内联 core.js + 角色代码 → <userData>/cast-preview/<id>.html
//   presets.ts 内置动作的数据（14 条公共动作，只读）
//   actions.ts 动作库：规范化 / 校验 / 读写 <userData>/cast-library/actions.json（公共动作 + 每角色专属）/ 生成回复解析
//   demo.ts    动作示范页拼装：内联 core.js + 角色代码 + 动作表 + 帧循环 → <userData>/cast-preview/<id>.demo.html
//
// 依赖单向（无环）：presets 与 table 在最上游；actions 依赖 presets；library 依赖 actions（删角色时清它的专属动作）；
// demo 只依赖 shared 的类型。
//
// 本文件只做再导出，不写任何逻辑。

export {
  castRelPath,
  isCastPath,
  selectedMembers,
  normalizeCastList,
  parseCastTable,
  parseCastFiles,
  validateCastCode,
  readCastCode,
  castOutlineText
} from './table'

export { stripCastFileBlocks, buildCastTableBlock } from './edit'

export { stripInjectedCast, injectCastTags, referencesCore } from './inject'

export {
  readLibrary,
  libraryFileExists,
  readMemberCode,
  writeMemberCode,
  upsertMember,
  updateMemberMeta,
  syncProjectCast,
  removeFromLibrary,
  nextAutoId
} from './library'

export { previewRelPath, buildCastPreviewHtml } from './preview'

export { PRESET_ACTIONS } from './presets'

export {
  normalizeActionDef,
  validateActionCode,
  parseCastActionReply,
  readActions,
  listActionsFor,
  nextActionId,
  upsertAction,
  removeAction,
  removeActionsOfCast
} from './actions'

export { demoRelPath, buildCastDemoHtml } from './demo'
