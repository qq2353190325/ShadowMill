// src/main/projects/prompts.ts
// 喂给模型的提示词块：内容脚本 / 全局视觉风格 / 画布 / 素材 / 字幕窗，以及规划、逐章、角色三份 prompt。
// 纯字符串拼装（只读项目数据），不调模型、不写盘 —— 调模型在 agent/，落盘在 htmlWrite.ts 与 ipc/。

import { CANVAS_LABELS, CANVAS_SIZES, DEFAULT_CANVAS, RENDER_CANVASES } from '../../shared/constants';
import * as chapters from '../chapters';
import * as cast from '../cast';
import type { ContentScript, Project, ProjectAgentPayload, ProjectCastMember, ProjectChapter, ProjectMaterial, RenderCanvas, Scene, SubtitleLine } from '../../shared/types';
import { normalizeMaterials } from './materials';
import { readProject, readSubtitle } from './store';

// 拼接生成/修改 HTML 时的用户提示（字幕 + 背景音频素材，均可选）
export function buildAgentPrompt(parts: string[]): string {
  return parts.filter(Boolean).join('\n');
}

// 由项目 content 构造「内容脚本」块（方案B：脚本为 HTML 的整体内容源）。
// 含逐场景 { 旁白, 画面分镜, 时长提示 }，指示模型据此设计页面视觉与动画节奏。
// **有效场景的判据是「画面分镜非空」**（旁白可以为空：那样的场景是静音段，成片里纯画面播放）。
// 早先按「旁白非空」筛，等于把静音段整段从提示词里丢掉；反过来画面分镜空着的场景没什么可画，不必给模型。
// **全局视觉风格不在这里**：本块在没有有效场景时返回空串，风格挂在里面会被一起吞掉 —— 见 buildStyleBlock()。
// 无 content 或没有有效场景时返回 ''，老项目（无内容脚本）走原 prompt 流程。
export function buildContentBlock(content: ContentScript | undefined): string {
  const src = content || {} as ContentScript;
  const scenes = Array.isArray(src.scenes) ? src.scenes : [];
  const valid = scenes.filter((s) => s && String(s.visual || '').trim());
  if (!valid.length) return '';
  const parts = [
    '【内容脚本 · 本项目的整体内容源，请据此设计页面视觉风格与动画节奏；旁白写「（无，本场静音）」的场景没有配音，按画面分镜照常呈现即可】',
    // 画面分镜是「一行一个镜头、行首带时长」的写法（见 agent/script.ts 第 3 条）。
    // **主进程不解析这些时长**：原样交给模型，只在这里把约定讲清楚，让模型自己累加成绝对时间。
    '画面分镜按「一行一个镜头」书写，行首形如「2.5s」的是该镜头的时长：请把这些时长按顺序累加成绝对时间（第 1 个镜头从 0 开始）再安排动画；行首没写时长的镜头按该场景的时长提示均分；镜头时长之和与该场景的时长提示冲突时，以镜头时长之和为准。'
  ];
  valid.forEach((s, i) => {
    const dur = (s.durHint !== undefined && s.durHint !== null && String(s.durHint).trim() !== '')
      ? String(s.durHint).trim() + ' 秒'
      : '未指定';
    const visual = String(s.visual || '').trim();
    // 旁白可以空：那样的场景是静音段（没有配音、成片里纯画面），明确写出来免得模型误以为漏填而自行补旁白
    const narration = String(s.narration || '').trim();
    parts.push('场景 ' + (i + 1) + '（时长提示：' + dur + '）：');
    parts.push('- 旁白：' + (narration || '（无，本场静音）'));
    parts.push('- 画面分镜：');
    // 一行一个镜头（行首带时长）；拆出来逐行缩进，免得第二个镜头起看起来像新的顶层字段
    visual.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((l) => parts.push('  - ' + l));
  });
  return '\n' + parts.join('\n');
}

