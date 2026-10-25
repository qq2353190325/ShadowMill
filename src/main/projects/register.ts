// src/main/projects/register.ts
// 只做装配：把 ctx.getWindow 包一层（缺省返回 null），再按固定顺序把四组域的频道注册上
// （角色那组分两支：角色本身在 ipc/cast.ts，动作示范在 ipc/castActions.ts）。
// 注册顺序不影响行为（频道互不重复），写成清单只是为了让「这一页注册了哪些东西」一目了然。
import type { RegisterCtx } from '../../shared/types';
import { registerProjectIpc } from './ipc/project';
import { registerHtmlIpc } from './ipc/html';
import { registerMediaIpc } from './ipc/media';
import { registerCastIpc } from './ipc/cast';
import { registerCastActionIpc } from './ipc/castActions';

export function register(ctx?: RegisterCtx): void {
  const deps: RegisterCtx = { getWindow: (ctx && ctx.getWindow) || (() => null) };
  registerProjectIpc(deps);
  registerHtmlIpc(deps);
  registerMediaIpc(deps);
  registerCastIpc(deps);
  registerCastActionIpc(deps);
}
