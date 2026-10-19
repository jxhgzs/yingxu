# GPU 有界滚动与批量文字准备 Implementation Plan

**Goal:** 超过32个唯一文字帧时持续有界准备，降低逐帧冷请求触发的音视频暂停；在精确ASS不变的前提下降低服务端冷生成开销。

**Architecture:** 保留0.8首段非驱逐priming及32张/128MiB/每clip300别名上限。增加最新滚动窗口，仅驱逐当前slot及未来窗口之外的旧图片；HTTP/PNG生产不足时仍如实buffer。根据真实测量继续补最大窗口大小的批量ASS纹理接口，同engine/revision/内容键和取消协议。

**Tech Stack:** Node24、TypeScript、WebGL2、FFmpeg/libass；无新增依赖。

**Spec:** `docs/plans/2026-10-19-editor-design.md`；父任务0.9授权与0.8四轮真实证据。

## Global Constraints

- 不改变文档、动画数学、字体或libass权威像素，不关闭buffer指标或扩大缓存。
- 不修改原生UI或生产映序。父任务通过Cua执行实际probe。
- CPU/HTTP服务冷、服务热/浏览器冷、播放墙钟及掉帧分别记录；性能测量与其他FFmpeg错峰。
- 与预设worker协调共享caption/raster接口；不覆盖转场worker的webgl mix。

## Task 1: 滚动缓存与调度

Files: `preview/text-cache.ts`、`preview/index.ts`、`test/text-frame-cache.test.ts`、`test/gpu-text-cache-transport.test.ts`。

Interface: `roll(requests:readonly TextFrameRequest[],pinned:()=>ReadonlySet<string>,signal?:AbortSignal):Promise<void>`；保留 `warm` 非驱逐行为。滚动只保留一个最新窗口worker，前台仍优先且预算不变。

- [x] 新增超过缓存容量的64帧顺序滚动、未来/当前pin保护、seek窗口替换、迟到reset/dispose和前台join回归。
- [x] 实现最新窗口串行补充，限制列表为缓存可容纳请求数；load驱逐优先窗口外、忽略loading资源，未来protected集合随窗口更新。
- [x] 每个新输出帧完成后后台调度，当前帧缺失仍走原有buffer，短已热工程不重新seek音轨。

## Task 2: 有界批量准备

Files: 新批量媒体helper、`apps/service/text-raster.ts`/`server.ts`、对应HTTP/real libass测试；provider optional batch协商。

- [x] 先测单帧唯一style的冷生产速度；若不足，按父授权补batch≤当前窗口预算，不无界预生成。
- [x] 使用相同完整captionScript、输出帧和subtitleClock，生成目标窗口；内容键仍由各帧评估状态和同engine形成，旧PNG可复用。
- [x] 严格frame去重/排序、请求上限/修订/尺寸/取消，batch临时目录完整验证后逐项原子发布，迟到不可进入新工程。
- [x] 对单帧API与批量每帧RGBA逐字节对照，测冷生成及缓存命中真实耗时。

## Task 3: 实际GPU stress及交付

- [x] 准备大于32 unique、≤300输出帧且有声工程，冷/热分轮；记录cache峰值/eviction/请求/buffer/墙钟/output+decoder drops/visibility/rAF。
- [x] 采满预算前后关键帧，对同ASS像素；seek/revision/context丢失恢复及dispose单独覆盖。
- [x] 定向测试、类型验证后通知父冻结；全量/桌面/提交由父统一执行。
