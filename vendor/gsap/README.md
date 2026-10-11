# vendor/gsap —— 随包携带的 GSAP 运行时

本目录存放**随应用分发**的 GSAP 核心库，用于让生成的 HTML composition 在**离线**环境下也能预览与渲染（不再依赖 CDN）。

## 为什么需要它

Agent 生成 HTML 时会引入 GSAP 来做动画时间轴。若用 CDN 地址（`cdn.jsdelivr.net` 等），离线或 CDN 抖动时 `gsap` 未定义、`window.__timelines` 不存在，预览会静止、转视频可能失败。因此应用改为：**HTML 引用同目录的 `./gsap.min.js`，由应用在生成 / 保存 / 预览 / 渲染时自动把随包文件复制到项目目录**（见 `src/main/hfEnv.ts` 的 `localizeGsapHtml` / `copyGsapIntoProject`）。

## 文件

| 文件 | 版本 | 大小 | 说明 |
|---|---|---|---|
| `gsap.min.js` | 3.14.2 | 72,779 字节（71.07 KB） | GSAP 核心（UMD 压缩版），取自 npm 包 `gsap` 的 `dist/gsap.min.js`，保留原始许可头 |

- 来源：`https://registry.npmjs.org/gsap/-/gsap-3.14.2.tgz` 内的 `package/dist/gsap.min.js`
- tarball 完整性（npm `dist.integrity`，sha512）：`sha512-P8/mMxVLU7o4+55+1TCnQrPmgjPKnwkzkXOK1asnR9Jg2lna4tEY5qBJjMmAaOBDDZWtlRjBXjLa0w53G/uBLA==`
- 本文件 SHA256：`C174BFCE53A729418D57A8AD8625E7247C793A22FEF8E2851E3CFA3DE9CD8280`
- 版本选择：与内置示例（`video-projects/*/index.html`）以及 HyperFrames 自带文档（`resources/hyperframes/node_modules/hyperframes/dist/docs/gsap.md`）保持一致

## 许可

GSAP 核心采用 GreenSock 标准许可（[gsap.com/standard-license](https://gsap.com/standard-license)），可免费用于包括商业项目在内的大多数场景；需要付费的是 Club 会员插件（SplitText / MorphSVG 等），本项目未使用。**请勿删除文件头部的许可与版权声明。**

## 更新步骤

1. 取新版 tarball 并校验（示例脚本用 Node 22+ 的内置 `fetch`）：

   ```js
   // node ./fetch-gsap.cjs（VER 改成目标版本）
   const fs = require('fs'), crypto = require('crypto');
   const VER = '3.14.2';
   (async () => {
     const meta = await (await fetch('https://registry.npmjs.org/gsap/' + VER)).json();
     const buf = Buffer.from(await (await fetch(meta.dist.tarball)).arrayBuffer());
     const got = 'sha512-' + crypto.createHash('sha512').update(buf).digest('base64');
     if (got !== meta.dist.integrity) throw new Error('完整性校验失败');
     fs.writeFileSync('gsap.tgz', buf);
   })();
   ```

2. 解包并替换：

   ```bash
   tar -xzf gsap.tgz package/dist/gsap.min.js
   cp package/dist/gsap.min.js vendor/gsap/gsap.min.js
   ```

3. 同步更新本 README 的版本 / 大小 / SHA256，并确认提示词里的引用写法仍是 `./gsap.min.js`（`src/main/htmlAgent.ts`）。
