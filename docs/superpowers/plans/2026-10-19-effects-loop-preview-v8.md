# 剩余效果、循环组合与预览优化 Implementation Plan

**Goal:** 继续固定剪映5.9.0完整对照，新增实际资源与导出支持的效果/转场/循环组合动画，并减少精确文字准备导致的重复HTTP、PNG解码和播放中等待。

**Architecture:** 沿用用户批准的Electron/Vue/Ant Design Vue、独立核心/媒体引擎。REA分问题提供静态证据，原生UI导出验证后才将独立数学纳入共享渲染图；GPU精确文字使用有界预热与解码缓存，保持ASS权威像素和文档修订隔离。

**Tech Stack:** Node24、TypeScript、Vue3、WebGL2/WebAudio、FFmpeg/libass；现有REA6.7.0/Ghidra12.1.4。

**Spec:** `docs/plans/2026-10-19-editor-design.md`；用户继续要求全部效果/转场/循环组合文字及GPU1:1。

## Global Constraints

- 专用原生草稿先存原字节/SHA，实验正常退出后恢复；基线、生产映序和视频生产数据不修改。
- 静态公式、原生实测、产品像素与性能分别登记，不以资源名猜公式。
- 私有脚本/反编译仅ignored，产品独立实现；未知资源保持诊断。
- 预览与导出共享精确时间；缓存按project/revision隔离，取消后不能迟到绘制。

## Task 1: 新证据

Files: 新`artifacts/rea/{loop-combo,effects,transitions}-v8/`、`docs/qa/2026-10-19-rea-*-v8.md`与纯观测evidence。

- [x] 复用已固定SHA/profile、通过真实REA新调用回答loop/caption/group、剩余效果的字段与参数、其他转场数学。
- [x] 正常原生UI取得循环/组合及新转场；4秒文字和独立色卡/边缘素材保存草稿、资源身份、实际MOV。
- [x] 原生逐帧定量核对后冻结共享phase、周期、空间和alpha规则，未验证候选保留缺口。

## Task 2: 动画、效果与转场实现

Files: `packages/core/src/text-animation.ts`与document/commands；media/captions、color-effects/render；preview plan/webgl；相应控件。

- [x] 测试实际资源/类型/组合互斥、目标时钟周期及端点，扩展严格版本化字段，保留原in/out行为。
- [x] 原生已验数学进入核心、ASS/导出/GPU及UI；执行同素材真实渲染比较、撤销重做与重开。
- [x] 效果和转场逐项独立实现并在CPU/编码/GPU分层验证，不替换全目录为同一个公式。

## Task 3: 有界精确文字预热

Files: 新`apps/editor/src/preview/text-cache.ts`；preview/index/decode/webgl、类型与测试。

Interface: `TextFrameCache`接受provider和文档修订context，按clip/frame请求严格验证描述符，按URL共用已解码图片；上限32个独立纹理/128MiB，帧别名≤300/clip。`prepare`提供当前帧，`warm`顺序准备前方窗口，不创建AudioContext；reset/dispose取消并释放图像。

- [x] 回归覆盖同内容不同frame复用、错误身份、迟到取消、容量上限、不同工程同clip隔离、dispose无迟到资源。
- [x] setDocument/seek预热有界窗口；播放准备已热帧不暂停视频或音轨，未命中仍明确buffer；不以超预算无界存图改善指标。
- [x] 用同一0.7的3秒有声文字工程，记录冷准备、播放墙钟、buffer次数、输出/解码掉帧、实际帧像素与原始AudioParam错误。冷启动代价不隐藏为播放阶段性能。

## Task 4: 集成与交付

- [x] Node24全量测试、9基线、类型与桌面构建；真实GPU像素、播放、资源释放和取消。
- [x] 运行时提交后打包；实际.app编辑、撤销/重做、导出下载、退出重开并核版本/源提交/前后端SHA。
- [x] 更新功能登记、完整缺口与经验，原生草稿恢复、所有自有REA/测试服务退出。只有完整目录与各层验收均满足才声明1:1完成。

本计划所述0.8增量已验证交付。完整目标仍按功能登记保留，所有目录和1:1像素/性能没有因此视为完成；最终结果见 docs/qa/2026-10-19-effects-loop-preview-v8.md。