// 「全局视觉风格」块（生成/修改共用，**无条件注入**）。
// 数据来源：用户在「HTML生成」页填的「全局视觉风格」输入框（存 project.json 的 content.style）。
// 为什么不并进 buildContentBlock：那块在没有「画面分镜非空」的场景时直接 return ''，
// 没写内容脚本的项目，用户在输入框里填的风格就一个字都进不了提示词（填了看着没反应）。
// 风格是整片级前提，与有没有场景无关，所以单独成块、无条件返回。
// 与之配套：HTML 系统提示词里不写任何风格（html.ts），本块是模型唯一的风格来源；
// 用户没填时由它说「未指定、自行拟定」，避免模型滑向固定配色。
export function buildStyleBlock(content: ContentScript | undefined): string {
  const style = content && typeof content.style === 'string' ? content.style.trim() : '';
  return style
    ? '\n【全局视觉风格】本项目整片的视觉基调（用户指定，页面配色、质感与氛围以此为准）：' + style
    : '\n【全局视觉风格】用户未指定，按需求描述与内容脚本自行拟定（不要套用固定的配色模板）。';
}

// 素材选择结果（生成/修改共用）：字幕 / 本次参与生成的项目素材
// 两者都只是「要不要带上」，都不带绝对路径：素材的导入走 project:add-materials（复制进项目并登记），
// 音频则由 applyBgmToHtml 注入 HTML，完全不经过这里。
export function resolveMaterials(proj: Project, payload: ProjectAgentPayload): { subtitleText: string; materials: ProjectMaterial[] } {
  // 字幕：'' = 不使用；'__current__' = 当前项目字幕；其他 = 指定带字幕的项目名
  let subtitleText = '';
  const subSel = payload.subtitleProject;
  if (subSel === '__current__') subtitleText = proj.subtitle || '';
  else if (subSel && typeof subSel === 'string') {
    // 别的项目的字幕同样按「内联优先、其次 subtitle.txt」取（与 ensureProject 同一口径）
    const src = readProject(subSel);
    subtitleText = src ? readSubtitle(subSel, src.subtitle) : '';
  }
  // 素材：按 id 从项目素材库取（顺序 = 渲染层列表顺序）；取不到的 id 静默忽略
  const ids = Array.isArray(payload.materialIds) ? payload.materialIds : [];
  const all = normalizeMaterials(proj.materials);
  const materials = ids
    .map((id) => all.find((m) => m.id === id))
    .filter((m): m is ProjectMaterial => !!m);
  return { subtitleText, materials };
}

// 素材块（图片 / 视频分开写）：给模型的是**项目内相对路径**——页面里直接 <img src="images/x.png">，
// 预览走 hgpreview:// 协议、转视频时同目录相对引用同样成立（与背景音轨、随包前端库文件同一套相对引用规则）。
export function buildMaterialBlock(materials: ProjectMaterial[]): string {
  const imgs = materials.filter((m) => m.kind === 'image');
  const vids = materials.filter((m) => m.kind === 'video');
  const list = (arr: ProjectMaterial[]): string => arr.map((m) => m.file + '（原文件名 ' + m.label + '）').join('、');
  const parts: string[] = [];
  if (imgs.length) {
    parts.push('\n【图片素材】项目内图片文件：' + list(imgs) + '。请按 <img src="' + imgs[0].file
      + '"> 这类项目内相对路径嵌入，并用 GSAP 为每张图编排入场/退场（淡入淡出、位移、缩放）与切换节奏；多张图片按内容脚本的场景顺序分配。');
  }
  if (vids.length) {
    parts.push('\n【视频素材】项目内视频文件：' + list(vids) + '。请用 <video src="' + vids[0].file
      + '" autoplay muted loop playsinline> 嵌入，并用 GSAP 时间轴编排其入场/出场与播放时段。');
  }
  return parts.join('');
}

