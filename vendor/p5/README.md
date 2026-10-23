# vendor/p5 — 随包的前端绘制库

生成物里出现 p5 / p5.brush 时，由主进程把下面两个文件复制进项目目录，页面以相对路径 `./p5.min.js` / `./p5.brush.js` 引用；
与 `vendor/gsap/` 同一套机制（见 `src/main/hfEnv.ts` 的 `VENDOR_LIBS`），目的是**离线可用**：不依赖任何 CDN。

| 文件 | 来源包 | 版本 | 体积 | 许可证 |
|---|---|---|---|---|
| `p5.min.js` | `p5` | **2.3.3**（UMD 全局构建；文件内部 `VERSION` 串为 `2.3.1`，以上游 package.json 为准） | 990,372 B | **LGPL-2.1**（见 `P5-LICENSE.txt`） |
| `p5.brush.js` | `p5.brush` | **2.2.3**（UMD 构建，p5 插件形态，需先加载 p5） | 71,792 B | **MIT**（见 `P5.BRUSH-LICENSE.md`） |

- 取用方式：`npm install p5@2.3.3 p5.brush@2.2.3`，然后复制 `p5/lib/p5.min.js` 与 `p5.brush/dist/p5.brush.js`。
- **升级时两处一起改**：本目录的文件，以及 `src/main/hfEnv.ts` 里 `VENDOR_LIBS` 的 `pinned` 字段（导出单文件 HTML 时换回的 CDN 地址必须与随包版本一致）。
- 页面里的加载顺序固定：先 `p5.min.js`，再 `p5.brush.js`（后者是前者的插件）。
- p5 用 **LGPL-2.1**：以独立文件、运行时动态加载的方式分发（不静态链接进应用代码），满足其可替换要求；若将来改成打包进应用 bundle，需要重新评估许可证义务。
