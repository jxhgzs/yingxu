# 静音曲线 GPU 时钟核验

日期：2026-10-19。本项扩展已批准的独立编辑器源时钟设计。复用既有 REA 恢复的三段线性速度与整数微秒积分，没有重新分析目标程序或采用平均恒速。目标原生证据见 `rea-curve-followup.md`；本记录为自行实现与真实浏览器测试，不是新增剪映导出比对。

## 纯时钟模块

新增 `apps/editor/src/preview/curve-clock.ts`：

- `createCurveClock(clip).sample(targetTime: number | Rational)` 返回权威整数微秒源位置、浮点源秒、目标秒、该目标时刻的瞬时 `ds/dt`。
- `targetDrift(actualSourceSeconds, targetTime)` 将源秒偏差按瞬时速度换为目标秒偏差，不能除元数据平均速度。
- `curvePlaybackRate(clock,time,lookAheadSeconds)` 为可选的局部中点率探针；最终精确静音曲线预览不依赖此近似播放路径。

缓存 `curveVelocitySpans`，二分查找对应分段；保留源/目标区间，不按端点比重新缩放积分。输入有理数先减目标入点、再取整数微秒，避免片段移动后先转 double 再相减导致半微秒边界不稳定。

`node --test test/gpu-curve-clock.test.ts`：4/4 通过，包括既有五点曲线每输出帧、分段边界 ±1μs、瞬时速度与局部积分，以及 12 组 8 点曲线在分数目标入点的 2,412 次映射对照。测试直接调用核心 `sourceTimeAt` 比较有理数结果。

## 独立真实浏览器探针

本地 ignored `artifacts/qa/gpu-curve-probe/`，Vite 8831；IAB 中通过按钮启动。探针不改原生 app、用户工程或生产任务。自行生成 30fps/6s、180 个不同整幅颜色编号的静音源，用浏览器逐帧暂停 seek 建立 0—100 源帧的实际 GPU 色卡，避免 YUV/浏览器色彩转换使原 RGB 色卡分类出错。每输出帧保存目标帧、核心源秒与源帧、瞬时速度、媒体 currentTime、requestVideoFrameCallback.mediaTime/presentedFrames、GPU readPixels 识别源编号。

测试片段源入点 0.1s、源长度 3s，目标 1.966666s，曲线点 x 为 0/.25/.5/.75/1，y 为 1/1/5.375/1/1。画布 640×360；当前 IAB 的 GL renderer 仅报告 `WebKit WebGL`，此字段不足以独立证明具体 GPU 型号。没有以 screenshot 像素替代 buffer 采样。

| 策略 | 源尺寸 | 绘制输出帧 | 源编号错误 | 最大源帧误差 | 输出跳帧 | 解码丢帧 | 总耗时 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 按瞬时 playbackRate 连续播放 | 640×360 | 59/59 | 37 | 2 | 0 | 33 | 1936.6ms |
| 暂停逐帧权威 seek | 640×360 | 59/59 | 0 | 0 | 0 | 0 | 1937.1ms |
| 实时时钟、逐输出帧 seek | 640×360 | 59/59 | 0 | 0 | 0 | 0 | 1971.9ms |
| 实时时钟、逐输出帧 seek | 1280×720 | 57/59 | 0 | 0 | 2 | 0 | 1971.4ms |

720p 每次 seek（包括等待下一 rAF）平均 17.64ms，最大 33.60ms。精确策略始终暂停曲线 HTMLVideo，不调用其 play；输出以独立目标时钟推进，实际超时会跳过输出帧并如实计数，不以重锚目标时钟掩盖慢播。独立探针的暂停策略按序完成，不代表所有暂停拖动都无延迟。

有效原始结果：`paused-1792395719408.json`、`instant-1792395736756.json`、`seek-1792395762980.json`、`seek-1792395807600.json`。早期原 RGB 色卡未适配解码色彩，产生错误分类；旧记录保留但不作为有效帧误差结论。最终720p记录保存完整实际校准色卡。

## 当前界限

真实 `GpuPreview` 集成已另测，见下一节。曲线如果存在实际可闻音轨，继续后台预览；`preservesPitch=true` 不等同于已有 R3 保调路径，更不能称剪映原生音频算法一致。未来实时声音需独立、绑定工程哈希和目标时钟的已渲染音频 sidecar，并复测 seek、取消、A/V 同步；不能用平均恒速或静音代替。

只覆盖一组曲线、CFR 30fps、短素材与两个分辨率；不外推 VFR、NTSC、高速随机拖动、多路曲线或剪映性能一致。720p 已观察 2 个输出跳帧，不能描述为全链路零丢帧。


## 实际 GpuPreview 集成

`integration.html` 直接导入当前 `apps/editor/src/preview/index.ts`，通过正式 `setDocument/seek/play` API 驱动，`/media/v` 为本地探针白名单媒体路由。先用完整源片逐帧 seek 构造同一合成器的实际色卡，再切换为曲线片段。片段内部 speed 使用源/目标时长的精确比值，曲线数学仍独立于该字段。绘制后立即 readPixels，防止浏览器清空非 preserveDrawingBuffer 的画布后误取黑色。

| 正式引擎策略 | 源尺寸 | 实际 GPU 源帧 | 输出跳帧 | 解码丢帧 | 完成耗时 | mean/max prepare |
| --- | --- | --- | --- | --- | --- | --- |
| 暂停媒体、逐输出帧权威 seek | 640×360 | 59/59 正确 | 0 | 0 | 2004.1ms | 16.63/17.70ms |
| 暂停媒体、逐输出帧权威 seek | 1280×720 | 59/59 正确 | 0 | 0 | 2006.6ms | 16.55/17.70ms |

真实 renderer 为 `ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)`，softwareRenderer=false。两次使用同一 640×360 合成分辨率，原始素材尺寸不同；不能描述为全分辨率720p合成性能。音频 context 全程 uninitialized。原始集成结果与每帧 source/currentTime/decodedMediaTime/pixel/metrics 见 `evidence/2026-10-19-gpu-curve/integration-sd.json`、`integration-hd.json`。

一次较早的 SD 集成在系统调度下为 51/59、8 个输出跳帧、prepare 最长106.5ms；首帧采样发生在画布已清空后而读黑，随后修正探针为 play 初始绘制后立即采样。该旧记录仍在 ignored artifacts，不删去慢路径事实。后两次通过证明该短 fixture 当前可实时运行，不证明任意运行负载均无跳帧，亦不构成剪映5.9.0性能基线。