// 画布块（生成/修改共用）：把项目选定的画布告诉模型，并要求它按这块画布排版式。
// 为什么必须说：画布是**渲染时的实际视口尺寸**（HyperFrames composition 尺寸 = 成片尺寸），
// 模型若按自己习惯的 1600x900 之类固定尺寸画，画布一变就会在四周留大片黑边（本项目的真实故障）。
// 缺省画布 = DEFAULT_CANVAS（landscape），与老项目的原始观感一致。
// forModify：修改场景追加第 ⑤ 条——换过画布的旧页面必须重排，而不是把旧版式硬塞进新画布。
export function buildCanvasBlock(proj: Project, forModify = false): string {
  // project.json 可能被手改过：非白名单取值一律落回缺省画布，避免 CANVAS_SIZES 取不到而崩
  const raw = proj && proj.canvas;
  const canvas: RenderCanvas = raw && RENDER_CANVASES.indexOf(raw) >= 0 ? raw : DEFAULT_CANVAS;
  const size = CANVAS_SIZES[canvas];
  const label = CANVAS_LABELS[canvas] || canvas;
  // ⑤ 只在修改时给：换画布不会自动重排已有页面（project.canvas 变了、页面舞台还是旧的），
  // 于是渲染视口变成新画布后四周留黑边、内容还会被裁——只能让模型按新画布重排一次。
  const relayout = forModify
    ? '⑤ 若当前页面的 <html data-resolution> 或主舞台尺寸与本画布**不一致**（典型情形：页面原来按横屏 1920×1080 排过版，'
      + '而画布后来被改成了方形 / 竖屏），必须**重新排布**：把主舞台改成上面的尺寸，并按新画布重算所有元素的位置、字号与间距，'
      + '让内容排满整块画布；**不要**用 transform: scale、居中留白或黑边把旧版式硬套进新画布。'
    : '';
  return '\n【画布】成片画布固定为 ' + label + '（' + size.width + '×' + size.height + ' 像素），渲染视口就等于这块画布。必须：' +
    '① 在 <html> 标签上写死 data-resolution="' + canvas + '"；' +
    '② 页面主舞台（承载全部内容的那层容器）尺寸严格等于 ' + size.width + '×' + size.height + '，写固定 px，' +
    '不要用 vw / vh / 百分比自适应，也不要用 transform: scale 去缩放舞台；' +
    '③ 内容排满整块画布（该铺满的铺满、该居中的居中），四周不要留大片空白；' +
    '④ 所有元素的坐标、字号、间距都按这块画布设计。' +
    relayout;
}

// 构造 Agent 用户提示（生成与修改共用；extra 置于最前——修改场景为「当前 HTML 源码」段）
// forModify=true 时画布块会追加「旧页面版式与本画布不一致就必须重排」的硬要求（见 buildCanvasBlock）
export function buildMaterialPrompt(prompt: string, proj: Project, mats: { subtitleText: string; materials: ProjectMaterial[] }, extra: string[], forModify = false): string {
  return buildAgentPrompt([
    ...extra,
    prompt,
    buildContentBlock(proj.content),
    // 风格紧跟内容脚本、**不受「有没有场景」影响**（见 buildStyleBlock 注释）
    buildStyleBlock(proj.content),
    mats.subtitleText ? '\n【项目字幕】每行格式为 [开始-结束] 文本，时间为秒、可带小数（毫秒精度，如 17.920）：该条字幕必须在开始时间出现、在结束时间前完成淡出，严格按此窗口显示，不得挂到下一条开始；GSAP 时间轴直接用这些小数秒定位（如 tl.to(el,{...},17.920)）；仅 [开始] 无结束时间的行自行按语义安排节奏。\n' + mats.subtitleText : '',
    '\n【音轨】背景音轨由应用在渲染前自动注入（<audio id="myv-bgm">），请勿写入、修改或删除任何 <audio> 标签，也不要为音轨预留页面元素。',
    buildCanvasBlock(proj, forModify),
    // 成片时长声明：不给这个数，渲染器只能取「页面里最长媒体」当片长——素材常比动画长得多
    // （实测：动画 45 秒 + 素材原声 225 秒 ⇒ 成片 3 分 45 秒、后 3 分钟全是黑帧）。
    // 根节点写死这个属性，成片就与动画等长；写错/漏写时应用会自己量一次时间轴兜底（见 video.ts）。
    '\n【成片时长】必须把**动画结束时间**写在根元素上：<html data-composition-duration="<秒数>">（可带小数，如 45.6）。' +
      '这个值要等于你写的时间轴总长度（最后一条 tl.to 的位置 + 它的 duration，取最大），不是素材时长。' +
      '漏写的话渲染器会拿最长素材当片长，成片尾部会出现大段静止画面。' +
      // 无限循环是「时长变成 1e10 秒」的唯一来源（2026-10 实测：13 处 repeat:-1 让预览总时长显示成
      // 166666668:12，转视频直接渲不出来）。GSAP 对 repeat:-1 不返回 Infinity，而是把该 tween 的时长
      // 当作 1e10 秒，父时间轴的 duration() 就是「1e10 + 起点」——这条必须在生成时按死。
      '\n【禁止无限循环】任何 tl.to / tl.fromTo / gsap.to 都**不许**写 repeat: -1（也不许 repeat: Infinity）：' +
      'GSAP 会把这种 tween 的时长当成 1e10 秒，整条时间轴的 duration() 立刻变成「1e10 + 起点」，' +
      '预览的总时长会显示成 166666668:12 这种荒谬数字，转视频也渲染不出来。' +
      '需要「一直在动」的效果（呼吸、闪烁、流光、数字雨、扫描线）一律用**有限次数**：按你要的总秒数算好次数，' +
      '如 duration 1.1 + repeat 12 + repeatDelay 0.4；次数照抄成 -1 是明确禁止的。',
    buildMaterialBlock(mats.materials)
  ]);
}

