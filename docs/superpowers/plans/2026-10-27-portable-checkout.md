# Portable Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 当前会话依照用户直接实施授权由主代理执行，不派生代理。

**Goal:** 仅凭仓库与公开可安装依赖完成启动、演示和 macOS 开发包构建。

**Architecture:** 入库自主生成素材，运行与打包共用。统一媒体工具查找并提供明确环境检查，独立检出验证不访问私人基线。

**Tech Stack:** Node.js 24+、Vue 3、TypeScript、Vite、Electron、FFmpeg/FFprobe、Rubber Band。

**Spec:** docs/plans/2026-10-27-portable-checkout-design.md

## Global Constraints

- Apple 芯片 Mac、Node.js 24+；不修改生产平台及正在编辑的数据。
- 研究基线只读且不是启动或打包前提；新演示素材来自 FFmpeg 测试图与正弦音。
- 包仍依赖标准媒体工具；不声称公证或完整剪映对齐。

### Task 1: 可移植素材与媒体路径

**Files:** 新增 packages/media/src/tools.ts、test/media-tool-paths.test.ts、fixtures/README.md、fixtures/timeline-probe.mp4、scripts/generate-demo.ts；修改 probe.ts、两处 curve-audio.ts、server.ts、package-desktop.ts、vite.config.ts。

**Interfaces:** `findMediaTool(name, {env?, fallbackDirectories?})` 返回可执行绝对路径或 undefined；`mediaTool(name)` 优先保留显式配置，缺失时返回命令名供执行层报告错误。ffmpeg/ffprobe 调用签名不变，新增 rubberband getter。

- [x] 编写 PATH、Finder、显式覆盖错误、空 PATH、空格路径与非执行文件回归；运行 `node --test test/media-tool-paths.test.ts` 确认失败。
- [x] 实现查找及调用替换，`node scripts/generate-demo.ts` 用 testsrc2+sine 生成 640×360/30fps/6秒素材并记录来源；删除私有目录回退。
- [x] 补齐 `/text-renders` 与 `/curve-audio` 代理，执行路径、HTTP、曲线引擎缓存回归。

### Task 2: 环境检查与说明

**Files:** 新增 scripts/doctor.ts、test/doctor.test.ts；修改 package.json、README.md、.nvmrc、test/curve-audio-cache.test.ts。

**Interfaces:** doctor 默认检查运行环境，`--package` 再检查 macOS/Electron；失败返回非零且列明修复方式。npm prestart/predesktop/prepackage:mac 复用同一检查。

- [x] 用隔离环境子进程验证缺失工具检查失败且不泄露环境内容。
- [x] 实现工具版本、subtitles/zscale、编码器、字体与 demo 检查；加 `doctor`、`test:portable`、素材生成脚本及 npm 生命周期钩子。
- [x] README 更新无需私人资料的启动/打包、标准依赖安装与可选原生基线范围；`npm run typecheck`、`npm run test:portable`、`npm run build:desktop` 通过。

### Task 3: 独立检出交付

**Files:** docs/qa/2026-10-27-portable-checkout.md。

- [ ] 提交实现后，在系统临时目录 `git clone --no-hardlinks`，确认没有相邻调研目录，执行 `npm ci`、`npm run doctor`、`npm run test:portable`、`npm run package:mac`。
- [ ] 用新包服务与独立数据目录检查演示、素材206、文字栅格、曲线音频及实际导出；核随包字体和素材 SHA、签名。
- [ ] 记录真实结果、更新完成项，扫描提交内容的凭据，再 push origin main 并核对远端提交。
