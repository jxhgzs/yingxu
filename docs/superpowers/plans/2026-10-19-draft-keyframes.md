# 剪映线性缩放关键帧导入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将本机剪映5.9.0已实测的源时钟线性统一缩放关键帧导入可编辑动画，同时保留未知内容的诊断和原始副本。

**Architecture:** 独立适配辅助函数只识别已证实的 `KFTypeScaleX`、`uniform_scale.on=true` 和相等静态X/Y；可选相同Y曲线合并为内部scale曲线。时间以微秒无损转换，合法素材范围内的所有点原样保留。未知属性或插值不产生部分动画，不开放该片段时间编辑。

**Tech Stack:** Node 24、TypeScript、node:test、现有有理数和Animation模型。

**Spec:** `docs/plans/2026-10-19-editor-design.md`、`docs/qa/2026-10-19-keyframes.md`、`evidence/2026-10-19-expansion/verification.json`。

## Global Constraints

- 本机剪映专业版5.9.0是固定行为对照版本，不升级目标程序。
- 基线目录 `../剪映5.9.0复刻分析_20261018/` 只读。
- 工程时间使用可序列化的有理数。帧率独立表示，不能固定24fps，也不能用浮点秒累计剪辑位置。
- 未知字段及效果必须保留原始副本，给出诊断；未解析的关键帧时钟不能猜成局部时间。
- 不改变core、media、apps；原始来源哈希及深拷贝行为不变。
- 用户已批准架构和继续实施；本计划直接在分派的子任务中执行。所引用superpowers执行技能当前目录未提供，采用本计划逐项执行。

---

### Task 1: 已知线性统一缩放解析和真实快照回归

**Files:**
- Create: `packages/jianying/src/animation.ts`
- Create: `packages/jianying/src/visual.ts`
- Modify: `packages/jianying/src/import.ts`
- Create: `test/import-animation.test.ts`
- Modify: `test/import.test.ts`

**Interfaces:**
- Consumes: `validateAnimations(animations: Animation[], sourceDuration: Rational)`、`micros(number)`。
- Produces: `importScaleAnimations(segment: Record<string, any>, materialDuration: Rational): {animations?: Animation[]; diagnostic?: string}`。

- [x] **Step 1:** 写真实 `03-copy-2x.json` 和 `04-copy-2x-split.json` 测试，确认源点3/5秒、目标7秒求值1.25、源4秒边界1.125及editableTiming=true；确认原对象和provenance完全保留。

```ts
const clip = result.document.tracks[1].clips[0];
assert.deepEqual(clip.animations![0].points.map(p => p.time), [rational(3), rational(5)]);
assert(Math.abs(evaluateAnimation(clip.animations![0], sourceTimeAt(clip, rational(7))) - 1.25) < 1e-12);
```

- [x] **Step 2:** 执行 `node --test test/import.test.ts test/import-animation.test.ts`，确认旧导入器未开放已知关键帧导致失败。
- [x] **Step 3:** 辅助解析器逐点验证ID、严格递增安全整数微秒、单一有限值、`curveType='Line'`、空graphID、左右控制点0；用`validateAnimations`校验素材时长和内部值边界，不按片段时长剪点。

```ts
const animation: Animation = {property:'scale', points: parsedPoints};
validateAnimations([animation], materialDuration);
return {animations:[animation]};
```

- [x] **Step 4:** 集成时只在解析器返回diagnostic时将editableTiming设false，曲线变速的旧限制保留；已知缩放不再报告CLOCK_UNRESOLVED，经父任务补充授权，仅对已实测默认视频视觉及默认引用解除笼统诊断，未知仍保留。
- [x] **Step 5:** 更新旧测试，将旧已证实缩放视为支持；未知属性另构造并验证深拷贝。

### Task 2: 未知与非法数据边界

**Files:**
- Modify: `test/import-animation.test.ts`
- Create: `docs/qa/2026-10-19-draft-keyframes.md`

**Interfaces:**
- Consumes: `importJianying(raw, sourceText?)`。
- Produces: 明确的支持边界及失败/降级行为。

- [x] **Step 1:** 测试可选相等Y曲线合并；静态X/Y不等、动态X/Y不等、未知属性、Bezier、非零控制柄、非空graphID、uniform关闭均保留诊断及只读状态，且不给部分动画。
- [x] **Step 2:** 测试逆序、相同时间、相同ID、负时间、素材时长外时间、非安全微秒、无效值和空列表均抛错；测试位于片段范围外、素材范围内的点原样保留并维持可见插值。
- [x] **Step 3:** 执行相关测试和 `npm run typecheck`，保存实际结果到QA文档，列出Bezier、其他属性、全视觉导入和渲染未验证的差异。
- [x] **Step 4:** 审查只改职责文件；不提交Git，由父任务统一集成。