// ===== 章节化长片（W3）：规划 → 逐角色 → 逐章 → 装配骨架 =====
// 分工：跨进程类型在 shared/types.ts（ProjectChapter / ProjectCastMember）、纯逻辑在 main/chapters.ts
// 与 main/cast/table.ts（解析/校验/写盘）、main/chapters.ts（骨架）、改稿路由在 main/editRoute.ts、
// 提示词在 agent/html.ts，本文件只做编排（谁先谁后、进度怎么报、落盘顺序）。
// 一条硬规则：**模型永远不写 index.html**。骨架由 writeChapterSkeleton() 按当前清单生成，
// 所以「改一章 / 改一个角色」不可能改坏画布、成片时长与 HyperFrames 合规结构。
// 角色为什么要有共享层：章节是互相隔离的 IIFE，作用域不共享；不共享角色代码，同一角色会在每章被各画一遍。

// 有效场景：与 buildContentBlock 同一口径（画面分镜非空才算一场），规划里的场景序号就是按这个顺序编的
export function validSceneList(content: ContentScript | undefined): Scene[] {
  const scenes = (content && Array.isArray(content.scenes)) ? content.scenes : [];
  return scenes.filter((s) => s && String(s.visual || '').trim());
}

// 项目画布（脏数据落回缺省，与 buildCanvasBlock 同一口径）
export function projectCanvas(proj: Project): RenderCanvas {
  const raw = proj && proj.canvas;
  return raw && RENDER_CANVASES.indexOf(raw) >= 0 ? raw : DEFAULT_CANVAS;
}

// 规划提示词：只喂判断结构所需的信息（需求 + 内容脚本 + 全片规模），不喂画布/素材/音轨这些与分章无关的块
export function buildPlanPrompt(requirement: string, proj: Project, sub: SubtitleLine[]): string {
  const sceneN = validSceneList(proj.content).length;
  const lastEnd = sub.reduce((m, l) => Math.max(m, l.time + (l.end || 0)), 0);
  return [
    '用户需求：' + requirement,
    buildContentBlock(proj.content),
    '\n【全片规模】有效场景 ' + sceneN + ' 个' +
      (sub.length ? '；字幕 ' + sub.length + ' 条，最后一条结束于 ' + lastEnd.toFixed(2) + ' 秒' : '；没有字幕'),
    '\n【任务】判断这支片子该写成一份 HTML（single），还是拆成若干章（chapters），' +
      '并按系统提示词的规则给出每章的 id / title / scenes / duration / summary。只输出 JSON。'
  ].filter(Boolean).join('\n');
}

// 字幕在某一时间窗内的条目（章节模式下只给本章窗内的字幕，模型才不会去画别章的内容）
export function subtitleWindowText(sub: SubtitleLine[], a: number, b: number): string {
  const hit = sub.filter((l) => {
    const t0 = l.time;
    const t1 = l.end === null || l.end === undefined ? t0 + 2 : l.end;
    return t1 > a + 0.001 && t0 < b - 0.001;
  });
  if (!hit.length) return '';
  return hit.map((l) => '[' + l.time.toFixed(2) + (l.end === null || l.end === undefined ? '' : '-' + l.end.toFixed(2)) + '] ' + l.text).join('\n');
}

