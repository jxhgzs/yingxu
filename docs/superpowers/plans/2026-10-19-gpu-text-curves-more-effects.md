# GPU文字、曲线时钟与后续调节 Implementation Plan

**Goal:** 继续补齐5.9.0固定目标的可验证能力，先让静态文字及静音曲线加入实际GPU合成，再按原生证据扩展调节。

**Architecture:** 沿用用户已批准的独立Vue编辑器、统一工程与媒体进程。文字按需使用同一libass排版生成透明纹理，WebGL只负责合成；曲线复用已有源时钟与三段速度模型。有声曲线先保留后台，待独立目标时钟音频准备完成后开放。

**Tech Stack:** Node24、TypeScript、Vue3/Ant Design Vue、WebGL2/WebAudio、FFmpeg7/libass、REA6.7/Ghidra已有环境。

**Spec:** `docs/plans/2026-10-19-editor-design.md`；`docs/qa/2026-10-19-effects-transitions-gpu.md`；`docs/parity/功能与操作对照清单.md`。

## Global Constraints

- 原生只使用 `/Applications/VideoFusion-macOS.app` 5.9.0与专用草稿 `Yingxu-REA-20261018`，操作前备份、退出后恢复原字节。
- 不改映序生产数据、原app、旧成片、共享服务或历史基线。闭源shader/伪代码只保留ignored分析证据，自行重写公式。
- 保留未知结构与诊断；动画文字、有声曲线、未经原生确认的调节不能静默默认成功。
- 稳定源/目标时钟、有理数区间和输出帧边界继续共用；性能、字体、声音与原生一致性分别验收。
- 不为实现细节再次请求已批准架构确认。本次由REA技能“Plan broader investigations”第6条要求的独立问题并行完成。

## Task 1: 按需文字栅格与GPU合成

**Files:** 新建 `packages/media/src/text-raster.ts`、`apps/service/text-raster.ts`及测试；静态TextMedia沿用decode.ts（未额外新建text.ts）；修改preview index/plan/decode/webgl、Preview.vue与server.ts。

**Interfaces:** `TextRasters(store,{engine}).request(projectId,{revision,clipId},signal?) -> {url,key,width,height,revision,clipId}`；`file(key) -> PNG路径`；`shutdown()`。POST `/api/projects/:id/textures`绑定修订与已知文字；GET `/text-renders/:key.png`只服务哈希生成的PNG。

- [x] 用透明背景、中英混排、多行、描边阴影与静态transform建立实际FFmpeg alpha/离线像素断言；未知字段、旧修订、取消与并发缓存分别验证。
- [x] 使用 `captionScript`、`prepareFonts`、黑/白RGBA双底libass反推有效alpha输出一帧PNG（直接alpha=1实测不符）；缓存身份包含工程画幅/已冻结文字/代码字体哈希，不加入用户素材库。
- [x] 只在当前帧需要文字时生成纹理，队列限并发、共享请求不因一个消费者取消而破坏其他消费者；销毁停止自有进程。
- [x] `TextMedia`保留原素材身份，加载生成纹理；GPU以完整画幅identity变换绘制已排版结果，避免双重transform。文字关键帧明确保留fallback。
- [x] 实际界面创建/编辑/撤销/重开文字，确认无需整片后台渲染，叠加次序与静态输出像素可复查。

## Task 2: 曲线瞬时速度与静音GPU路径

**Files:** 新建 `apps/editor/src/preview/curve-clock.ts`、`test/gpu-curve-clock.test.ts`；修改preview plan/index。

**Interfaces:** `createCurveClock(clip).sample(targetTime)`返回精确源时间及瞬时 `ds/dt`，由同一 `curveVelocitySpans`提供速度，不能用clip.speed平均值。最终签名随实现记录到模块注释。

- [x] 以59帧已观察的原生曲线为固定时钟样例，检查静音、恒速退化、边界、裁切、源时间动画与漂移目标秒换算。
- [x] 开放只有无可闻声音的曲线；有声资格需检查素材hasAudio、片段/轨道静音与音量关键帧，不以静态volume=0忽略后续关键帧。
- [x] 暂停seek仍由sourceTimeAt控制；播放每输出帧暂停并权威seek；瞬时playbackRate仅提供速度元数据，独立目标时钟如实记录晚帧，不能将浏览器preservesPitch当R3算法证明。
- [x] 独立真实浏览器探针记录输出帧、decodedMediaTime、漂移、暂停定位及掉帧，再接入完整编辑器验证。有声曲线继续显式后台，不伪装为已完成。

## Task 3: REA与原生后续调节

**Files:** `docs/qa/rea-effects-next.md`、独立原生证据目录；确认后扩展core/color-effects、jianying导入、GPU与浮点导出，补相应测试。

- [x] 复用匹配的REA分析库和已有资源清单，聚焦contrast及其他本地候选的代际、参数、方程与未知范围；关闭自有REA会话保存证据。
- [x] 原生专用色卡草稿执行0、±25、±50等单变量UI调节，保存JSON/截图/真实导出；候选方程须对实际原生像素复核后才开放。
- [x] 新增效果顺序必须核对组合，与现有亮度/饱和度/高光/阴影统一建模；未知代际保持诊断。
- [x] 原生实验后恢复字节哈希，更新功能登记、误差、真实UI与导出验证。

## Task 4: 集成与交付

- [x] Node24全量相关测试、构建、九项原生基线；真实浏览器与桌面文字/曲线/效果导出、暂停定位、保存退出重开及生命周期。
- [x] 包版本与实际源码/字体/后端哈希一致，说明受支持范围和剩余缺口。只在完整登记册满足时称1:1完成。

## 原生差异记录

对比度四单变量符合原有2/4容差；B+50+C+50实际灰3/彩3，单独记录而非冒称旧容差完全通过。其余调节候选没有充分原生证据，未加入产品。

完成记录：171回归、九基线、最终160322桌面包、真实下载、20次生命周期与实际GPU丢失恢复均通过，详见 `docs/qa/2026-10-19-continuation-v5.md`。这是本计划有界范围的完成，不是完整1:1完成。
