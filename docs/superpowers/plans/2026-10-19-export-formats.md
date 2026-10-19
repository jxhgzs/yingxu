# Native export formats Implementation Plan

> **Execution:** 当前会话按用户已批准架构执行；不重复请求架构或启动确认。

**Goal:** 实现真实MOV、MP4、MP3、WAV、M4A、GIF导出、分辨率/帧率/编码/码率与时间区间选择，并冻结每项作业设置。

**Architecture:** 纯核心模块统一解析和验证导出设置；媒体层沿用同一渲染图，按格式映射原生输出和实际探测校验。作业保存规范化设置及其哈希，客户端重试继续使用相同请求ID与设置。

**Tech Stack:** TypeScript、Vue 3、Ant Design Vue、FFmpeg/FFprobe。

**Spec:** `docs/plans/2026-10-19-editor-design.md`；目标真实MOV/MP3/GIF样例见只读基线 `evidence/export-verification.json`。

## Global Constraints

- 剪映5.9.0目标基线不变；不把存在某编码器等同目标效果一致。
- 预览保持H.264 MP4，导出格式由作业冻结，不修改工程画布/帧率。
- 原生视频新默认音频44.1kHz，与已实测目标样例对齐；不声称编码字节或AAC延迟完全相同。
- 区间按输出帧边界选取，声音与画面采用同一实际入点；有理数不能先取浮点累计。
- 临时输出按实际扩展名写入，探测成功后重命名；取消或失败不覆盖其他成片。

### Task 1: 导出设置与原生格式

**Files:** `packages/core/src/export.ts`、`packages/media/src/render.ts`、`test/export.test.ts`。

```ts
type ExportFormat='mp4'|'mov'|'gif'|'mp3'|'wav'|'m4a';
type ExportSettings={format?:ExportFormat;size?:{width:number;height:number};fps?:Rational;
  videoCodec?:'h264'|'hevc';videoBitrateKbps?:number;audioSampleRate?:44100|48000;
  audioBitrateKbps?:number;range?:{start:Rational;duration:Rational}};
resolveExportSettings(document:Document,input?:ExportSettings):ResolvedExport;
```

- [x] 精确选择 `[ceil(start×fps),ceil(end×fps))`，拒绝负/空/越界区间、未知格式、奇数视频尺寸、无效码率。
- [x] 保持原画幅比例，以宽高及帧率配置独立输出；GIF使用可均匀厘秒表示的帧率5/10/20/25/50。
- [x] 原生视频映射libx264/libx265与AAC；音频映射libmp3lame、PCM16、AAC；GIF生成调色板。
- [x] 实际导出六种格式；ffprobe核对容器、编码、采样率、大小与时长，完整解码；帧区间用编号帧核对，不只测设置对象。

### Task 2: 持久作业与HTTP

**Files:** `apps/service/jobs.ts`、`server.ts`、`test/service.test.ts`。

- [x] 作业记录增加规范化exportSettings，requestHash涵盖完整设置；同ID不同设置返回冲突。
- [x] 完成结果增加format/extension/mime，下载与预览HTTP使用真实类型，旧MP4作业以路径推断兼容。
- [x] 通过真实HTTP提交MP3/GIF、检查结果类型及下载字节；保留现有206、取消和重启回归。

### Task 3: Vue导出设置与实际操作

**Files:** `apps/editor/src/components/ExportDialog.vue`、`controller.ts`、`api.ts`、`App.vue`、CSS及验收文档。

- [x] 表单提供格式、分辨率、输出帧率、编码器、码率、采样率和整片/区间；不适用控件不出现。
- [x] 同一待重试ID绑定设置，修改设置使用新ID；格式改变后下载后缀和查看成果链接相应变化。
- [x] 实际界面分别导出MOV、MP3、GIF，下载并核对；无适用音频时导出已知静音，不虚构音轨。
- [x] 通过类型/构建和相关原生/服务测试后提交，更新功能登记册的已验证范围。

## Self-review

- [x] 对输出采样率、区间与容器分别验证，不把MP4改后缀当MOV或GIF。
- [x] 输出设置独立于可撤销工程，作业与请求均固定设置。
- [x] 完成后补实际UI、文件与运行证据。
