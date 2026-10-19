# 0.9 GPU 精确文字滚动窗口与批量准备

## 实现与边界

- 保留 0.8 首段非驱逐预热。超过 32 唯一 PNG 后，按实际播放输出帧维护最新滚动窗口，窗口大小不超过可容纳的 RGBA 图像数。当前正在使用的文字 slot 与窗口内已解码图像被保护，旧窗口被更新后不再继续解码无关帧。
- 预取窗口达到半空低水位再补充，避免每走一帧就启动一次冷 FFmpeg。前台缺帧仍显式进入 buffering；没有通过暂停媒体时钟掩盖墙钟耗时。
- 可选 batch provider 每 clip 请求升序唯一的 1—32 个全局帧，跨度小于 300，总目标 RGBA 不超过 128 MiB。scalar API 兼容保留，前台请求可加入同帧 batch promise。
- batch 与 scalar 共用完整 ASS、subtitleClock、字体与双背景 alpha 恢复。黑白 rawvideo 与 straight RGBA 落临时目录，Node 仅持有三个单帧 buffer；一次窗口渲染与一次 PNG 编码，逐个内容键原子发布。取消或工程修订变化回滚本批新发布文件并删除临时目录。
- decoded cache 仍 32 张 / 128 MiB / 每 clip 300 aliases；V1 服务 PNG 磁盘缓存为128张 / 256 MiB，180唯一帧超过该工作集，实际复播仍需重生成。V2 将永久 PNG 数量上限调整为512（每张另有JSON sidecar），永久 PNG bytes 仍不超过256 MiB；GPU预算不变。
- 工程、修订、mode/frame、画布与本地注册 PNG 路径严格校验；reset/dispose 全局 abort，迟到生产不能发布到新缓存。新文字 scale 与逐字 sway 状态加入服务内容键，共用文字 worker 的 `renderCaptionScript`。
- exact-frame GPU 仍沿用每 clip 不超过 300 帧、画布不超过 1080p 的现有资格；本次不扩大不支持范围。

## 定向验证

2026-10-19 本机 Node 24：

- 36 项 cache/transport/runtime/GL失败专项通过（含迟到旧seek读取实时current pin）；另 1 项 frame-window 对有理数开闭区间、层顺序、静态/精确混合与窗口上限通过。
- 4 项真实 libass/service/HTTP batch 专项通过：CFR30 与 NTSC 各5个几何+放大+描边阴影帧，PNG 文件逐字节等同 scalar；同内容去重、32张与128MiB边界；真实子进程运行中的取消与修订竞争零残留；HTTP严格 body 和断连取消零残留。
- `npm run typecheck` 通过。

新增有效回归位于 `test/text-batch-cache.test.ts`、`test/text-frame-window.test.ts`、`test/text-raster-batch.test.ts`；旧 cache/runtime tests 保留热帧不暂停、不重新 seek 音视频的要求。

## 实际 GPU 探针

V1 四个按钮已由父任务 Cua 实际点击完成，原始报告全部保留于本证据目录 `v1/`；V2 显式准备方案等待实际复测。

- `artifacts/qa/gpu-rolling-v9/index.html` 的4个按钮独立归档 JSON，模式包含 scalar 冷服务基线、batch 冷服务、保留128张服务缓存三连播、像素/seek/context检查。
- 6秒 1280×720/30fps 原始有声音视频，加180个连续唯一精确文字帧；所有图像预算、buffer/output+decoder drops、HTTP与batch frame数、rAF/visibility/longtask、墙钟及 source drift 原样记录。
- 独立完整 ASS 在蓝底上经 libass 生成11个对照帧，包含31/32/33与64/127/160等窗口边界；不是使用缓存 PNG 作为自己的像素权威。
- 新增 sway 单项 n0/7/8/14/15 与 in.3/loop.7/out.4 组合 n9/20/30/31/108/111 共11帧独立蓝底ASS，检查逐字旋转与入口半/整周期左侧端点。
- context 恢复沿0.8正确 readback：ready 回调中同步读回，再显式同帧 seek 确认。产品仍 `preserveDrawingBuffer:false`。