// 逐章生成的用户提示：共用部分（需求/风格/画布/素材）+ 全片大纲 + 本章自己的场景与字幕 + 本章角色
export function buildChapterPrompt(opts: {
  proj: Project;
  requirement: string;
  list: ProjectChapter[];
  index: number;
  validScenes: Scene[];
  mats: { subtitleText: string; materials: ProjectMaterial[] };
  sub: SubtitleLine[];
  cast: ProjectCastMember[];
}): string {
  const { proj, list, index, validScenes, mats, sub } = opts;
  const ch = list[index];
  const offs = chapters.chapterOffsets(list);
  const a = offs[index];
  const b = Math.round((a + ch.duration) * 100) / 100;
  // 本章场景：buildContentBlock 会从 1 重新编号，所以必须显式说明「原文第几场」
  const slice = ch.sceneFrom > 0 ? validScenes.slice(ch.sceneFrom - 1, ch.sceneTo) : [];
  const sceneBlock = slice.length
    ? buildContentBlock({ style: '', scenes: slice })
    : '';
  // 角色是**项目素材**（用户勾选），与拆不拆章无关：这里只列"勾选参与本次生成"的那些，
  // 并说清它们在页面里已经就位（骨架 / 注入的 script 都已就位）。
  const castList = opts.cast;
  return [
    '用户需求：' + opts.requirement,
    '\n【本章任务】只写第 ' + (index + 1) + '/' + list.length + ' 章（id ' + ch.id + '，标题「' + ch.title + '」，时长 ' +
      ch.duration + ' 秒，整片第 ' + a.toFixed(2) + '–' + b.toFixed(2) + ' 秒）。',
    '\n【本章文件】' + chapters.chapterRelPath(ch.id) + '（文件块里的路径必须与这一行完全一致）',
    // 随包库是「声明了才有」：没声明 p5 的章里 window.p5 是 undefined，模型必须知道这一点
    '\n【本章随包库】' + (ch.uses && ch.uses.length ? ch.uses.join(' + ') + '（骨架已引入，可直接用）' : '只有 gsap + core.js（本章没有声明 p5，用不了 p5 / p5.brush）'),
    // 角色：只给"这一版参与生成"的那些（含身高单位），并明确「必须调用共享角色库、不许重画」
    castList.length
      ? '\n【项目角色】页面上已经就位 ' + castList.length + ' 个角色（骨架已引入它们的 cast/*.js），**必须用它们画，不许在本章里重画**：\n'
        + castList.map((m) => '- cast/' + m.id + '.js（' + m.name + '，高 ' + m.units + 'u）：' + (m.desc || '（未描述）')).join('\n')
        + '\n调用方式：window.__cast["' + castList[0].id + '"](x, y, u, { ctx: ctx2d, … })；(x, y) 是脚底中点，u 是 1 个单位的像素数，'
        + '**ctx 必须传**（本章 canvas 的 2D 上下文，角色就是往它上面画）。'
        + '角色高 ' + castList[0].units + 'u ⇒ 希望它占画面高度 H 的三分之一，就把 u 设成 H/3/' + castList[0].units + '。'
        + '\n**光传 ctx，角色就是一张不会动的立绘**：它读的是 o 里的动画参数（o.walk 摆腿相位 / o.aL、o.aR 摆臂角度 /'
        + ' o.eyes、o.mouth 表情 / o.blink 眨眼 / o.dy、o.dx 位移 / o.rot 旋转 / o.sq 挤压）。出镜期间请按本章的 t 算出细微动态'
        + '（呼吸 + 眨眼就够），有表演时再叠摆臂、走路与表情；**参数必须由 t 直接算**（draw(t) 是纯函数，seek 后要能重现），'
        + '不要 tween 一个外部对象再读它的值。确实要静止的镜头（定格、时间冻结、纯背景人物）只传 ctx 也行——'
        + '那是**有意的静止**，不是默认写法。'
        + '\n可以照抄的入口模版（参数按本章节奏改，lctx / u 换成你自己的）：\n'
        + '  function put(name, x, y, u, alpha) {\n'
        + '    var fn = window.__cast && window.__cast[name]; if (!fn) return;\n'
        + '    lctx.save();\n'
        + '    lctx.globalAlpha = alpha == null ? 1 : alpha;\n'
        + '    fn(x, y, u, { ctx: lctx,                 // 站着：呼吸 + 眨眼 + 轻微摆臂\n'
        + '                  dy: Math.sin(t * 1.7) * 0.02,\n'
        + '                  blink: (t % 3.6) > 3.4 ? 1 : 0,\n'
        + '                  aL: Math.sin(t * 2.0) * 0.22, aR: -Math.sin(t * 2.0) * 0.22 });\n'
        + '    // 走起来再加 walk（相位 0..1 循环）、有情绪时给 eyes: "happy" / "sad" / "angry"\n'
        + '    lctx.restore();\n'
        + '  }'
        + '\n本章用不到的角色不要调用（没出场的角色不必出现）。'
      : '\n【项目角色】本项目没有勾选任何角色（不要调用 window.__cast）。',
    // 时间轴从 0 开始是本契约里最容易出错的一条，单独说一次
    '\n【时间口径】本章的时间轴从 0 开始、到 ' + ch.duration + ' 秒结束；不要写绝对时间，也不要引用别章的时间。',
    '\n【全片大纲】（了解上下文即可，**不要画别章的内容**）',
    chapters.chapterOutlineText(list),
    sceneBlock ? '\n【本章内容脚本】下面只列本章覆盖的场景（原内容脚本第 ' + ch.sceneFrom + '–' + ch.sceneTo + ' 场，此处按本章顺序重新编号）：' + sceneBlock : '',
    (() => {
      const win = subtitleWindowText(sub, a, b);
      return win ? '\n【本章字幕】只有这些条目落在本章时间窗内（时间为整片秒数，写进本章时要减去本章起点 ' + a.toFixed(2) + '）：\n' + win : '';
    })(),
    buildStyleBlock(proj.content),
    buildCanvasBlock(proj),
    buildMaterialBlock(mats.materials)
  ].filter(Boolean).join('\n');
}

