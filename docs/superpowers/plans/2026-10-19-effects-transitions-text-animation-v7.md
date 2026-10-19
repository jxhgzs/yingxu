# 特效、转场与文字动画继续实现 Implementation Plan

**Goal:** 继续固定剪映5.9.0行为对照，补齐有实测依据的效果、转场边界和文字动画；完整1:1为总目标，未经验证的资源继续登记。

**Architecture:** 沿用已批准Electron/Vue3/Ant Design Vue、独立核心与媒体进程。普通属性关键帧与原生文字动画分别建模，所有新增效果在共享渲染图驱动GPU与离线输出。独立重写参数和数学，不接入私有库或复制目标shader。

**Tech Stack:** Node24/TypeScript、Vue3、WebGL2、FFmpeg/libass、现有REA6.7.0/Ghidra12.1.4。

**Spec:** `docs/plans/2026-10-19-editor-design.md`，用户2026-10-19继续要求特效、转场、文字动画1:1。

## Global Constraints

- 不修改映序生产数据，基线目录只读。只操作已备份专用原生草稿；完成正常退出后恢复原字节与SHA。
- 目标静态代码、原生UI/导出、产品通过分别记录；资源库存只代表时间点的本地缓存，不代表完整在线商店。
- 共享精确有理数与已有source时钟；文字动画单独使用已证明的时钟，不伪装为common_keyframes。
- 未知视觉效果拒绝无提示导出，禁止把同一叠化、淡入或普通关键帧冒充全部命名效果。

## Task 1: REA与原生证据

Files: `docs/qa/2026-10-19-rea-{effects-v7,transition-v7,text-animation}.md`；新独立ignored artifacts与新增evidence。

- [x] 复用已核验库SHA/profile，用实际REA新证据核对动画字段/时钟、资源参数/数学和转场缺口；export/close/STOP自有会话。
- [x] 原生文字分别无动画、渐显、渐隐及打字机，保存JSON/真实导出、资源身份、逐帧亮度或字形可见性；验证ease，不能默认线性。
- [x] 原生转场透明双方+下层、无handles编号源，分别导出并冻结语义与差异。
- [x] 原生新增调节使用固定色卡，按每项实际字段/版本/参数与采样误差决定集成范围。

## Task 2: 版本化文字动画与GPU

Files: `packages/core/src/text-animation.ts`、document/edits；`packages/media/src/captions.ts`、text-raster；service text-raster；preview plan/gl/index；独立TextAnimations.vue。

Interfaces: `TextAnimation={phase:'in'|'out',kind:'fade'|'typewriter',duration:Rational}`；`textAnimationOpacity(animations,targetElapsed,targetDuration):number`返回相对alpha。只在真实资源确认后登记phase/kind，不从命名猜全库。

- [x] 写非零target start、duration端点、in/out组合、非法阶段/字段/时长拒绝的实际数学测试。表达式如 `assert.equal(textAnimationOpacity(clip,add(clip.target.start,div(duration,rational(2)))),.75)` 仅在quadOut原生已证实时作为期望。
- [x] 原生动画单独存入clip；动画类型/资源映射有界，unknown保持来源与诊断。命令原子保存、撤销重做、trim/split按已测规则或明确拒绝。
- [x] ASS逐输出帧应用相同动画数学；GPU对已支持静态字形使用独立有效alpha/transform，不能重复烘焙变换。需要动态字形时采用有界按帧纹理且可取消，超限明确后台回退。
- [x] UI提供phase与已验证kind、时长、应用/移除；真机修改/撤销/逐帧/播放/导出/重开验证。

## Task 3: 效果栈与转场

Files: core/media/jianying color-effects、preview shader、ColorAdjustments.vue；core/media transitions与导入。

- [x] 先集成已经原生实测的temperature/tone候选，核心用 `temperatureTintMatrix`，色调矩阵位于高光/阴影之后；色彩编译器每矩阵后clamp。
- [ ] 新数学候选的完整原生验收与控件尚未完成：黑白场、褪色、暗角、锐化和光感只有新的静态数学证据，继续登记，未把材质默认值等同运行时uniform。
- [x] 根据真实透明层与源边界结果修复转场，曲线端部handle使用端点速度；未知边界保持拒绝，不静默填黑或裁齐。
- [x] 分别保留原生误差、CPU公式误差、GPU buffer误差和编码误差，不放宽旧单项门槛。

## Task 4: 回归与桌面

- [x] Node24全量测试、vue-tsc/桌面构建、基线回放；真实GPU、错误/取消及资源释放检查。
- [x] 先提交运行时再打包，验证.app真实操作/导出下载/退出重开，冻结版本、源提交、backend SHA。
- [x] 更新功能登记/QA/AGENTS经验；明确已实现与未完成的完整资源库和1:1条目，不按几个样例宣称全部完成。

独立REA问题按skill “Plan broader investigations”第6条分派；父负责原生UI、接口冻结、集成及验收。

本轮0.7有界集成已验证：226测试、9基线、真实GPU、桌面编辑/导出/重开。上方未选项和总目录覆盖仍未完成，不能据此标记完整1:1。版本与测量见对应0.7 QA。
