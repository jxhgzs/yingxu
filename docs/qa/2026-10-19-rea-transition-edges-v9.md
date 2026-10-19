# REA与空间转场色度边缘收敛（0.9）

2026-10-19。固定剪映专业版5.9.0；复用0.8同画布原生参照，没有重新解释普通UI的false模式。向左擦除、圆形遮罩仍只接受已核资源身份、`is_overlap=true`受控模式、1280×720、30fps、1x及既有handles规则。普通UI保存false而实际硬切的证据继续有效，不能据此宣称普通UI效果已1:1。

本轮改善了极端彩边，原生全图最大误差仍未归零。没有放宽0.8阈值，没有从全图结果排除边缘。0.8原始报告及数据保留。

## 新REA调查

复用SDK切片SHA-256 `60a4d61ec74ee6cd4d231f1d06cbb91e89bac955c127de0852c970c73b143623`与Ghidra12.1.4已有profile digest `91c686ab53c5977fe77a89d6c59aac868cdd9c32600720bc7b674ad27ffbec14`，自有会话位于ignored `artifacts/rea/transitions-v9/`。未安装或改注册配置，未复制闭源代码到产品。

11次新调用含session/open、定向字符串/过程搜索、地址上下文、dispatch metadata、overview、两次export及close。观察到定义字符串`RgbaToNV12_2`（`0xe19023`，Evidence `ev_d14b3a250569b3c9bb916b35c0a0918efc5e976bb08e2491f34c7be5a71cd4ff`）与`innerRenderNV12`（`0xe6688b`，Evidence `ev_7b553c348db1eea842be7f6a639789a35b10bb9f2fd89c52f2564696816020bf`）。这些是已发布二进制中的名字观察，未恢复或执行相关转换算法，不能证明实际转场必经该阶段。

`inspect_native_dispatch_metadata(max_records=20000)`的producer完成，但响应超过10MiB传输上限。未重复producer，直接export保留的Evidence `ev_9e43cdca6b02b7487c36da46ab27b4228710a0cb7cf44c2e0868bff1f98dd7f9`；覆盖为partial/max_records_reached。这个有界结果中未找出转换函数，不能推断SDK不存在它。最终export成功、close成功、STOP后helper退出0。纯观测索引见 `evidence/2026-10-19-transition-edges-v9/rea-observations.json`；私有原文只留ignored。

## 独立平面模型

复用原生18/19同画布MOV，首尾帧分别作为同一输出编码链内A/B端点。Y平面在完整画布的`(x+.5,y+.5)`判断；U/V在`(2x+.5,2y+.5)`判断。擦除仍是线性水平阈值，圆形仍是画布像素域径向阈值；时钟和方向不变。Y与UV可能选择不同侧，例如擦除第61帧，`x=597`的Y取B，色度块锚点`x=596.5`仍取A。

将选源后的原生端点YUV420交给FFmpeg重建RGB，未重新H264编码：

| 全图31帧（45—75） | 0.8直接选RGB端点 MAE/max | 独立YUV选择后RGB重建 MAE/max |
| --- | --- | --- |
| 向左擦除 | 0.244411 / 229 | 0.188711 / 27 |
| 圆形遮罩 | 0.288908 / 230 | 0.212899 / 43 |

全部像素包含在统计中；使用的是已经编码的首尾端点，未拿到原生编码前surface，不能把残差全归因压缩。模型支持色度独立选源与相位解释，未证明SDK内部具体通路。证据 `native-yuv-rgb-reconstruction.json`。

## 产品有界实现

共享核心 `transition-edge.ts`提供phase、完整像素域mask、BT709矩阵、GPU参考重建和资格函数。新`Asset.pixelFormat`仅允许视频素材填写，并验证格式字符串；`probeAsset`直接记录ffprobe真实`pix_fmt`。有限无alpha白名单目前包含常用8位YUV、NV12/NV21、RGB24/BGR24/gray。缺字段、未知格式、RGBA/ARGB/YUVA等均不准入；没有用扩展名、视频类型或opacity=1猜测源alpha。

资格进一步限定唯一空间转场、恰好两个可见视频片段、源与画布同1280×720、默认变换、片段opacity=1、无视觉关键帧/文字动画/非零调色/非零vignette、709/tv色彩解释。其他组合保留原RGBA路径。音量动画不改变视觉资格。正常素材注册会填写格式；相同SHA、类型、尺寸的旧登记可刷新缺失格式，保留原路径、名字和已验证CFR。尚未正常probe/关联的旧导入素材不会获新策略。

CPU使用现有`accurate_rnd+full_chroma_int`色彩转换得到两侧YUV420，在各平面独立mask，保持混合YUV直到最终编码；避免把跨侧YUV先转RGBA裁剪再转回YUV。最终YUV overlay在原序列时钟合成，再做范围导出trim。滤镜clock、handles、音轨和既有资源准入未改变。`transition-edges.json`记录实际获准转场ID。