V1实际结果（完整6秒180帧，不改动目标时钟）如下。scalar有一次外部视频FFmpeg并发采样；batch首轮边界也观察到外部FFmpeg。不能称全机idle或唯一归因；详见 external-compute-observation 与 external-process-boundaries。

| V1 模式 | 显式首窗准备ms | 播放墙钟ms | 输出/解码掉帧 | buffer | 播放新增text HTTP |
| --- | ---: | ---: | ---: | ---: | ---: |
| scalar 冷 | 7629.1 | 42831.7 | 0 / 130 | 173 | 148 |
| batch 冷 | 3381.1 | 12698.8 | 0 / 19 | 22 | 9 |
| batch保留128PNG #1 | 3222.6 | 13580.6 | 0 / 15 | 65 | 9 |
| #2 | 2533.5 | 15758.6 | 0 / 17 | 70 | 9 |
| #3 | 2560.1 | 11107.2 | 0 / 17 | 26 | 9 |

零输出丢帧来自缺帧时显式停住目标时钟，必须连同墙钟和buffer解读；V1仍非实时。cache实际180次解码/148次驱逐，峰值32张、117,964,800B。22个实际GPU文字/新sway/组合像素 maxRGB≤2；context automatic-ready同步与同帧seek确认的完整RGBA均零差。

## V2 显式准备：当前实现

- `setDocument` / `seek` 只自动准备首个有界GPU窗口；不会静默生成整段PNG。只有公开 `prepareTextFrames` / 实际 `play` 才请求 `/textures/prepare`，按接下来最多300个frame descriptor串行生成，单窗口不超过32帧/128MiB。
- 最新(project,revision) lease保护已准备的内容键；新prepare替代旧lease，取消、修订变化、未知字段/诊断不会迟到发布ready。预算不足只返回诚实的partial / requested / completed / uniqueTextures / bytes / reason；随后仍保留原buffer路线。
- 字体、ASS时钟、精确帧和PNG编码未改变。离线分阶段profile的16帧约script88/render655/恢复323/PNG182ms；32帧约101/993/603/370ms。低压缩PNG不足以补上生产吞吐，未用它改变PNG字节契约。此profile与父plane像素页可能并存，不作为运输性能结论。
- 永久PNG缓存256MiB与临时raw盘必须分列：batch黑、白、straight各≤128MiB，最坏约384MiB临时raw（另有该batch PNG），并不声称整个服务磁盘峰值256MiB。Node只持有三个单帧buffer，GPU仍32张/128MiB。
- manifest、性能详情及probe记录完整准备墙钟、完成数和状态。先准备再播放的CPU成本必须单列，不把播放接近6秒称为冷实时渲染。
- 新7项显式准备真实/pure专项覆盖>32帧、lease、文件/字节partial、HTTP严格输入/断连、真实取消/修订/supersede、外部与内部signal合并、旧warm以及迟到结果；38项cache/runtime纯专项通过。额外独立旧static/service 4项与batch 4项均通过；typecheck通过。

## V2真实结果与末帧定位

V2冷准备15,262.9ms，已180/180、180 PNG共4,105,871B；播放6,480.7ms、输出0/解码0，但buffer10。保留缓存三轮播放8,537.4 / 7,067.6 / 6,627.3ms、buffer83 / 32 / 13。所有新增buffer都集中在最后输出帧179/30=5.966667；热batch HTTP约5—35ms、180张只各解码一次，不能据此再将问题归因为冷PNG生产或调整预取水位。

根因是屏幕刷新率下同一已呈现输出帧仍重复prepare，native video到EOF后反复seek/重anchor，目标时钟在末帧附近重绕。V3只令新输出帧执行prepare/seek/anchor，保留每rAF的音频调度与onTime，未改source-boundary hold音轨契约、预取水位、动画、像素或缓存预算。新增两项纯测试先在旧代码失败（末帧13次prepare而非1次），修复后通过。

