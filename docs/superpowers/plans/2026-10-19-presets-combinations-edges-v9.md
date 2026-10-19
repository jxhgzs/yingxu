# 预设、复杂组合与转场边缘 Implementation Plan

**Goal:** 继续固定剪映5.9.0全量目标，扩大经过真实原生输出核验的预设与组合，修复已证空间转场边缘差异，并改进受限文字缓存的持续播放。

**Architecture:** 延续已批准Vue/Electron与独立媒体引擎。REA按独立问题并行取证，原生UI只由父任务操作；数学、解码、编码及GPU层分别验收。未知资源继续诊断，不能把候选资源数量当支持数量。

**Tech Stack:** Node24、Vue3、Ant Design Vue、FFmpeg7.1、WebGL2、REA6.7/Ghidra12.1。

**Spec:** `docs/plans/2026-10-19-editor-design.md` 与功能对照清单、0.8集成QA。

## Global Constraints

- 原程序固定5.9.0，不升级；专用草稿修改前保存原字节，正常退出后恢复并核SHA。
- 不修改生产映序、剧集资料和既有只读基线；私有资源代码仅ignored分析目录，产品独立实现。
- 时间使用有理数，预览/导出复用同一图；所有旧门槛与失败样本保留。
- GPU缓存保持有界，冷准备/预热/播放/解码与输出掉帧分别记录，实际性能验证期间暂停本任务重计算。

## Task 1：剩余调节与预设证据

Files：`artifacts/rea/effects-v9/`、`artifacts/qa/native-v9/`；新core空间调节模块、media与GPU局部、ColorAdjustments及相应测试。

- [x] 新REA定向调用核对暗角/锐化资源路径与哈希；资源目录直接打开失败保留，复用旧数学证据，未冒称恢复锐化运行算法。
- [x] 原生暗角取得真实path/version/value和四强度实际导出；锐化保留未实现，未将静态资源当运行验证。
- [x] 对原生已验证算子建立共享版本化字段，先回归恒等、符号、中心/边缘、alpha及参数拒绝，再接CPU/GPU/UI。
- [x] 真实产品输出与原生按空间位置和全幅测量；组合顺序独立验证，不泛化为全部参数组合已验。

## Task 2：文字预设与组合

Files：core/text-animation、media/captions/text-raster、TextAnimations、相应新测试与v9证据。

- [x] REA更新本地资源清单，正常原生UI取得新的循环/入出资源，记录真实ID/名称和边界。
- [x] 从独立数学候选构造相位、周期、transform与alpha回归；原生单项与三阶段组合分开实导出。
- [x] 通过实际帧对照后接核心、ASS、GPU与UI；未知caption/group和未验命名保持拒绝。

## Task 3：空间转场边缘

Files：新core边缘采样模块、media/render转场局部、preview/webgl混合局部与相关tests。

- [x] 新REA调用与v8 YUV事实定位每平面坐标/色度重建；保留RGB原始max150/239。
- [x] 用独立平面mask oracle比较全窗口与边带，不通过排除边缘或放宽门槛掩盖差异。
- [x] 确认一致的颜色/alpha/几何条件后才接产品；对原生、CPU编码、GPU各自验收并保留未支持条件。

## Task 4：有界持续预热与集成

Files：preview/text-cache/index/decode纹理局部、缓存与transport测试、实际probe、桌面QA。

- [x] 覆盖超过32图的持续前台播放、前台pin、滚动预取、取消和修订隔离，峰值预算不得增加。
- [x] 真实冷准备、反复seek/播放和压力工程分别运行，采HTTP/buffer/墙钟/输出与解码掉帧。
- [x] Node24全量测试、9基线、类型与构建；实际UI编辑、历史、导出、未失焦退出重开。
- [x] 提交运行时再打包，核前后端SHA与签名，更新完整缺口；原生恢复、自有REA与临时服务停止后交付真实状态。

本轮实施包已验证并交付0.9，不表示全量1:1完成；实际性能、异常与完整缺口见 `docs/qa/2026-10-19-presets-preview-v9.md`。
