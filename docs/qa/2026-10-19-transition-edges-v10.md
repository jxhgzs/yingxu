# 转场边缘分层调查（0.10）

新实现仅在原有严格资格通过、双方真实 probe 为 yuv444p、预览实际1280×720时启用完整420色度重建；CPU编码路径保持0.9。父任务已在真实 Cua 页面点击完成60帧全图验证：新GPU对原生最大RGB差为35/39，仍有明确残差，不能称为剪映1:1。

固定参照剪映5.9.0，复用已核资源、受控 `is_overlap=true` 模式、720p30、原速、无alpha、identity显示方向证据。普通原生 UI 新建转场得到的 false 模式仍保留硬切事实与诊断。本轮没有新增原生 UI 操作或改写其草稿。

## 分层结论

最明显的0.9 GPU残差来自重建阶段仍只处理跨侧像素，没有复现整幅420色度足迹。用既有6张真实浏览器读取（wipe0/61/119、circle0/60/119）检查5种有固定物理意义的候选：原生MOV解出的YUV420，按BT709 limited8与中心/中心双线性重建，全图最大差均为1；nearest或其他半像素相位最大差28—124。未排除边缘，也没有调整阈值或拟合权重。该结论只说明当前设备/浏览器读取路径，不证明SDK内部执行了同一算法，文件 `chroma_location=left` 标签也不能替代实际读取证据。

新的源色度降采样采用固定可分离 `[1,3,3,1]/8`，偏移−1/0/1/2；与point、box2一并比较。来自真实0.9源FBO的RGB，转BT709 limited8、按旧遮罩选择Y/UV、整幅中心双线性重建后，对原生解码YUV的同一重建参照，60帧全图离线结果如下。**这是CPU运行的候选模型，不是实际GPU结果。**

| 固定源足迹 | wipe MAE / 最大RGB差 | circle MAE / 最大RGB差 |
| --- | --- | --- |
| point | 0.797023 / 56 | 0.78675 / 59 |
| box2 | 0.799964 / 56 | 0.78832 / 57 |
| bilinear4 | 0.686849 / 35 | 0.660351 / 39 |

原始源YUV444直接转420后，对native第0帧仍有Y最大10、UV最大35/31；RGB往返UV最大40/36，直接FFmpeg bilinear为27/22。真实FBO经固定bilinear4降采样的UV对native端点，A最大27/22、B13/17。源细线/编码残差已在遮罩前存在；不能将剩余35/39全部归为遮罩或全部归为编码。

## CPU编码候选没有进入产品

保持0.9时钟、遮罩、完整120帧输出、libx264 veryfast CRF18与709/tv，仅在转场两侧尝试去掉RGB往返的两个直接YUV候选。相同读取器对比原生、包含完整45—75帧窗口和全部边缘：

| 路径 | wipe MAE / 最大RGB差 | circle MAE / 最大RGB差 |
| --- | --- | --- |
| 已有0.9产品 | 1.134175 / 67 | 1.128594 / 109 |
| direct-bilinear候选 | 1.021618 / 73 | 1.006200 / 105 |
| direct-accurate候选 | 1.079848 / 73 | 1.079398 / 105 |

候选降低均值但wipe极值67→73变差，因此没有采用。四份候选、全部比较JSON和命令记录保留；首次命令错用单输入而filter引用两输入，FFmpeg在输出前失败，修正为两个明确输入后四次成功。CPU产品仍保留67/109及其原始未解决差异。

## 实装范围与资源代价

`spatialReconstruction()`从已验证资格推导 `centered-bilinear444-v2`，不增加可由外部工程随意声明的持久化开关。双方必须为真实已登记yuv444p，已有尺寸、709/tv、原速、单转场、无变换/非零调色/暗角/动画、不透明与identity方向规则全部保留。420等其他已知格式仍用0.9路径，未知格式不静默升级；缩小画布也不启用新路径。

Y遮罩仍在全分辨率像素中心取值，UV遮罩仍在每2×2左上像素中心取值。新增640×360 RGBA8 UV FBO一次完成每色度像素16tap源采样，然后主混合pass用LINEAR纹理采样进行中心重建，避免每全画幅像素重复64次源采样。双方源FBO后增加一个pass：每draw共4 drawCalls、3 framebufferPasses；FBO从2个7,372,800字节变为3个8,294,400字节，增加921,600字节。纹理文字缓存预算不变。额外成本已明确记录，每draw实际计时见下；本页面没有测连续播放FPS。

核心提供独立可测量的CPU标量合约与GPU共享常量。`reconstructSpatialEdge`原有两参数行为保留。生命周期测试覆盖复用、改尺寸退旧路径、dispose释放、context失效后的abandon与新compositor重建，旧实例dispose不得误删新资源。

## 回归与实际验证入口

先用独立Python标准公式给定两个颜色、wipe第61帧两侧像素，写出中心重建期望；旧实现因只处理交叉侧像素失败（保留 `old-failure.log`），随后实现通过。专项19/19通过，typecheck通过；最终补充context重建测试后14个轻量回归再通过。父任务统一执行全量和build。

