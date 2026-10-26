# Timeline Scrub Implementation Plan

> **For agentic workers:** Inline execution; no delegation required for this bounded interaction fix.

**Goal:** 修复用户截图指出的时间尺点击卡顿与无法连续拖动预览。

**Architecture:** Pointer capture+rAF合并输入；串行最新位置队列；UI定位跳过顺序预热，保留原精确绘制与播放路径。

**Tech Stack:** Vue3/TypeScript/Electron/WebGL2/Node24。

**Spec:** docs/plans/2026-10-26-timeline-scrub-design.md

## Global Constraints

- 不改用户工程内容、历史、生产媒体；有理数帧对齐保持。
- GPU32图/128MiB与服务512图/256MiB预算保持。
- 实际App和真实指针输入验收，记录等待/落帧，不能只凭构建宣称流畅。

### Task 1: LatestSeek queue

Files: 新apps/editor/src/preview/latest-seek.ts、test/latest-seek.test.ts；改Preview.vue。

- [ ] 独立Promise屏障测试：首次1保持pending，2/3请求合为3；记录执行[1,3]。reset期间结果不发布；dispose不执行后续；失败不锁队列。
- [ ] 实现request/reset/dispose与队列；播放/文档/模式切换清理。

### Task 2: Pointer and prefetch

Files: Timeline.vue、controller.ts、style.css、preview/index.ts、gpu-preview-runtime.test.ts。

- [ ] 时间尺及播放头handle用主指针capture，move每rAF合并，up flush最后坐标；cancel/失去capture/卸载清理。
- [ ] seek(time,{prefetch:false})仅跳过额外window预热，目标帧精确准备不变；加真实runtime回归。
- [ ] 等待提示延迟120ms，连续拖动期间不覆盖全幅旧帧。

### Task 3: Desktop validation

- [ ] 专项、全量、9基线、typecheck/build通过。
- [ ] 版本0.10.1运行时提交后打包，正常关闭旧App再打开新包；实际时间尺前后拖、点击、越界松手、播放头handle和片段选择/裁切互不干扰。
- [ ] 独立UI探针记录pointer期间多次画面帧变化、最终frame及串行队列，无工程变更；签名/HTTP bundle核验，保留截图和明确限制。
