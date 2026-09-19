# CLAUDE.md

## 测试约束

- **不要做 UI 测试**：不要启动应用（npm start / Electron）、不要用 Playwright 等工具驱动界面点击或截图来验证改动。
- 不要为了 UI 验证下载/安装测试相关依赖（如 playwright-core）。
- 代码验证只做静态检查：`node --check <file>` 等语法检查、grep 残留引用即可；界面效果由用户自行打开应用确认。
