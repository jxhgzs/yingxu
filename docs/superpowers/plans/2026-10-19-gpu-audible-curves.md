# 有声曲线GPU预览 Implementation Plan

**Goal:** 让已支持的曲线视频/音频通过原生R3音轨准备＋WebAudio目标时钟播放，消除目前整片后台视频预览的依赖。

**Architecture:** 保持已批准Vue/Electron/独立媒体进程架构；服务生成只含时间变换的44100Hz stereo float32 WAV。浏览器暂停时可获取/解析PCM，但不创建AudioContext；真正播放手势才创建buffer源，以目标局部offset、1倍速调度。原片视频持续静音并逐输出帧seek；音量关键帧和qsin包络只在WebAudio一次施加。目标原生音频算法一致性仍须独立听审/实测。

**Spec:** `docs/plans/2026-10-19-editor-design.md`、`docs/qa/2026-10-19-gpu-curve-clock.md`及既有曲线音频R3 QA。

## Global Constraints

- Node24；统一有理数区间与REA确认的曲线源时钟，不用平均速度替换。
- 不改映序生产、旧片或原生程序。只读基线；原生如需操作先备份专用草稿，正常退出恢复字节。
- 未支持路径显式fallback，不能用静音或恒速冒充曲线音频。曲线音轨生成仍是后台音频准备，界面不能称所有采样实时合成。
- 服务32排队、单clip600秒/256MiB、缓存32项/512MiB；客户端每clip PCM32MiB、PCM缓存64MiB，AudioBuffer只保留激活route。超限拒绝并fallback，不耗尽内存。

## Task 1: 服务音轨缓存

Files: `apps/service/curve-audio.ts`、`packages/media/src/preview-curve-audio.ts`、最小扩展`curve-audio.ts`、cache/http测试。

API: `new CurveAudioRenders(store,{engine}).request(projectId,{revision,clipId},signal?) -> {url,key,clipId,revision,duration,sampleRate,sampleCount}`；`file(key)`；`shutdown()`。

- [x] 先写实际R3/PCM测试，验证gain/fade-neutral、修订/输入/注册素材身份与路径、引擎二进制hash、取消、缓存和上限。
- [x] 复用`renderCurveAudio`，冻结真实Rubberband路径/SHA，不跟随导入文档伪造path；源哈希验证，串行生成、临时清理、WAV发布与SHA校验。
- [x] server注册POST `/api/projects/:id/curve-audio`（会话token/断连取消）、GET/HEAD `/curve-audio/:hash.wav`（实际WAV MIME/Range）。退出时shutdown。

## Task 2: WebAudio路由与PCM

Files: `apps/editor/src/preview/curve-pcm.ts`、`audio.ts`、`test/gpu-curve-audio.test.ts`。

API: `parseCurveWav(ArrayBuffer,{sampleRate,sampleCount}):CurvePcm`，CurvePcm含rate/count/channels双Float32Array/bytes。`PreviewAudio.sync(active,targetSeconds,curves=[])`，curves为 `{id,clip,pcm}`。`curveRoutes` getter只报告已调度字段及AudioContext推导偏差，不冒称声卡延迟。

- [x] 严格WAV fmt3/Extensible float32、LE、44100/stereo、数据长度、finite和内存限界测试。
- [x] 播放手势后源按`start(context.currentTime,targetSeconds-clip.target.start)`调度，rate1；同一route每RAF只改包络，切换/暂停/seek/释放停止源。
- [x] 和恒速HTML媒体源共存，保留lazy/拒绝resume行为与包络替换测试；不复制或重复原曲线声音。

## Task 3: GPU/界面整合

Files: 新`preview/curve-sound.ts`；修改`index.ts`、`plan.ts`、`Preview.vue`、相关测试。

API: `CurveSounds(provider).prepare(layer,context,signal):Promise<CurvePcm>`、`get(id)`、活动ID保护的LRU淘汰、`clear()`；provider回descriptor，读取严格localhost WAV，fetch/parse有界。

- [x] provider可用且clip预估PCM≤32MiB时允许有声plan；未知/超限仍fallback。
- [x] 只有frame.audio活动曲线准备音轨；curve音频clip不创建原HTML媒体，curve video原HTMLVideo永远静音。syncAudio只把无curve媒体给element routes、curve给PCM routes。
- [x] prepare不提前启动PCM；最终transport anchor后才sync。冷准备时暂停transport/声音；热播放保持独立AudioContext时钟，晚帧如实计数。
- [x] 文档变化、快速seek、cancel/dispose不能发布旧PCM；buffer缓存受控，manifest分开记录PCM bytes/routes与解码/输出统计。

## Task 4: 实际验证与交付

- [x] 真实浏览器：已编号59帧视频+带事件音轨，精确源帧、实际音频buffer捕获和导出对比；起始偏移、暂停/seek/恢复、多轨及gain/fade按原clip验证。不以context.running冒充音频输出。
- [x] Node24全量回归/类型/构建、九基线、真实桌面播放/导出下载/重开、生命周期与错误/取消。
- [x] 包版本与源提交/backend hash冻结，更新QA/功能登记/学习，列出时长和原生算法/性能仍待对齐范围。

并行工作依据REA技能“Plan broader investigations”第6条：服务缓存、WebAudio路由及REA温度/色调候选分别独立，父负责GPU/HTTP/实际验证与集成。温度/色调未经原生实验不接入产品。

完成记录：实施源8476f26，0.6打包与实际桌面证据见 `docs/qa/2026-10-19-gpu-audible-curves.md`。该计划完成仅指上述有界实施包；5.333ms恢复调度差异、导出幅度差、PCM上限和完整原生一致性均保留限制。温度/色调仅候选与原生证据，不计作产品调色已集成。
