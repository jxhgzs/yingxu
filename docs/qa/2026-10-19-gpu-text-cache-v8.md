# 0.8 精确文字缓存验证

本项沿用 0.7 的完整 libass RGBA 当前帧，不改变字体、ASS 布局、透明度或目标时钟。新增的是有界准备和已解码 PNG 的复用，不能据此声称完整剪映实时性能一致。

## 实现和边界

- `TextFrameCache` 以工程 ID / revision 隔离；clip / mode / 输出 frame 对应描述符，URL 对应已解码 `DecodedMedia`。不同帧的相同内容不重复创建图片。响应严格核对 clip、revision、mode、frame 和画布尺寸，只接受已登记本机 text-renders URL。
- 最多 32 张独立解码图片、128 MiB RGBA 估算，以及每 clip 300 个帧别名；setDocument / seek 在前方最多 300 输出帧内顺序静默预热。预算不足即停止，保留已准备的开头；前景冷请求只驱逐未被当前资源引用的图片。
- 已知预算边界不会在每次 seek 反复请求；真正驱逐或 reset 后才重新评估。原有媒体缓存上限另行保留。
- 命中 ready 的文字直接切换到缓存图片，不因 frame 编号变化而暂停 / 重 seek 视频或音轨。GPU 每个 clip 仍只占一个当前 GL texture；URL 变化才重新上传，相同 URL 的 hold 帧不重复上传。
- setDocument / seek / `prepareTextFrames` 不创建或启动 AudioContext。播放按钮准备尚未完成的文字时长以 `coldTextPrepareMs` 单列；真正播放中冷 miss 仍执行原有安全 buffering，不改慢播放来隐瞒。
- reset / dispose 使旧 provider 和 decode 结果无法写回新修订，释放已解码图片。WebGL context 恢复时重用有效图片，但重建失效 GL 句柄。
- 128 MiB 是缓存解码 RGBA 的估算预算；每 clip 当前 GPU texture、视频解码器和已有 transition framebuffer 的内存由原有指标另外记录。没有宣称整个进程只占 128 MiB。

## 回归

Node 24.18.0：40 项针对缓存、GPU plan / runtime / color / transitions 和曲线音频的回归通过，类型检查通过。新增覆盖同内容帧复用、真实 prepare 热路径不暂停或 seek、URL 切换后的 GPU 上传、两类预算、每 clip 别名限制、错误描述符、迟到 provider、迟到 image decode、重置跨工程隔离、并发消费者取消。

原始日志：`artifacts/qa/gpu-text-cache-v8/targeted-tests.log`。全量测试和桌面打包由总集成单独登记。

## 实际浏览器检查

自有服务为 8838 / 8839，实际按钮由父任务通过 Cua 操作。自有 probe 使用 0.7 最终重开文档的同一 640×360、30fps、3 秒有声视频 / 2 秒文字工程，仅更新注册素材身份、路径与测试标题。原有打字机入场 0.5 秒、渐隐出场 0.5 秒和文字目标区间 0.5—2.5 秒均保留。

另用同一文字层和无损纯色背景，对 10 个实际输出帧与未编码 libass RGB 参考逐像素核对。冷准备时间、准备阶段 AudioContext 数、播放墙钟、播放中请求 / buffering / 输出跳帧 / 解码掉帧、实际 AudioParam 异常分别记录。该检查没有作听审，不把未编码 RGB 对照冒称编码 MP4 或原生剪映全像素一致。

各轮实际结果如下；初轮原始结果为 `artifacts/qa/gpu-text-cache-v8/result.json`，后续各轮独立命名，未覆盖。

### 第一轮实际结果（独立保存，不覆盖）

2026-10-19 19:19（UTC+8），父任务实际 Cua 两次点击完成，真实 Apple M3 / ANGLE Metal WebGL2。纯证据见 `evidence/2026-10-19-gpu-text-cache-v8/first-browser-result.json` 与精简 `first-browser-summary.json`。