## V3最终实际结果

所有raw绑定最终 `preview/index.ts` SHA256：`6e3e4b9aab4d8e8af1e1f9b7e9dd83b37f3b8efc7a50a9b791fd792f2b7ff2a3`，并记录完整backend engine标识。Vite重启清module缓存，关闭HMR/watch。父最终314/314测试（98.106s）、typecheck、build:desktop通过后才进行本轮实际Cua测量；团队未同时测试/FFmpeg。

| V3 模式 | 前置准备ms | 播放调用总墙钟ms | anchor后运输ms | 输出/解码掉帧 | buffer |
| --- | ---: | ---: | ---: | ---: | ---: |
| scalar冷基线 | 9115.9 | 44226.5 | 44217.8 | 0 / 127 | 145 |
| batch服务PNG冷 | 15373.0 | 6172.1 | 6017.8 | 0 / 0 | 0 |
| 保留缓存 #1 | 431.1 | 6166.7 | 6016.9 | 0 / 0 | 0 |
| #2 | 354.4 | 6179.9 | 6017.5 | 0 / 0 | 0 |
| #3，异常轮保留 | 598.3 | 6298.4 | 6146.1 | 18 / 44 | 1 |
| 独立追加三连播 #1 | 378.3 | 6187.1 | 6016.4 | 0 / 0 | 0 |
| #2 | 285.2 | 6188.9 | 6032.5 | 0 / 0 | 0 |
| #3 | 296.6 | 6168.2 | 6012.3 | 0 / 0 | 0 |

服务PNG冷准备15.373秒与其后约6秒播放必须共同报告；不是冷渲染达到30fps。显式准备结果180/180、180个内容键、永久PNG4,105,871B。播放仍有19—22次text HTTP（包含一次完整prepare复核和热batch描述符），不能写成零HTTP。7次batch播放中6次输出/解码掉帧及buffer均0；不能删除另1次异常来宣称全程零丢帧。

异常轮有一个633.3ms rAF间隙，18个输出跳帧、44个native解码掉帧和1次buffer（time2.266667）。仍visible且focused，无LongTask记录。父确认该三连播期间有一次中途读取巨大AX树；它与异常同轮，但未将工具时刻精确对齐到gap，不构成因果证明。独立追加三连播期间不读AX，三轮全部无丢帧/无buffer；原始异常和全部复测均保留。正常六轮最大rAF间隙约10.4ms；所有模式起止一次性ps均未见外部FFmpeg，采样不能证明全程没有其他机器负载。

GPU cache始终32张、117,964,800B；每轮180次解码、148次驱逐，没有扩大GPU预算。全部batch播放最大记录source drift39.646ms，静默prepare未创建AudioContext，AudioParam错误0，dispose后音频closed、纹理/bytes/alias清空。只是路由与信号验证，未作听审。

22个实际GPU文字/新sway/组合像素 maxRGB≤2；context automatic-ready同步读回与同帧seek确认均完整RGBA零差。服务冷指删除自有永久PNG缓存，浏览器/OS的全局HTTP、解码或文件缓存未清；新建engine也不能被称为整机全冷。

## 收尾与范围

- 最终raw、汇总、捕获SHA、并发边界与停止证据在 `evidence/2026-10-19-gpu-rolling-v9/`；较大的原始RGBA和完整harness仍在ignored `artifacts/qa/gpu-rolling-v9/`。V1、V2所有慢/失败轮未覆盖。
- 自有server PID63975与observer64527已退出；8838/8839最终普通socket bind均可用，无监听，详见 `service-stopped.json`。未停止外部任务。
- 显式准备只覆盖接下来≤300个descriptor；范围外/预算partial仍可能进入buffer。单clip>300帧或>1080p的exact text继续保守fallback。该局部压力测试不证明所有工程、硬件或剪映5.9.0完整1:1。
