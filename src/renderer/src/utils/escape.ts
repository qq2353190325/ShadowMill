// utils/escape.ts —— HTML 转义（原 window.App.escTxt；subtitle 页本地副本在 Phase 6 合并到此）
export function escTxt(s: unknown): string {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