- 首个文字像素工程冷准备 **3536.4 ms**；同一 0.7 有声工程随后准备 **194.2 ms**，后者使用已由第一个工程生成的服务端内容缓存，不能称第一次冷渲染只需 194.2 ms。
- 两次 setDocument 各 60 个帧描述符（全局帧 15—74）、21 个唯一 URL；累计 **120 requests / 42 decodes** 正是两次工程修订隔离。当前工程只驻留 **21 张 / 19,353,600 RGBA 字节 / 60 aliases**，不是同时存 42 张。
- 10 个实际输出帧对未编码 libass RGB：最大 **1 码值**，最坏平均 **0.0044907407 码值**，alpha 差 0。未以截图、gamma 或编码差异拟合。
- 准备阶段 AudioContext 数 **0**。实际播放新增 HTTP 请求 **0**、中途 buffering **0**、原生 AudioParam 异常 **0**。
- 3 秒工程从播放点击到完成 **3079.3 ms**；启动准备 **15.7 ms**，其后到结束观察 **3063.6 ms**（含末帧 seek / 状态观察）。`coldTextPrepareMs` 这次为 **1.8 ms**，因为文字已预热。
- 输出跳帧 **2**、视频解码掉帧 **2**，最大观测源偏移 **50.719 ms**。保留实测缺口，不能称零掉帧、声音完全一致或达到全量剪映性能。0.7 桌面记录曾见 53 个 decoder dropped frames，但当时没有同一 probe 的播放墙钟，不计算倍率。
- dispose 后缓存 textures / bytes / aliases 均为 **0**，音频已关闭；未作实际听审。

循环/组合文字的 libass 事件边界正在由独立实现收敛，届时用新参考另跑新结果；本轮原始报告和 SHA 清单独立保留。

### 第二轮：新字幕时钟、循环/组合、共享 PNG

原始 `result-v2.json` 已独立保存为 `evidence/2026-10-19-gpu-text-cache-v8/second-browser-result.json`，精简结果和全部 raw capture / reference SHA 分开存档。使用新 `subtitleClock` 构建 libass 权威参考，服务也重启以加载同一代码，未覆盖第一轮。

47 个实际 GPU 输出帧：原10帧、循环11帧、渐显0.3秒 / 渐隐0.4秒 / 闪烁周期0.5秒组合12帧、同组合带描边阴影精确帧12帧、两文字片段共用 PNG 的2帧。原/循环/中性组合最大差1；描边阴影精确组合和双clip共享最大差2。组合敏感边界frame111已单独覆盖。精确组合120别名只需27张 / 24,883,200 RGBA字节；两个同时可见clip实际仅1张 / 2别名，两个GPU slot正确合成。

第一次原文字准备4928.5ms，精确组合准备4937.4ms；neutral循环211ms，neutral组合18.4ms，共享PNG206.5ms。不同case的服务端内容缓存状态不同，这些数字不能当作同条件性能排名。

同3秒有声工程第二轮点击到完成3068.8ms，启动45.1ms，随后观察3023.7ms；播放请求0、bufferEvents0、AudioParam异常0，准备阶段AudioContext0。**输出跳帧19 / 解码掉帧30**，比第一轮2/2差。父任务确认当时与原生circle/GPU/编码取证重叠，其他worker也可能执行FFmpeg；并发条件记录为潜在影响，尚不能唯一归因。保留两轮结果并安排无本任务重计算重叠的独立复测。页面 `pass` 只判定像素门槛、播放完成、缓存命中和无AudioParam异常，不包含零掉帧条件，不能借此冒称实时表现完美。

### 满预算 warm / foreground 并发修复

父任务审阅发现一个实际边界：foreground 可加入同 key 的 warm pending；warm 已满预算返回 undefined 时，旧实现会直接报预算错误，即使 foreground 原本可安全驱逐。现为同一 epoch、未取消的 foreground 安全重试一次 nonwarm 请求，按 Promise 身份清除已结束 pending，仍保留 pinned 图和预算约束。专门 deferred-provider 回归确认 warm 停止后 foreground 驱逐旧图成功；缓存 / transport / runtime 23 项定向复验通过，日志 `artifacts/qa/gpu-text-cache-v8/pending-warm-regression.log`。没有把 warm 改成驱逐开头帧。

### 第三轮准备与 context readback 失败（保留）

新运行时冻结后，第三轮25帧实际GPU准备完成：1280×720画布的闪白、向左擦除、圆形打开共15帧，对本浏览器真实解码的两个源buffer及独立CPU混合/空间mask，完整RGBA最大差0；8组新黑白场/褪色/组合调色对RGB8网格上的core连续数学，最大0.5000075698码值，未放宽0.502门槛。该对照不消除原生YUV420边缘色度与编码差异，不等于原生空间转场完整像素一致。

