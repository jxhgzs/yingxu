# Source-clock keyframe editing Implementation Plan

> **Execution:** 沿用用户已批准的架构，在当前会话逐项执行。模板指定的 superpowers 执行技能在本机不可用；不因此重复请求已授予的实现授权。

**Goal:** 添加可编辑、可持久化且预览与导出一致的源时间关键帧，先覆盖已实测线性缩放及独立实现的位置、旋转、透明度和音量。

**Architecture:** 时间仍使用精确有理数，动画关键帧保存在素材源时钟。命令与求值保持纯函数；FFmpeg表达式消费同一动画模型，界面通过原有版本化命令保存。剪映未知插值与曲线变速继续保留诊断，不猜测。

**Tech Stack:** Vue 3、TypeScript、Ant Design Vue、FFmpeg。

**Spec:** `docs/plans/2026-10-19-editor-design.md`；新实测 `evidence/2026-10-19-expansion/`。

## Global Constraints

- 固定剪映5.9.0，不改原应用、原始分析基线与映序生产工程。
- 实测复制到6秒后源入点仍3秒、关键帧仍源3/5秒；二倍速后全局7秒显示125%。
- 实测在全局6.5秒分割二倍速片段，源4秒处左右均补112.5%的边界关键帧。
- 新引擎其他属性的实现测试与目标一致性分别记账。
- 未知关键帧、插值、曲线变速不可静默导出。

### Task 1: 精确求值与命令

**Files:** `packages/core/src/animation.ts`、`document.ts`、`commands.ts`、`edits.ts`、`test/animation.test.ts`。

**Interfaces:**

```ts
type AnimatedProperty = 'x'|'y'|'scale'|'rotation'|'opacity'|'volume';
type Keyframe = {id:string; time:Rational; value:number; interpolation:'linear'|'hold'};
type Animation = {property:AnimatedProperty; points:Keyframe[]};
// Clip.animations?: Animation[]
evaluateAnimation(animation:Animation, sourceTime:Rational):number;
sourceTimeAt(clip:Clip, targetTime:Rational):Rational;
sliceAnimations(animations:Animation[], start:Rational, end:Rational):Animation[];
// keyframe.set: clipId, property, point; exact-time replacement remains one point
// keyframe.remove: clipId, property, pointId; last removal restores its value to base property
```

- [ ] 用真实样例3→5秒1→1.25、全局6→7.5秒2倍速验证全局6.5=1.125；移动与改速不重写源点。
- [ ] 验证左右分割边界均1.125、无重叠时间点、失败命令原文档不变；撤销恢复完整动画。
- [ ] 增加值范围、有限数、属性去重、点ID/时间去重和点数上限校验。
- [ ] 实现纯求值、源时钟转换、线性/保持插值及边界裁切，运行核心测试后提交。

### Task 2: 原生动画合成

**Files:** `packages/media/src/animation.ts`、`render.ts`、`test/animation-render.test.ts`。

**Interfaces:** `animationExpression(clip, property, timeExpression, fallback):string` 生成只含受校验数值的FFmpeg表达式；`render`接口不变。

```ts
// source.start + (globalTime - target.start) * speed
// scale在归零后视频时钟t求值，位置在输出全局t求值。
// 使用if(lt(sourceTime, nextTime), left + ratio*(right-left), ...)。
```

- [ ] 红色定位图在0、0.5、1秒测位置/尺寸像素，分别渲染原速与二倍速，核对相同源事件。
- [ ] 验证透明度两端、中点像素；旋转变化不会裁掉原图四角；音量包络通过解码PCM量测。
- [ ] 保留30/60/NTSC单帧边界测试，预览与导出继续共用图。
- [ ] 仅对必要属性增加逐帧filter；静态片段保持现有低开销路径。实际解码通过后提交。

### Task 3: 关键帧界面与验收

**Files:** `apps/editor/src/components/Keyframes.vue`、`Inspector.vue`、`Timeline.vue`、`controller.ts`、相关CSS、`docs/qa/`。

- [ ] 属性选择、当前播放头添加/更新、上一个/下一个、点列表修改/删除均发版本化命令。
- [ ] 时间线画出源点映射到目标时钟后的菱形；片段显示区间外点不显示。
- [ ] 实际界面添加两个缩放点，播放头跳中点查看112.5%，分割、二倍速、撤销重做、正常退出重开、真实导出抽帧核对。
- [ ] 完成类型检查、相关回归与真实界面截图，登记已实现范围及仍未对齐项。

## Self-review

- [x] 时间字段与现有有理数模型一致，播放头只有在命令入口量化成帧。
- [x] 与已批准原生引擎架构一致；未引入全局配置或生产平台修改。
- [x] 不把线性缩放样例推广成全部插值算法已还原。
- [ ] 全部实现后以实际验证结果更新清单。
