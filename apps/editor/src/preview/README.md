# WebGL2实时预览实现与接入

已批准的独立编辑器设计适用。以下保留初轮调查过程，当前已验证色彩/转场事实以 `docs/qa/2026-10-19-effects-transitions-gpu.md` 为准。

2026-10-19后续扩展：静态文字通过 `textTexture(clipId, {projectId,revision}, signal)` 按需取得libass透明PNG，不预渲整部工程。`setDocument(document,{textContext:{projectId,revision}})`开启这条路径；未连接服务、文字动画或文字曲线明确转后台。PNG烘焙原画幅位置/变换/opacity，GPU只应用identity，资源仍保留原text身份，纹理只上传一次。黑/白RGBA双底恢复有效alpha，避免libass alpha平面与实际覆盖不一致；量化容差、缓存上限、真实UI证据见 `docs/qa/2026-10-19-gpu-text.md`。静音曲线采用权威source seek逐帧取样且media保持暂停，带可闻音频曲线继续后台；真实源帧/掉帧验证另见曲线QA。

转场扩展计划（2026-10-19）：先用居中窗口/源handles/层叠顺序写失败用例；再复用核心transitionWindow/transitionSourceAt规划pair；WebGL左右各写透明RGBA FBO，以premultiplied线性mix一次合回下层；复用两份FBO并记录pass/分配/字节数，resize/context loss/dispose释放；最后跑GPU专项测试及typecheck。仅支持crossfade画面，音频保持原切点；dipToBlack及未知规则继续明确回退。

转场扩展已实现：居中窗`cut±duration/2`不移动片段和总时长；用核心外延源时间覆盖两侧handles，动画仍按源时钟。每个pair在原轨道的绘制位置输出一次，不把所有转场提到最上层。左右独立RGBA8透明FBO各保留其opacity/transform，再对预乘RGBA做`mix(out,in,progress)`，最后用`ONE, ONE_MINUS_SRC_ALPHA`合回既有下层。两份全画幅FBO逐pair复用，并在resize/context restore/dispose释放。字幕/图层在其上方时依然后绘制，音频仍保留原切点，不新增未经核验的音频交叉淡化。

色彩调查计划：先记录源/后台输出的matrix/primaries/transfer/range及浏览器VideoFrame.colorSpace，再在同一暂停帧同步readPixels读取两侧FBO和最终buffer，对照TexImageSource默认转换与NONE，最后对照2D-sRGB读回及CSS视频截图。默认生产契约显式固定browser-default上传、srgb unpack/drawingBuffer和数值域预乘混合；NONE只作为诊断比较且结束恢复，不根据截图添加gamma补偿。另接入core/color-effects.ts的四个已版本化stage，uniform直接使用共享参数、neutral跳过；原生滑杆映射和完全色彩一致仍待实测。

闪黑扩展已实现：据父任务原生新证据，接受`dipToBlack / overlap:false`且不读取额外handles；转场窗仍居中。预乘权重为`wOut=max(1-2p,0)`、`wIn=max(2p-1,0)`、`wBlack=1-wOut-wIn`，黑色为不透明层。两侧FBO清透明，零权重一侧跳过额外解码/绘制；黑色权重进入alpha，中心全黑会遮盖下层。音频仍原切点。无handles、半透明上轨覆盖下层、窗口边界及中心没有两侧decoder仍输出黑色的专项回归通过；原生帧证据由父任务保存，不把公式单测当成真实浏览器像素已通过。

实现计划：

- [x] 先写源时钟、精确帧边界、letterbox/旋转/翻转和qsin包络测试。
- [x] `plan.ts`共用核心RenderGraph与动画求值，给出支持/回退理由；`audio.ts`负责用户play后创建的WebAudio增益和静态恒速声音。
- [x] `decode.ts`按片段创建HTML媒体元素，通过显式注册URL加载；`webgl.ts`编译链接着色器并管理纹理、缓冲和丢失恢复。
- [x] `index.ts`协调seek、播放时钟、等待资源、状态、性能指标和dispose；父任务负责实际界面/像素/性能验证。

坐标规则与现有FFmpeg渲染图一致：先fit素材到画布，再按scale缩放；x向右、y向下；正rotation顺时针；flip在旋转前作用。黑色画布保留letterbox。视频采样由浏览器HTMLMediaElement解码，不冒称与FFmpeg或目标解码器逐帧/色彩完全相同。

可见文字动画、带可闻声音的曲线变速、未知诊断和无法解码的媒体明确返回回退状态。默认不静音冒充完整预览；基础音频通过WebAudio混音、HTML媒体preservesPitch恒速播放，源时钟volume和目标时间qsin淡变进入GainNode。曲线音频仍回退。