GPU使用同资格、phase/mask/709矩阵。只有实际1280×720 FBO启用；缩小实时预览保留既有路径。top-origin像素位置的2×2左上中心决定UV源；当Y/UV选不同侧时，从已解码两侧FBO重建RGB并夹到显示范围，其他像素原RGB保持。CPU的swscale预滤和GPU已解码RGB采样不是同一素材读取链，不能称二者逐像素一致。

## 实际产品编码对原生

真实产品按相同4秒工程、H264 CRF18/preset veryfast/709tv/yuv420p导出。原生输出和产品输出均实际解码为RGB。45—75帧全像素纳入；边缘3px指标另列，不能替代全图。

| 效果 | 0.8 全图MAE/max | 0.9 全图MAE/max | 0.9 边缘MAE/max | 0.9 非边缘MAE/max |
| --- | --- | --- | --- | --- |
| 向左擦除 | 1.180261 / 150 | 1.134175 / 67 | 3.087316 / 51 | 1.125423 / 67 |
| 圆形遮罩 | 1.192664 / 239 | 1.128594 / 109 | 6.816558 / 109 | 1.083608 / 68 |

非边缘旧MAE分别1.121658、1.079676；新值略高，不能只报改善。首帧MAE均1.288693；末帧新值0.921433/0.897085，端点本身已有颜色/编码差。圆形边缘最大109仍未解释完，未声称逐像素等同、原生AA恢复或编码差全部可解释。0.8曾发现的少量远离边缘luma分类残差不因此自动作废。

实际产品路径为ignored `artifacts/qa/transitions-v9/product-{wipe,circle}/render.mp4`。纯统计含各帧MAE/max、来源SHA及完整边缘指标，见 `product-native-encoded-comparison.json`。产品导出后进一步收紧pixelFormat资格；实际不变grid源由ffprobe确认`yuv444p`，同一转换/混合/编码分支仍获准，见 `source-opacity-qualification.json`。这项后加门槛没有改已测滤镜数学。

候选滤镜先于产品修改验证。nearest色度候选虽减少最大彩边，却使非边缘MAE上升较多；未选用。保留现有转换参数的候选才进入产品，完整失败与采用数字见 `prototype-comparisons.json`。

## GPU数学与真实执行分别记账

用原生解码首尾RGB模拟新GPU数学（全部像素），擦除MAE0.188857/max27，圆形0.213006/max43；旧RGB选择分别max229/230。见 `gpu-contract-native-endpoint-emulation.json`。它是CPU仿真，不是浏览器实际GPU结果，不证明浏览器解码颜色或GPU帧率。真实GPU由父任务实际点击新QA页，后续实测补充如下；本段CPU仿真仍不等同真实执行。空闲连播和缓存性能另由父任务/GPU子任务统一记录。

## 验证

新增专项测试覆盖alpha/unknown不准入、资格不变性、2×2中心与等号方向、709重建、实际CRF18导出在跨侧像素保留B亮度/A色度，以及范围导出保留原时钟。另测真实alpha MOV的probe字段、旧注册刷新和身份不符拒绝。RGB重建超范围在显示端明确clamp；CPU保持YUV避免该裁剪往返。

此前空间/预览11项通过；GPU runtime与首轮新边缘16项通过。最终新增像素格式/边缘/clone回归12/12通过（14.433秒），最后typecheck通过；命令与文件摘要见`completion.json`。专项CRF18测试保留对选源端点的误差与远端距离约束，没有把有损编码当作未压缩逐值相等。全量测试、桌面包及真实GPU由父任务统一完成。


## 父任务真实点击：新策略GPU全图验证

2026-10-19 13:12:40—13:12:50 UTC，父任务通过Cua真实点击独立QA按钮。实际Apple M3/ANGLE Metal，`softwareRenderer=false`；不以模拟器结果代替真实GPU。新页读取当前产品WebGLCompositor两个持久FBO、最终default framebuffer以及实际mix程序的`u_planeEdges`/`u_spatialKind`，没有修改产品源码来注入结果。

每个效果取45—74帧共30帧，全图1280×720、每帧921600像素，合计165888000个RGB分量参与数学检查。60帧均实际呈现目标帧，实际plane uniform=true、策略标记有效、源FBO alpha全部255；两种unknown负例沿用相同媒体但删除pixelFormat，策略为空、实际uniform=false，旧RGBA数学误差均0。源格式由真实ffprobe取得yuv444p，未按扩展名猜测无alpha。原生MOV另由浏览器DecodedMedia与2D srgb画布读取，30/30 native `decodedTime`均可观测，时间戳距`n/30`最大0.334微秒（原记录保留）。

| 实测对象（全图30帧，不排边缘） | 擦除 MAE / max RGB | 圆形 MAE / max RGB |
| --- | --- | --- |
| 最终GPU vs 独立CPU数学（输入为实际两侧FBO） | 0.00009012 / 0.497406 | 0.00013937 / 0.497406 |
| 最终GPU vs 浏览器解码原生实际帧 | 1.548541 / 110 | 1.593994 / 150 |
| 最终GPU vs 浏览器原生RGB首尾新模型 | 1.566329 / 123 | 1.563641 / 123 |
| 浏览器原生实际帧 vs 其首尾新模型 | 0.208971 / 73 | 0.277694 / 150 |
| 浏览器原生实际帧 vs 其首尾旧RGB模型 | 0.244608 / 212 | 0.312481 / 226 |