// 单个角色的生成提示（「角色」页 · 新建角色）：只给这个角色的设定 + 全片角色表（比例参照）+ 画风 + 它会用到的库。
// 画风由**角色自带**（role.style）：角色是全局资产，与项目解耦，所以不再读 project.content.style。
export function buildCastPrompt(opts: {
  requirement: string;
  list: ProjectCastMember[];
  index: number;
  style?: string;
}): string {
  const { list, index } = opts;
  const m = list[index];
  const style = String(opts.style || '').trim();
  return [
    '用户需求：' + opts.requirement,
    '\n【角色任务】只定义第 ' + (index + 1) + '/' + list.length + ' 个角色「' + m.name + '」（id ' + m.id + '）。',
    '\n【角色文件】' + cast.castRelPath(m.id) + '（文件块里的路径必须与这一行完全一致）',
    '\n【角色设定】' + (m.desc || '（没写描述，请按画风自行拟定，并把画法要点写进文件注释）'),
    '\n【身高】这个角色高 ' + m.units + 'u（u = 1 个单位的像素数，由调用方传）；同一画面里别的角色的身高见下面的角色表，'
      + '比例要靠你们的 units 对齐，不要各画各的。',
    '\n【画风】' + (style || '（没指定：自己定一套配色与笔触，并把要点写进文件注释；同一系列角色要能一眼看出是一套的）'),
    '\n【全片角色表】（画的时候要让观众一眼分得清谁是谁）\n' + cast.castOutlineText(list),
    '\n【本角色随包库】' + (m.uses && m.uses.length ? m.uses.join(' + ') + '（骨架已引入，可直接用）' : '只有 gsap（本角色没有声明 p5，只能用传进来的 o.ctx 画）'),
    '\n【往哪画】章节调用时会传 o.ctx（Canvas 2D 上下文），默认就用它画；这样 DOM 章节与 Canvas 章节都能调用你。'
      + (m.uses && m.uses.length ? '你声明了 p5，也可以改用 p5 全局绘制，但必须优先支持 o.ctx。' : '')
  ].filter(Boolean).join('\n');
}

