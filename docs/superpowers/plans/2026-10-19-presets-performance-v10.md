# 预设、组合与首次准备 Implementation Plan

> **For agentic workers:** 按REA技能“Plan broader investigations”第6条分配独立调查；共享原生UI只由父任务操作，各worker保留来源与未知项，独立测试后冻结源码供父集成。

**Goal:** 继续固定剪映5.9.0全量对照目标，增加有实导出证明的预设与组合，缩小转场边缘误差并降低首次精确文字准备成本。

**Architecture:** 沿用已确认Vue/Electron、独立工程与原生媒体引擎。共享有理数与渲染图，REA静态线索必须与真实草稿及MOV交叉校验；未知及失败不开放为“已支持”。

**Tech Stack:** Node24、Vue3、Ant Design Vue、FFmpeg7.1、WebGL2、REA6.7/Ghidra12.1。

**Spec:** `docs/plans/2026-10-19-editor-design.md`、功能对照清单与0.9集成报告。

## Global Constraints

- 原生5.9.0不升级；实验专用草稿备份原字节，正常退出后恢复核SHA。
- 不修改生产映序、剧集、旧基线。私有资源代码仅ignored artifacts；产品独立实现。
- GPU预算仍32图/128MiB，服务PNG仍512图/256MiB。准备成本、播放、等待、输出/解码掉帧分别记录。
- 性能采样时冻结源码并暂停本任务其他重计算；全部轮次与异常保留。
- 314项旧回归和9基线不能退步；完整1:1须逐项证据验收，不能由本实施包推断。

## Task 1：预设库存与复杂组合

Files：新 `artifacts/rea/text-presets-v10/`、`artifacts/qa/native-v10/`、text-animation、captions、TextAnimations与对应测试。

- [x] 核REA已有artifact/profile和资源库存，定向取得新的可正常导出预设；父以原生UI记录ID、实际草稿和MOV。
- [x] 对单项与非整周期入/循环/出组合逐帧比较，未知caption/group另列；新增实现前写出确定的公式与边界测试。
- [x] 核心、ASS、scalar/batch及UI共用语义；原生未取得输出的会员候选仍保留未验证。

## Task 2：转场边缘剩余差异

Files：transition-edge、render转场局部、webgl混合局部、对应native/CPU/GPU证据。

- [x] 新REA定向问题与原生YUV残差聚类，验证剩余误差来自采样位置、重建或编码哪一层，不凭名称改公式。
- [x] 在相同输入/相同编码下比较旧策略与新候选，全幅/边带/非边带分别保留；明确资格和fresh probe边界。
- [x] 只把独立参照与真实原生均支持的改动接产品，新增回归先证旧实现失败；仍有误差如实保留。

## Task 3：首次准备与掉帧

Files：text-raster-batch/pixels、service/text-raster、preview/index/text-cache，专项测试与真实GPU探针。

- [x] 读取0.9分阶段profile与633ms rAF异常，定位实质瓶颈，先作可重复相同像素探针。
- [x] 优先消除重复ASS/FFmpeg启动、全帧转换与同内容重复工作；PNG字节/有效RGBA契约、取消/修订隔离和预算保持。
- [x] 先专项回归与类型检查后冻结。真实冷准备和多轮复播由父Cua操作，测试中不读巨大AX，保留全部轮次。

## Task 4：集成交付

- [x] 全量测试、9基线、类型/构建；实际GPU新预设/像素/context及性能独立执行。
- [x] 运行时提交后打包，核前后端SHA、签名与实际UI编辑/历史/导出/未失焦退出重开。
- [x] 更新完整缺口和证据索引；原生草稿恢复，REA导出/close/STOP，临时服务与标签清理。


## 本实施包验收结果

0.10.0完成本轮三预设、非整周期三阶段、严格444重建与流式准备的实现和验收。338/338、9基线、63像素帧、真实GPU冷/复播、新三FBO context、桌面导出/退出重开均通过，详见最终QA。此处勾选表示上述具体调查/接入/记录步骤完成，**不是全量1:1完成**。四层「雨过是天晴」模板仅新增有效原生样本与逐层实施矩阵，尚未实现；剩余目录、字体、CPU/GPU残差、shader首次编译、长工程和宿主均保留未完成。