第一行证明本次受限shader正确实现独立数学约定，超过1LSB的RGB分量为0；它不证明原生1:1。原生列仍有大量差异：实际GPU对原生擦除超过3LSB的RGB分量5778864个，圆形5835400个，均保留在统计中。

擦除实际原生最坏点为第45帧`(2,362)`蓝色分量，GPU224/原生114，差110；它在进度0已存在，不能把全部差异归于跨侧mask。圆形最坏为第65帧`(170,222)`红色分量，GPU30/原生180，差150。原生浏览器帧对自己的首尾新模型仍有73/150最大残差；目前不能区分读取链的色度重建、预滤、原生编码边缘等贡献，未以口头归因消除差异。

本次浏览器2D/srgb原生读取与此前FFmpeg YUV/RGB重建不是相同读取链，而且帧集合分别为45—74与45—75；不能把本次73/150最大值与此前27/43直接当同一基准的改善/回退。两套数据都保留。实际产品编码对原生的67/109也仍是单独一项，不能拿GPU数学小于0.5覆盖。

原始完整结果复制为`actual-gpu-plane-result.json`，包含每帧manifest、所有误差/最坏坐标、源身份和实际加载源码SHA；归纳及12份原始RGBA的字节数/SHA索引为`actual-gpu-plane-summary.json`。选定擦除61与圆形60的A/B/final/native全图、两种原生首尾图仍保留ignored原始目录。未执行FFmpeg或原生UI，也未将本次逐帧seek/readPixels的耗时当作实时帧率。

完成后engine状态disposed，FBO数/字节/缓存媒体均0、decoder列表为空，AudioContext未初始化。父任务明确不再使用后，核对PID52430确为自有`plane-edges-v9/server.mjs`，仅对该PID发送TERM，随后ps确认进程不存在；没有操作8838/8839或其他任务。后处理仅改本文档与证据，没有改产品源码或测试。


## 补充：显示矩阵资格漏洞与有界修复

父任务指出pixelFormat只能证明无alpha，不能证明coded尺寸等于显示方向。本次独立复核用自有grid以`-display_rotation:v:0 90 -c copy`生成新MP4。180个压缩视频包的有序SHA与原始文件全部一致，未重编码；容器时钟不声称完全相同。ffprobe仍报告1280×720/yuv444p，同时带90度Display Matrix。修复前probeAsset没有记录方向，新的plane资格与实时plan均错误准入。两次单帧FFmpeg showinfo观察均为720×1280输出，证实autorotate确实改变显示几何；未运行浏览器或整片导出。

首次只写`-metadata:s:v:0 rotate=90`的候选没有生成Display Matrix/rotate tag，未作为旋转证据。另用布尔flag `-display_vflip:v:0`流复制得到matrix `[65536,0;0,-65536]`，ffprobe的rotation为0，但实际是反射。因此仅检查rotation非零会漏掉它。最初测试误给flag附带1参数而失败，修正后才验证真实零角反射，不把失败候选冒作有效fixture。

经父授权，新增可选`Asset.verifiedDisplayTransform: identity|unsupported`，严格限定image/video。probeAsset从实际stream记录该标记：任何Display Matrix（含报告rotation0者）或非有限/非零rotate均unsupported；无这些已观测变换才identity。缺字段是unknown，不能自动视为identity；plane策略只接受identity。旧未知工程继续原RGBA行为，不在plan/render中悄悄补证；正常注册重新probe后才可按同SHA、媒体kind与尺寸身份刷新旧登记，保留原path/name/CFR。pixelFormat与方向标记共用该刷新身份约束。

新plane输出还会在实际渲染前fresh probe源的coded宽高与display transform，使用同一helper、传入取消信号并在前后检查取消。即使调用方伪造identity，真实rot90和零角反射的导出都以`SPATIAL_TRANSITION_SOURCE_ORIENTATION_UNSUPPORTED`拒绝；伪造尺寸以`SPATIAL_TRANSITION_SOURCE_SIZE_MISMATCH`拒绝。非零vignette的fresh probe已复用同一helper，其旧方向错误码保留；vignette GPU面对已知unsupported标记明确拒绝。普通路径保留既有行为。

修复后真实原grid经probe为identity，新plane仍获准；两个旋转/反射输入均unsupported、plane策略为空，未把旧RGBA继续可用写成方向一致性获证。专项14/14、共享helper后的vignette-media2/2、typecheck通过；覆盖严格字段类型/kind、unknown不升级、实际零角反射、伪造标记CPU拒绝、尺寸复核、取消与旧登记刷新。完整修复前/后观测和失败fixture记录见`orientation-qualification-review.json`。

上一节实际GPU60帧是在此方向门槛新增前采集，原始结果与源码SHA保留不改。新增门槛没有改变已测shader数学；正常grid现已重新真实probe并补identity到QA夹具，未声称门槛之后再次做过GPU执行。此修复没有消除既有原生像素残差。
