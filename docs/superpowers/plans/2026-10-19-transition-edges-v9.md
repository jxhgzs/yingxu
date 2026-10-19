# 空间转场色度边缘收敛实施计划

> **For agentic workers:** 当前独立转场子任务直接实施，原生UI由父任务独占；不再派生子任务。

**Goal:** 减少0.8空间转场原生编码边缘差，不扩大误差门槛。

**Architecture:** 沿用已批准的核心/媒体/GPU架构。先比较独立YUV420平面模型与RGB重建，再对严格符合条件的独立不透明空间转场采用cosited plane策略；CPU保持YUV不经有损RGBA往返，GPU由同一phase/矩阵常量独立重建显示RGB。其他工程继续既有RGBA合成，未知范围不默认获证。

**Tech Stack:** Node24、TypeScript、FFmpeg7、WebGL2、REA6.7/Ghidra已有SDK分析。

**Spec:** `docs/plans/2026-10-19-editor-design.md`、`docs/qa/2026-10-19-rea-transitions-v8.md`；父任务明确授权0.9边缘收敛。

## Global Constraints

- 原生MOV/资源只读；新调用复用既有SDK及profile，privatecode仅ignored。
- 不以低MAE代替全图/边缘最大误差；保留0.8原始数据。
- 30fps、1280×720、1x以及既有resource/overlap准入不拓宽。
- source/target不改；GPU/CPU模型、实际编码、原生分别记账。
- 限制和候选失败均记录；不改映序生产工程，不提交Git。

### Task 1: 独立解释与REA

- [x] 新REA会话检查并复用SDK，定向查询RGBA/NV12转换相关字符串/函数；导出、close、STOP。
- [x] 从已有native首尾YUV420建立平面mask，按(.5,.5)cosited候选重建RGB；保留全部像素差。
- [x] 在ignored滤镜原型中比较旧RGBA与plane策略的实际同编码输出，不先改产品。

### Task 2: 共享策略与实现

Files: 新`packages/core/src/transition-edge.ts`；`core/transitions.ts`；`media/render.ts`转场局部；`preview/plan.ts`附带策略标记、`preview/webgl.ts`mix局部（先与GPUworker协调）；对应新测试。

- [x] 定义共享mode及资格函数：仅一个可见视频轨、恰好两个原速全画幅不透明无效果片段、唯一已核空间转场；存在overlay/文字/旋转/opacity/调色则回既有RGBA策略。
- [x] CPU在资格通过时单独构造YUV420侧输入与plane mask，最终YUV overlay保持值；不将越界RGB夹紧后再转回YUV。
- [x] GPU使用共享BT709矩阵/phase，亮度与2×2色度独立选择，reconstruct后显示clamp；其他mix路径不变。

### Task 3: 验证与交接

- [x] 有意义测试覆盖资格边界、mask位于色度像素中心、负/超范围RGB重建、source时钟不变。
- [x] 真实CPU导出对native逐帧RGB，配合独立YUV重建，单列端点/边缘/全图MAE和max及未解决样本。
- [x] 用目标SDK字符串/静态观察区分已证和猜测，不宣称静态观察过执行。
- [x] 聚焦回归与typecheck；告知父与GPUworker源码稳定，实际GPU数学/播放由其统一测量。
- [x] 完成`docs/qa/2026-10-19-rea-transition-edges-v9.md`和纯观测evidence；所有自有REA/FFmpeg进程退出。