// 改画法的提示（「角色」页 · 改这个角色）：在库里那份现有代码上按用户要求重画，**覆盖库里的那份**。
// 与新建的区别：给了【当前角色源码】与【本次改动】，并要求 id / 身高不变——否则改一次长相就换了个角色，
// 项目里引用它的章节会跟着认不出人。
export function buildCastEditPrompt(opts: {
  member: ProjectCastMember;
  list: ProjectCastMember[];
  code: string;
  request: string;
}): string {
  const { member: m, list, code, request } = opts;
  return [
    '用户需求（在这次改动上执行）：' + request,
    '\n【角色任务】只**改写**现有角色「' + m.name + '」（id ' + m.id + '）：id 与身高（' + m.units + 'u）都不许变，'
      + '调用约定 window.__cast["' + m.id + '"](x, y, u, o) 也不许变。',
    '\n【角色文件】' + cast.castRelPath(m.id) + '（文件块里的路径必须与这一行完全一致）',
    '\n【角色设定】' + (m.desc || '（未写描述）'),
    '\n【画风】' + (String(m.style || '').trim() || '（没指定：沿用现有代码里的配色与笔触，不要整体换风格）'),
    '\n【本次改动】' + request,
    '\n【全片角色表】（只改上面那个角色，别动别人的比例与设定）\n' + cast.castOutlineText(list),
    '\n【本角色随包库】' + (m.uses && m.uses.length ? m.uses.join(' + ') + '（页面已引入，可直接用）' : '只有 gsap（只能用传进来的 o.ctx 画）'),
    '\n【关节】手臂的枢轴 = **手臂宽度中心 · 从手臂顶部往下半个手臂宽**（即：手臂横跨 x=±1..±2，枢轴取中线 x=±1.5、y = 肩线 -6 往下 0.5u = -5.5；'
      + '盒子局部 x 取 -0.5..0.5、y 取 -0.5..2.5）。抬手到 90° 时手臂的**中线压在肩线上**、上沿只比肩线高约 0.03u（几乎贴齐），'
      + '臂根也不悬空、**手臂画在躯干之前（身体优先），抬手时手臂不会盖住身体**；静止时与"手臂紧贴身体外侧"的画法逐像素相同。'
      + '**别把枢轴放在肩线上**（那就是头底/下巴那条线，抬到 86°~100° 时臂根会翘到下巴上，实测踩过），'
      + '也**别放到肩线下一整个手臂宽**（抬起来手臂会糊到上胸、显得太低），更**不要**用补角 / 长条形肩垫 / 给身体加肩宽来补缝。'
      + '腿仍按髋部中心转（腿也画在躯干之前，顶部越界会被躯干盖住）。',
    '\n【当前角色源码】在下面这份上改，交回**整份**新文件（<<<FILE ' + cast.castRelPath(m.id) + '>>> … <<<END FILE>>>）：'
      + '\n<<<CURRENT ' + cast.castRelPath(m.id) + '>>>\n' + String(code || '').trim() + '\n<<<END CURRENT>>>'
  ].filter(Boolean).join('\n');
}

// 动作脚本的提示（「角色」页 · 动作示范 · AI 生成专属动作）：**只产出一个纯函数**，
// 输入 t、返回这一刻的动画参数对象。为什么要发角色源码：每个角色自己实现的 o 参数不止通用那几项
// （猫的尾巴、四只脚、手持道具），只有看过源码才知道它到底认哪些键——这是「专属动作」比关键帧表强的地方。
export function buildCastActionPrompt(opts: {
  member: ProjectCastMember;
  code: string;
  request: string;
  duration: number;
}): string {
  const { member: m, code, request, duration } = opts;
  return [
    '用户需求（这条动作要做成什么样）：' + request,
    '\n【动作任务】给角色「' + m.name + '」（id ' + m.id + '）写**一条**动作脚本。',
    '\n【时长】' + duration + ' 秒：t 的取值范围是 0 ≤ t < ' + duration + '。',
    '\n【角色设定】' + (m.desc || '（未写描述）'),
    '\n【角色源码】它真正读哪些 o 参数（方向、量级怎么写）全在这份代码里，先读懂再写：',
    '<<<CURRENT ' + cast.castRelPath(m.id) + '>>>\n' + String(code || '').trim() + '\n<<<END CURRENT>>>',
    '\n【输出格式】\n<<<ACTION>>>\nfunction (t) {\n  return { … };\n}\n<<<END ACTION>>>'
  ].filter(Boolean).join('\n');
}
