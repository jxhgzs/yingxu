# 字幕导入与批量文本渲染 Implementation Plan

> **Execution:** 沿用已批准独立编辑器设计与持续开发授权；本会话执行，REA调查按独立问题并行。不存在的superpowers执行技能不作为重新确认前提。

**Goal:** SRT/WebVTT以一次可撤销事务导入、保留精确时间与纯文本，并让长字幕时间线通过统一ASS合成稳定导出。

**Architecture:** 解析器和一次clone的工程构造器由纯核心模块提供；专用subtitles.import命令产生一次修订。UI先解析并列出格式降级诊断，确认导入后只提交一个绑定工程的命令。媒体层将相邻文本图层写入一份ASS，以事件Layer维持叠放顺序，避免每cue一条FFmpeg滤镜。

**Tech Stack:** Vue 3、Ant Design Vue、TypeScript、有理数时间、FFmpeg/libass。

**Spec:** docs/plans/2026-10-19-editor-design.md 的文字/字幕、命令、预览导出一致性与来源保留；登记册TX03。

## Global Constraints

- 对照版本固定5.9.0；已知普通字幕导入与全部样式一致分开记账。
- 不修改目标原程序、旧基线与生产映序；专用测试草稿可做单因素实验。
- 解析使用精确有理数；布局/逐词/注音等未支持语义拒绝，不悄悄生成不同字幕。
- 单次导入不因5000 cues创建5000次历史/clone；失败保持工程、历史和请求状态不变。
- 继续保留30、60、NTSC单帧文字边界和现有关键帧导出检查。

### Task 1: 原子字幕命令

Files: packages/core/src/commands.ts、packages/core/src/subtitles.ts、subtitle-import.ts、test/subtitle-command.test.ts。

接口：
```ts
{type:'subtitles.import';input:string;format:'srt'|'vtt';options:SubtitleImportOptions}
// applySubtitleImport(doc,parseSubtitles(input,format),options).document
```

- [x] parse/helper独立验证，非法格式/超限/不支持语义拒绝；重叠采用可见独立位置并告知。
- [x] 命令只clone一次；一次导入/撤销/重做精确恢复，重复idPrefix拒绝，旧revision或未知效果不绕过。
- [x] helper固定新素材/新轨道/新片段ID，同请求重试由既有fingerprint保护。

### Task 2: 文本合成与规模

Files: packages/media/src/captions.ts、render.ts、graph.ts、test/subtitle-render.test.ts。

- [x] 将同一连续文本图层组写入单个ASS，每clip独立Style，事件Layer保持原次序。
- [x] 复用源时钟动画和frameEdge，单帧cue仍先对齐输出帧再转厘秒。
- [x] 渲染上限为300媒体+5000文本片段、每组最多100000动画事件，工程时长仍1小时；超限明示错误。
- [x] 实际输出含中文/多行/重叠/编号帧首尾的字幕；长字幕组不生成每cue一条滤镜；现有文本动画像素回归保持。

### Task 3: 服务和Vue入口

Files: apps/editor/src/controller.ts、App.vue、components/SubtitleImportDialog.vue、api.ts、test/service.test.ts。

- [x] 文件菜单导入SRT/VTT；展示数量、首尾时长、预览和格式降级warning；空/错误输入不提交工程。
- [x] 确定导入时绑定选择文件时的工程ID，工程切换后拒绝，导入偏移为非负秒且精确处理。
- [x] 真实HTTP创建/导入/撤销/重做/导出；实际UI选择文件、导入、撤销、重做、导出并查看结果。
- [x] 完成相关类型构建和完整回归后提交，更新登记册与QA，不标记完整1:1通过。
