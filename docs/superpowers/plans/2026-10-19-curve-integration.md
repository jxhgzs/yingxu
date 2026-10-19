# Curve Speed Integration Implementation Plan

> **Execution:** 按已批准架构持续实施；纯数学和媒体表达式为独立并行任务，集成与目标对照由主任务完成。

**Goal:** 实现曲线速度设置、源时钟关键帧、真实曲线草稿导入、非节点分割和原生导出，按真实编号帧验证。

**Architecture:** Clip增加可选speedCurve；speed保持source/target精确比值作为结构字段，曲线媒体时钟独立使用REA已核验的分段速度积分。文档已有target duration为显式输入，不能以平均值重算替换。视频用同份段定义生成正向/逆向FFmpeg表达式；音频使用原生变速且验证时长、事件与音高边界。

**Tech Stack:** TypeScript、有理数边界、REA/Ghidra固定版本证据、FFmpeg、Vue/AntDV。

**Spec:** docs/plans/2026-10-19-editor-design.md 的SP03/KF02与统一时钟；docs/qa/rea-curve-followup.md。

## Global Constraints

- 原程序5.9.0和已存基线不变；只在专用草稿新增实验。
- Native float32点坐标转换、三段线性速度积分和split三次边界生成分开实现，不将图形外观当算法。
- 原始映射精确到微秒；编辑时间用有理数，帧量化单独处理。未核验800us/NTSC/auto_alignment边界保留差异。
- 任何未实现音频处理不得静默丢音轨；裁切等未经核验行为明确限制且不能写成完成。
- 闭源伪代码只留ignored artifacts；产品源码使用独立数学实现与清晰名称。

### Task 1: 曲线文档与编辑

Files: core/document.ts、commands.ts、edits.ts、animation.ts、test/curve-command.test.ts。

```ts
{type:'speed.curve';clipId:string;curve:SpeedCurve|null;shiftFollowing:boolean}
// null explicitly resets to 1x; ordinary speed command clears a curve.
```

- [x] 验证speedCurve；sourceTimeAt/targetTimeAt消费真实积分映射，播放头越片段边界时安全夹住时钟。
- [x] 新设置曲线按平均与已知帧规则定时长；可显式联动后续；恒速清曲线。
- [x] 曲线split使用rawSourceDelta生成新点、nearest source frame划分源区间、微秒target边界保留；一次撤销复原。
- [x] 未验证的曲线裁切明确拒绝，不能套常速比例。

### Task 2: 草稿导入与渲染

Files: jianying/import.ts、visual.ts、curve.ts；media/curve-speed.ts、render.ts；test/curve-render.test.ts。

- [x] 解析已知mode1曲线并核对平均；保留source/target独立区间与raw provenance，未知曲线只读不猜。
- [x] 视频PTS采用同份逆映射；位置/旋转/透明度与ASS曲线文字仍按源时钟评估。
- [x] 用真实MOV曲线区59帧逐帧匹配源编号；偏差不得仅用decode成功掩盖。
- [x] 原声音轨存在时实现保调变速，测事件/基频与时长，未知波形/算法一致性单列。

### Task 3: Vue与完整流程

Files: components/CurveSpeed.vue、Inspector.vue、Timeline.vue、api.ts与QA。

- [x] 常速/曲线选择、可编辑规范化点、曲线预览、明确应用/重置与联动。
- [x] 实际打开已知曲线草稿并重链接、选中曲线、分割、撤销、导出并保存编号帧证据。
- [x] 完成完整测试与类型构建，更新登记册，完整1:1保持未验收状态直至全部缺口解决。