真实GPU入口为 `http://127.0.0.1:8841/artifacts/qa/plane-edges-v10/`，唯一按钮“运行0.10重建与GPU计时验证”。无HMR/watch、无自动执行、无render jobs。prepare仅做ffprobe/hash/JSON，双方真实yuv444p和方向资格均核验。实际60帧全图会分别记录：半分辨率UV表面误差、从实际UV重建误差、独立完整CPU模型误差、新/显式v1同源控制对原生MOV读取差、每次正式product draw的CPU时间与GPU timer query；seek和QA参考计算耗时单列，不能当实时FPS。未知格式必须退旧路径。源与QA代码哈希已冻结，见 `gpu-qa-prepared.json`。实际点击已完成，具体结果如下。

## 真实GPU结果（父任务Cua点击）

2026-10-19 22:35:48—22:35:59，ANGLE Metal Apple M3、WebGL2、srgb/RGBA8。父任务在全量338项、9项基线与build通过、其他GPU任务停止后实际点击。每种30帧45—74、每帧921,600像素全部保留；没有排除边缘。全部source alpha255、新/旧模式uniform及未知拒绝检查通过，实际半分辨率UV与独立CPU逐码相等（max0），最终FBO与独立浮点数学最大0.4999847412，符合RGBA8量化。正式readPixels的GL错误检查没有失败，结果无error字段。

| 真实同源对原生浏览器MOV读取 | wipe MAE / 最大RGB差 | circle MAE / 最大RGB差 |
| --- | --- | --- |
| 页面显式v1控制 | 1.548541 / 110 | 1.593994 / 150 |
| 新v2完整重建 | 0.686850 / 35 | 0.660353 / 39 |

GPU独立query均有效，共新/旧各60次；无disjoint或超时。每次query覆盖正式product draw，CPU记录也来自同次draw；以下不是整段播放FPS。

| 计时 | wipe新 / v1 | circle新 / v1 |
| --- | --- | --- |
| GPU均值ms | 1.620093 / 1.410884 | 1.719549 / 1.499013 |
| GPU p95 ms | 1.903249 / 1.727249 | 1.907791 / 1.702041 |
| GPU最大ms | 2.416666 / 1.859750 | 1.948416 / 1.899000 |
| CPU p50 ms | 2.5 / 1.7 | 2.5 / 1.7 |
| CPU p95 ms | 2.6 / 1.9 | 2.7 / 1.9 |
| CPU最大ms | 313.9 / 2.2 | 2.9 / 2.3 |

首个wipe新draw包含冷路径编译/分配，CPU313.9ms，30帧均值12.85ms，完整保留；circle已复用程序/资源，CPU均值2.5ms。GPU新策略比v1均值增加约0.21/0.22ms，CPU warm也有额外开销。不能用warm数字掩盖冷成本或将阻塞seek/全图readback脚本当实时性能。FBO始终3个8,294,400字节、仅3次分配；未知模式退旧路径；dispose后count/bytes/缓存均归0。源/QA哈希与准备时完全一致。

原始结果、summary、实际case、独立reference与probe已进入纯证据。raw RGBA保持ignored，以SHA索引记录。0.9 CPU编码保持67/109；不能把此GPU读回改进当作CPU编码达到同等结果。

## 真实三FBO context丢失与恢复

父任务随后实际点击独立 `context.html` 按钮；产品及原60帧probe/reference哈希均未改。circle第61帧三个FBO（8,294,400字节）实际生效后触发 `WEBGL_lose_context`。丢失事件中旧compositor已abandon为0；恢复时产品自动重新建立compositor并seek原位置。QA在**自动ready回调内同步取全帧RGBA**，此前没有显式seek或diagnose补画；恢复第61帧与丢失前逐通道完全一致，最大差0、changed0。

三个旧texture/FBO句柄均不再有效，三个新句柄均有效，查询GL错误为0。再显式seek第62帧成功，pause后所有媒体暂停且帧保持62；dispose后FBO计数/字节和缓存均0，GL错误0。真实状态经过context-lost→paused→loading→ready，contextLosses=1；原始结果完整保留，不将context恢复测试当性能测量。证据为 `actual-gpu-context-result.json`、独立harness和冻结哈希。

## REA新调用与限制

独立会话 `artifacts/rea/transitions-v10` 共10调用，沿用已核SDK切片/profile，无新安装配置。观察到MPSImageBilinearScale导入名、`RgbaToNV12_2`、`_chromaTexture`、格式化Metal库名；对应conversion procedure和两处xref结果为空。Reference analyzer未启用，空xref不是无实现证明；符号名不是运行路径或采样参数证据。因此本轮物理模型依据真实读取数据与公开数学合约，未伪称从二进制恢复算法。

export完成（6条记录、37,768字节），close成功，STOP存在，helper exit0。纯观测/限制摘要见 `rea-summary.json`；私有二进制和REA工程保持ignored。

## 尚未解决

CPU同编码67/109保持；GPU新增重建已实际通过独立数学验证，但对原生仍有35/39局部差。实际35/39仍为可见残差，源降采样、解码及编码影响没有完全分离。未覆盖其他格式/画幅/设备/转场资源，不能称完整剪映5.9.0复刻。

纯证据位于 `evidence/2026-10-19-transition-edges-v10/`：全部有限候选、端点平面、6张真实读取的重建对照、60帧模型、四次编码比较、旧失败回归、REA摘要和SHA索引。未删除失败/未知，也没有放宽旧门槛或忽略边缘。

父任务关闭两个QA页后，已仅对自有8841服务PID89357发送SIGTERM，exec会话记录退出143；ps确认PID不存在，8841连接被拒绝。两张父任务真实Cua截图保留，清理记录见 `qa-server-cleanup.json`。没有操作8838/8839或其他任务。
