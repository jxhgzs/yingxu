# 0.6：有声曲线GPU画面与WebAudio音轨

沿用用户已批准架构和固定剪映5.9.0目标，继续独立重写。此轮没有把原生私有库或shader接入产品；不改映序生产。完整1:1仍未完成。

## 音画链路

`CurveAudioRenders`复用已测试的`renderCurveAudio` R3离线保调，仅生成44100Hz双声道float32的目标时钟WAV，不烘焙音量/关键帧/fade。请求按工程修订、已注册素材/path/SHA、曲线区间、实际引擎和Rubberband SHA绑定；读取执行文件身份后，每次复查stat，改变即拒绝。进程/临时目录独立，取消不会操作共享任务。

POST `/api/projects/:id/curve-audio`有token、修订与断连取消；GET/HEAD `/curve-audio/:key.wav`支持实际MIME及206。服务32排队、32缓存项/512MiB、目标≤600秒、源和目标PCM各≤256MiB，发布/缓存读验证大小、哈希和真实音频元数据。大于客户端缓存的音轨仍可能被服务单独生成，不把服务上限等同浏览器内存预算。

浏览器`CurveSounds`只为活动可闻曲线获取和严格解析WAV，准备/seek不建立AudioContext。每clip PCM≤32MiB（44100双声道约95秒）、缓存≤64MiB，串行fetch/parse限制临时并行内存，metadata和localhost路径严格验证；cache含项目修订/素材/区间/曲线身份，迟到取消不能写入缓存。WebAudio的AudioBuffer另占一份激活PCM，不宣称整个浏览器只占64MiB。

真正play手势才resume AudioContext。PCM source以目标局部offset、rate1启动；每RAF只更新原clip的source-clock音量和target-clock qsin包络，不重建同一source。暂停/seek/删除/销毁停止旧的一次性source，切换PCM不重声。曲线video始终paused/muted，按已有REA积分逐输出帧seek；曲线audio资产直接用PCM，不另建原HTMLAudio。

原生音频算法仍未对齐；浏览器preservesPitch未被当作R3替代。界面显示“准备画面与音轨”，初次R3准备仍是后台计算，不称全部采样实时推理。

## 实际浏览器捕获

独立8834服务、8835测试页面，1280×720编号色源+CFR30、44100Hz AAC双声道，3个Gaussian幅度事件叠加440Hz/660Hz。曲线源.1秒/3秒、目标1.966666秒，沿用59帧已验证曲线；源音量.4→1.2，淡入.2/淡出.3秒。合成画幅640×360，Apple M3 ANGLE Metal。

用同一正式GpuPreview先校准101个源帧，再打开服务冻结的有声工程。准备完成约565.6ms（首次观察），热缓存重开约280.5ms；这包含HTTP/验证/媒体定位，不是独立R3耗时。准备后contexts=0、audioState=uninitialized、PCM693840字节、0活动音源，证明暂停加载未偷开声音。

AudioWorklet在实际gain输出后旁路捕获，同时保留原speaker destination；未录麦克风、未用状态或mock代替声音。采样率48000（浏览器设备上下文），副本对照FFmpeg重采样的R3目标音轨和独立解析增益，按worklet currentFrame重建时间轴，不压缩缺失块。

| 运行 | 源帧核对 | 本次输出跳帧 | 捕获帧 | 相关系数 | RMS实际/参照 | 最优波形偏移 |
| --- | --- | --- | --- | --- | --- | --- |
| 从0完整播放 | 59/59准确 | 0 | 94464 | .999999272 | .999316 | 0 samples |
| 暂停后跳至.9恢复 | 32/32准确 | 0新增（累计4） | 50944 | .999994313 | .999670 | +256 samples / 5.333ms |

参照是本产品R3+包络，不是原生剪映音轨，因此此处不能宣称原生逐样本一致。相关搜索范围±10ms，实际最佳偏移如实报告，不把对齐后小误差冒称原始时序没有差。未偏移的恢复RMS误差约.08716，反映该调度偏移对相位的影响；偏移后RMS约.000420。两次捕获有初始化/恢复边缘worklet空输入块256/128 samples，原始chunk时间戳保留；没有把它们静默拼接掉，也不能凭本探针宣称设备无音频underrun。没有实际听审或声卡回录。

新增中途暂停测试约.704秒暂停，随后两次相隔200ms：context始终.72秒、transport不变、audioState=suspended、curveRoutes=[]，旧源已停止。该压力样本观察4个输出跳帧；不能描述为任何场景零掉帧。随后seek恢复的累计4未再增长。完整JSON、实际截图与捕获统计在 `evidence/2026-10-19-gpu-audible-curve/`，原始F32和探针源码保留ignored `artifacts/qa/gpu-audible-curve/`。

## 错误路径与测试

独立审查发现：PCM先失败而视频仍加载，较晚video.ready拒绝可能无人订阅，出现unhandledRejection。DecodedMedia现在立即观察ready拒绝，并保留原promise让后续await仍收到实际错误。新增回归覆盖原prepare/fallback、迟到解码错误和加载中cancel/dispose；没有用吞掉错误冒充成功。

本轮全量196项测试、类型检查与桌面构建通过。包括真实R3生成、gain-neutral WAV一致性、SHA/注册路径/修订冲突、队列/缓存上限、R3真实PID取消与HTTP断连、PCM格式/finite/内存、目标offset、恒速/曲线路由共存、源音量/qsin、旧source stop及未处理promise路径。全部基线与最终桌面操作在下节补记。

温度/色调候选与原生新证据单列[REA记录](2026-10-19-rea-temperature.md)，未因此开放未经完整GPU/导出集成的控件。

## 普通音轨与曲线音轨混合实测

独立8836页面增加原创1000Hz常速WAV，volume=.5，与原440/660Hz曲线片段同区间。实际gain后分别捕获constant、curve与mix三路，保持speaker输出。59/59画面准确、0输出跳帧，曲线video每帧paused/muted；只有1个AudioContext、1个MediaElementSource、1个BufferSource与1次curve start。常速1000Hz幅度.04418457，符合单次.5增益；混合两声道RMS与两分支实际采样和的误差1.32e-9/1.14e-9。该检验确认混音与无重复路径，不证明普通HTML媒体和PCM在所有设备上采样级相位锁定。完整worklet时间戳仍保留启动空块，49.93ms最大源时钟统计另见原始manifest，不以0画面跳帧抹除。

证据为 `mixed-integration.json`、`mixed-analysis.json`、`mixed-browser.png`。全量九个基线回放通过；原始测试/构建日志保留ignored artifacts/qa。