色彩诊断接口：`await gpu.diagnoseColor([{x:640,y:360}], true)`会暂停并重绘当前输出帧，最多16个buffer坐标点（左上原点整数，非CSS坐标），在同一draw中同步读取out/in FBO和最终buffer，避免`preserveDrawingBuffer=false`被浏览器呈现后清空。第二参数true只为比较增加NONE上传；finally恢复原pixelStore并按正常策略再画。返回`passes`的原始RGBA、每次实际unpack/drawingBuffer状态、转场progress，以及可用时的`VideoFrame.colorSpace`和源素材中心点Canvas2D-sRGB读回。诊断有同步GPU读回成本，不用于性能基准；该API不读取新路径、不插入DOM、不重新加载其他视频。`manifest.color`平时只读回状态，不做readPixels。

四项调色在同一个fragment shader中按brightness→saturation→highlight→shadow执行，使用核心`colorAdjustmentStages`产生的uniform参数，在预乘alpha之前处理RGB；每个neutral stage显式跳过，参数变更不重编译shader。此版本只实现`combine-adjust-v2`的独立数学契约，不能把归一化[-1,1]直接宣称剪映UI滑杆映射已一致。

2026-10-19色彩调查事实：测试源`transition-probe.mp4`（sha256以a782b001开头）和后台`8a8b7eaf…/render.mp4`的ffprobe都没有matrix/primaries/transfer/range字段。源端点FFmpeg默认/显式601为红[252,0,0]、蓝[0,0,253]，显式709为红[255,23,0]、蓝[0,13,255]。这证明本样本存在解释歧义，不证明浏览器采用了哪一条。当前Chromium HEAD的[GuessGfxColorSpace](https://chromium.googlesource.com/chromium/src/+/HEAD/media/base/video_color_space.cc)在完全未知时选择BT709 limited；[Blink视频上传](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/modules/webgl/webgl_rendering_context_base.cc)包含默认preserve与NONE reinterpret-as-sRGB分支，但本机实际版本/解码路径仍要由诊断确认。WebGL规范区分源上传转换和drawingBuffer显示解释，NONE仍有YUV→RGBA转换；不能把NONE叫“原始YUV”，也不能根据JPEG截图给shader加gamma系数。

共享色彩契约仍待父任务完成：需要记录素材原始标签、明确未知源采用的解释、统一CPU/GPU工作RGB空间与混合数值域，并在后台真实转换后写入正确输出matrix/primaries/transfer/range，不能只补标签而保留另一矩阵的数据。当前`browser-srgb-v1`仅明确GPU的srgb上传/显示与预乘数值混合；没有冒称FFmpeg输出已满足同一契约。若诊断中两侧FBO的预乘RGBA按progress混合与最终readPixels在约1LSB内相符，可把FBO算术与素材解码/显示差异分开；CSS视频截图还经过浏览器/屏幕色彩管理，不能直接等同原始readPixels。

接入：

```ts
import {GpuPreview} from './preview/index.ts';
const gpu = new GpuPreview(canvas, {
  mediaUrl: asset => api.url(`/media/${asset.id}`),
  onState: manifest => { /* ready / playing / buffering / fallback */ },
  onTime: seconds => { /* 更新播放头，不触发新的 seek */ },
  onMetrics: manifest => { /* 更新性能面板 */ },
});
const manifest = await gpu.setDocument(document, {diagnostics, time: 0});
if (!manifest.support.supported) { /* 交给既有后台预览 */ }
await gpu.seek(1.5); // 也接受核心 Rational
await gpu.play();  // 从真实播放按钮事件直接调用；内部才创建/恢复 AudioContext
gpu.pause();
gpu.dispose();
```

`mediaUrl`只能指向本机注册素材路由`http(s)://localhost|127.0.0.1[:port]/media/<asset.id>`，不打开工程中保存的原文件路径。实际服务路由由`apps/service/server.ts`提供。每个同时活动片段拥有独立媒体元素，同素材不同源区间不会争用一个currentTime。

`manifest`是随时可读取的新快照，包括支持/回退理由、renderer/vendor/软件渲染标识、AudioContext状态、解码器加载/就绪/错误与currentTime、解码帧回调时间，以及CPU绘制耗时、可用时的GPU查询耗时、累计画面帧/跳帧、解码器丢帧、纹理上传/绘制次数、同步漂移、缓存与活动媒体数量。转场另计`framebufferPasses`（左右离屏处理总次数，包含零权重clear）、`transitionDraws`（mix总次数）、`framebufferCount/Bytes`（当前分配）及`framebufferAllocations`（本GL上下文累计分配）；RGBA8两份占`width×height×4×2`字节。CPU绘制耗时不包括等待解码；等待耗时独立记录。默认最长边1280、同时12个媒体、最多24个缓存元素，调用方可配置；不是宣称达到某一帧率的保证。

结束播放会停在逻辑终点并以最后可见输出帧重绘，状态变为`ready`。切换片段或明显漂移时暂停媒体并冻结播放头，准备后重新锚定时钟。Context loss会停止播放并报告不支持；恢复后重建GL资源、重新seek，不自动续播。调用方可在此期间切回后台预览。pause会暂停全部媒体、清零增益并挂起AudioContext；dispose会释放媒体URL/监听器、视频帧回调、音频路由、GL纹理/查询/缓冲/程序和RAF。保留的音频路由在pause期间维持零增益，避免对同一媒体元素重复创建MediaElementAudioSourceNode。

验证（2026-10-19）：`node --test test/gpu-preview*.test.ts`共18组通过，覆盖移动后的2x源时钟、30/60/30000:1001单帧边界、portrait letterbox及顺时针旋转/UV翻转、隐藏/静音/未知效果判断、qsin包络、AudioContext延迟创建与恢复拒绝、更新中的增益曲线取消、编译/链接/初始化部分失败清理、context loss/restore状态及解码seek/取消/dispose；新增crossfade居中窗口/外延handles/音频切点/上下层顺序、NTSC半开窗口、未知转场属性拒绝、两个透明FBO分离/复用/resize/失败清理、诊断读回坐标/数量/状态恢复、共享调色参数/neutral与闪黑无handles/不透明黑覆盖。`npm run typecheck`通过。父任务已在IAB实测首轮普通预览Apple M3 ANGLE Metal，6秒180输出帧、输出跳帧0，解码器另报告12掉帧；具体初始状态见`artifacts/qa/gpu/browser-initial.json`、定位截图`browser-3.5.png`。这不代表转场实际像素、听审或多轨压力已通过，仍由父任务继续核验；上述单测未冒充真实像素或听感验收。

仍有差异：完整命名动画/特效库尚未支持；可闻曲线声音需0.6音轨provider，0.7文字动画路径见下；HDR/广色域、浏览器色彩管理、VFR精确采样与浏览器保调算法没有目标一致性结论。普通HTML媒体多路启动与WebAudio lookahead属于基础同步，并非采样级音频编辑引擎；暂停后seek使用源帧内微小偏移，工程时间仍为精确有理数。`requestVideoFrameCallback`仅记录解码信息，不把其回调次数当作画布实际绘制帧数。GPU不可用/编译失败直接抛出，调用方应进入后台路径；运行时解码/上传/播放失败进入manifest的fallback状态。

实现依据：[Mozilla texImage2D](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/texImage2D)、[requestVideoFrameCallback](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback)、[AudioParam cancelAndHoldAtTime](https://developer.mozilla.org/en-US/docs/Web/API/AudioParam/cancelAndHoldAtTime)。音量曲线替换要取消已经开始的lookahead曲线，避免新旧setValueCurveAtTime重叠；不支持cancelAndHoldAtTime时移除旧自动化再设置当前值。


0.6：可闻曲线可选 `curveAudio(clipId,context,signal)` provider。返回固定44100/stereo/float32 WAV描述；CurveSounds有界fetch/解析，不创建AudioContext。播放时PreviewAudio按目标局部offset以rate1调度PCM，原曲线video永远paused/muted；gain/动画/fade由原clip实时单次施加。音频only曲线不创建原HTML媒体。每clip PCM32MiB、PCM缓存64MiB，AudioBuffer只保留激活route，cold准备和超限fallback如实显示；不是R3实时推理或原生算法完全一致。manifest.curveAudio记录PCM字节和调度状态，不是声卡实测延迟。


0.7：textTexture provider的context可含mode:'neutral'|'frame'及frame。请求只在相应模式附这两个字段；响应除url转absolute外保留mode/frame/clipId/revision/画幅，GpuPreview严格核对。neutral限已实测无装饰Source Han Sans SC Medium与基本中英字形；其他字体/描边阴影/几何/typewriter使用完整ASS的当前帧，最多300帧且≤1080p。manifest.frameRasters与previewQuality区分realtime/exact-frames，后者冷帧需要准备，UI标精确预览。包含温度mat3的column-major上传；新增实际验证见0.7 QA。