文字真实context恢复后，manifest为ready / frame20 / 同decodedTime 0.666667，缓存21图、HTTP新增0、AudioContext未初始化，但在等待状态完成后再读取framebuffer，最大RGB差255、均值62.08705295。因此尚未启动三连播，原始失败保存在 `third-prepare-context-readback-failure.json`。因产品使用 `preserveDrawingBuffer:false`，跨presentation后buffer可能已清空；这只是待验证测量假设，第三轮未保存单独before/after raw，不能直接抹掉失败。

第四轮独立probe追加onState(ready)同步自动恢复捕获、跨presentation延迟捕获、显式同帧seek后立即捕获，三种结果和原始RGBA分别保存。产品和preserveDrawingBuffer设置未修改；复用第三轮的25帧参考，不重复生成。

### 第四轮：同步恢复证明及空闲三连播

父任务暂停所有本任务FFmpeg/REA/测试/桌面导出后，实际Cua完成第四轮。运行时为 `acabce7`，只修改独立测量probe，没有更改产品或重构桌面包。结果、精简总结和raw/SHA分别在 `fourth-browser-result.json`、`fourth-browser-summary.json`、`fourth-evidence-index.json`。

闪白/擦除/圆形打开的15个实际1280×720 GPU帧对两个实色源的真实解码buffer及独立数学mask仍最大0；8组新调色最大0.5000075698码值。此处实色源用于检查shader的混合与空间遮罩，不替代原生复杂素材/编码边缘对照。全10项调色混合是产品数学/GPU一致性case，未冒称这一组合已原生实测。

context恢复的实际自动 `ready` 回调中同步读取，以及显式同帧seek→立即读取，均与丢失前frame20完整RGBA逐字节相同，SHA也相同；延迟30ms的buffer **全部RGB为0、alpha255**，重现第三轮最大255/均值62.087的读回。已证明这是 `preserveDrawingBuffer:false` 在presentation后的buffer清空，产品自动恢复本帧正确。保留原失败与三路raw证据，没有改变保留buffer设置来绕过。恢复新增HTTP0、缓存仍21图、AudioContext未初始化。

第三轮首次文字准备 **3491.5ms**；第四轮同内容服务端已热，准备 **159.1ms**，分开报告。当前21张 / 19,353,600估算RGBA字节 / 60帧别名，准备阶段AudioContext0。

独立三次3秒有声工程实际点击→完成：

| 轮次 | 点击到完成ms | 启动准备ms | 启动后观察ms | 输出跳帧 | 解码掉帧 | 播放HTTP | 中途buffer |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 3088.4 | 16.9 | 3071.5 | 0 | 1 | 0 | 0 |
| 2 | 3063.2 | 3.5 | 3059.7 | 0 | 1 | 0 | 0 |
| 3 | 3056.4 | 3.3 | 3053.1 | 0 | 1 | 0 | 0 |

每轮页面始终visible/focused，rAF样本184/184/183，最大间隔18.8/18.8/18.7ms，95分位18.6/18.5/18.2ms，>33.4ms次数均0，longtask记录均空。原生AudioParam异常0。累计最大观测源偏移 **53.944333ms**，仍有每轮1个decoder dropped frame；不能称全链路零掉帧、长工程性能或音频完全一致。此前并发实验第二轮19/30与首轮2/2均保留，没有用最佳一轮替换失败/波动。

dispose后cache textures/bytes/aliases均0，音频closed。未实际听审。第三/四轮时间来自实际ISO时间与performance.now，不按导出文件名标签推断。

取消补充：provider恰在同步调用内abort消费者时，也立即观察底层Promise，迟到provider拒绝不成为unhandled rejection；连同warm-pending并发修复，缓存/transport/runtime最后24项定向通过。最终全量268/268、9基线、桌面构建由父任务独立验证。

自有探针已在父任务关闭全部页面后停止：PID26173已退出，8838/8839实际绑定检查均空闲。停止记录 `evidence/2026-10-19-gpu-text-cache-v8/service-stopped.json`。没有改动生产映序或原生剪映草稿。
