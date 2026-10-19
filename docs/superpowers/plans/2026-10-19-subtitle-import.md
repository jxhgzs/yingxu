# Subtitle import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将SRT/WebVTT字幕作为精确时间的可编辑文字片段一次性导入，明确呈现不支持的格式语义。

**Architecture:** 纯核心解析器返回精确有理数cue、诊断与原文本；独立helper一次克隆工程，按重叠分轨并最终验证。服务与Vue入口由主执行者接入专用单次原子命令，不扩大普通batch上限。

**Tech Stack:** TypeScript、Node 24、node:test。

**Spec:** `docs/plans/2026-10-19-editor-design.md`、`docs/parity/功能与操作对照清单.md` TX03；WebVTT语法核对采用 [W3C WebVTT](https://www.w3.org/TR/webvtt1/)（2026-10-19访问）。

## Global Constraints

- 固定目标剪映5.9.0；未取得该目标字幕操作证据，不能宣称样式或交互已经一致。
- 时间使用可序列化的有理数，不先转浮点秒，不吸附项目帧格。
- 不执行字幕HTML、CSS、脚本或网络资源；未知语义拒绝，明确转换的样式提供warning。
- 最多5000 cues、UTF-8 4 MiB、单cue可见文本2000字符；失败不修改工程。
- 本任务只创建字幕解析/helper、测试、计划和QA；不改共享document/commands/media/UI/service，不提交Git。

### Task 1: 严格解析与精确时间

**Files:** Create `packages/core/src/subtitles.ts`; Test `test/subtitles.test.ts`。

**Interfaces:**
```ts
parseSubtitles(input:string,format:'srt'|'vtt'):ParsedSubtitles;
// ParsedSubtitles: {format,sourceText,cues:[{index,id?,start,duration,text}],diagnostics}
// SubtitleParseError: {code,line?,cueIndex?}; no partial parsed result on error.
```

- [x] 写入BOM/CRLF、中文多行、100小时、VTT省略小时与1毫秒精度测试，先运行确认缺少模块失败。
- [x] 时间正则分离SRT逗号与VTT点号，小时使用BigInt，分钟/秒限制00—59；空/倒置/负时间拒绝。
- [x] VTT NOTE与header说明返回info；基本字体/voice标签转换为纯文本并返回warning；settings、STYLE/REGION、ruby、逐词时间标签、未知标签拒绝。
- [x] 实体只经字符串映射解码，保留未转义花括号/反斜线供现有文本渲染安全路径处理；脚本标签拒绝。
- [x] 验证资源上限、畸形块与注入输入均明确失败。

### Task 2: 原子工程导入

**Files:** Create `packages/core/src/subtitle-import.ts`; Test `test/subtitles.test.ts`。

**Interfaces:**
```ts
type SubtitleImportOptions={idPrefix:string;name?:string;offset?:Rational;style?:{size?:number;color?:string;font?:string}};
applySubtitleImport(document:Document,parsed:ParsedSubtitles,options:SubtitleImportOptions):
  {document:Document;clipIds:string[];trackIds:string[];diagnostics:SubtitleDiagnostic[]};
```

- [x] 写入精确offset、重叠分轨、ID冲突、轨道超限、布局超界与输入不变测试。
- [x] 一次clone，单一text asset、每cue一个clip；按开始时间稳定排序，复用已结束lane，邻接cue不多占轨。
- [x] 重叠lane以字号与最大显式行数分层向上；超过画布的可用高度拒绝并提示，不静默叠字。
- [x] 严格验证options、文本、解析结构与生成ID；只在完整validateDocument通过后返回。
- [x] 5000 cues完整导入作压力回归，确认没有每cue整工程clone。

### Task 3: 验证与接入交付

**Files:** Create `docs/qa/2026-10-19-subtitle-import.md`。

- [x] 运行 `node --test test/subtitles.test.ts` 与 `npm run typecheck`，记录真实结果。
- [x] 给主执行者报告接口、错误码、转换诊断及实际验证；UI/真实目标对照留给主执行者，不冒称通过。

## Execution

父任务已授权并行独立模块；当前执行者直接完成此计划，缺少的superpowers执行技能不构成重复询问用户的理由。
