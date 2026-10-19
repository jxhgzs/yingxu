# 转场候选与已证端帧延展实施计划

> **For agentic workers:** 由当前受派子任务直接实施并交父任务统一验证；不再启动子任务。

**Goal:** 修复UI将已证CFR30零handles转场提前禁止的缺口。

**Architecture:** 复用既有核心`validateDocument`及其`transitionBoundaryPolicy`，提取供Vue与测试共用的纯候选函数。候选时长依次尝试常用半秒、完整偶数帧窗口、原handles可用区间，只有核心完整验证通过才返回；不新增渲染策略。

**Tech Stack:** Vue 3、TypeScript、Node 24原生测试。

**Spec:** `docs/plans/2026-10-19-editor-design.md`及0.7真实CFR30证据；父任务2026-10-19明确授权修复该集成缺口。

## Global Constraints

- 时间使用有理数，不从六位小数回推帧数。
- 零handles仅已证CFR30、1x、帧对齐与有界素材；核心仍为最终准入。
- 不改其他产品文件、原生草稿、共享服务或系统权限。
- 主任务统一进行实际UI验证与提交；此子任务不另建提交。

### Task 1: 共用候选生成与回归

**Files:** 新建`apps/editor/src/transition-candidate.ts`、`test/transition-candidate.test.ts`；修改`apps/editor/src/components/Transitions.vue`。

**Interfaces:** `buildTransitionCandidate(doc:Document|undefined, trackId:string|undefined, clipId:string|undefined,kind:Transition['kind']):{transition?:Transition;name?:string;reason?:string}`。只读输入，无网络和Vue依赖。

- [x] 编写用例：已证CFR30 source0可添加；默认量化14/30秒；旧充足handles半秒保留；未知/VFR、24fps、2x与未对齐零handles拒绝；有限handles可缩短；已有转场不新增；输入不变。
- [x] 执行`node --test test/transition-candidate.test.ts`确认未实现时失败。
- [x] 实现纯函数与Vue接入；候选固定ID避免与已有ID碰撞；全部候选均由`validateDocument`验证，不自行授予CFR资格。
- [x] 同测候选、核心transitions、clone、导入与GPU转场测试，运行typecheck。
- [x] 记录结果与UI待验项，交父任务实际界面验证与统一提交（父任务最终桌面实际添加与原值应用已确认7/15不变，详见0.8集成QA）。
