# 0.10 精确文字首次准备

本轮优化独立实现的精确文字批量路径，固定1280×720、30fps、有声6秒、180张连续唯一纹理。完整剪映5.9.0一致性仍待逐项对照，以下仅为本样例与有界缓存路径证据。

## 改动与契约

黑/白完整画布仍由相同ASS、字体和subtitleClock生成。两帧上下拼接后按raw管道输出，JS仅保留一个配对帧缓冲并按背压恢复RGBA，再送相同PNG编码参数；不再落盘black/white/straight三个完整窗口文件。透明RGB观测直接写零，非透明观测仍逐码值执行原公式。32张/128MiB窗口、服务512PNG/256MiB预算、≤300帧显式准备和latest revision/lease语义保持。

新增打字机II仅将未量化基础opacity与逐字相对opacity相乘后量化的结果加入内容键，旧效果不增加字段。旧实现5个请求全部合成1个键的失败已保存；修复后四种实际状态独立、完成后hold复用，各张与scalar PNG逐字节一致。新弹跳仅在该kind激活时按已验证helper将最长边位移经common scale/rotation计入x/y，随后才乘缩小预设scale；未接入前8帧误合并1个键的失败也保留，修复后竖屏、2倍scale/30度旋转、四个位姿及重复位姿复用均与scalar PNG逐字节一致。

## CLI阶段基线

原始报告位于`artifacts/qa/gpu-v10/{baseline-profile,stream-profile,frame-mapping}.json`，所有轮次保留。父协调其他worker停止FFmpeg；native app保持打开，仅做UI选择，期间无原生导出。起止ps均只见native app约2%历史CPU、无外部FFmpeg，不据此声称整机全程无其它负载。

| 同样输入 | 原路径 | 流水路径 |
|---|---:|---:|
| 32帧ASS/字体 | 125.4ms | 121.9ms |
| 32帧渲染 | 1675.8ms | 合入流水 |
| 32帧恢复与raw磁盘 | 629.9ms | 合入流水 |
| 32帧PNG编码 | 341.5ms | 合入流水 |
| 32帧流水 | — | 508.6ms |
| 32帧总计 | 2772.9ms | 630.8ms |
| service首次180帧 | 19038.7ms | 4762.7ms |

本次CLI冷准备下降75.0%；0.9真实浏览器首次准备15.373秒是另一轮条件，不能直接当作本次前后对照。两路各180张、4,105,871B。32帧直接逐文件相同；180帧按相同global frame取得各自service descriptor，逐一核对PNG SHA全部相同。PNG编码参数与分辨率均未改变。本段仅为CLI测量，实际浏览器结果见后文。

## 回归与边界

先保存无raw文件要求在旧实现上的真实失败；新增流碎片/像素与帧边界、短/额外帧、写端错误、取消、阻塞encoder不读取整个32帧窗口，以及子进程失败/取消后两进程均退出的回归。21项专项（6.635秒）及追加流预算回归（与8项流/进程回归重跑，9/9通过）已通过：CFR/NTSC scalar与batch PNG字节一致、真实HTTP断连、修订、prepare partial/预算/lease，以及超时后SIGTERM→SIGKILL的双进程回收均覆盖；类型检查通过，最终全量由父统一执行。

临时内存与GPU纹理预算分开：配对raw帧加恢复输出和Node流预取是有界临时内存，未把整个32帧或180帧装入JS。FFmpeg自己的工作帧/字体仍为原生进程内存。永久缓存预算仅约束PNG，不将编码进程内存冒称为GPU预算。

0.9第3次复播633ms rAF异常和其buffer/output18/decoder44仍保留；本轮没有用删除异常、调整统计或慢放改善指标。真实GPU按钮测量前须冻结所有源、绑定前端SHA与backend engine，逐轮记录准备、实际运输、buffer/output/decoder、可见性与rAF，不在播放中读取巨型AX。

## 实际GPU测量安排

新探针在`artifacts/qa/gpu-v10`，独立项目与媒体副本，不复用旧缓存。0.9旧22张直接ASS像素参考保留，透明HTTP gzip回退读取其原字节；新预设41帧另以完整ASS直接烧到蓝底生成参考（加旧22共63帧，含107/108/111/119出场冻结边界），未由PNG缓存反合成。

本轮可见pre只显示mode/run/prepare/play/drops/buffer/error等紧凑摘要，完整report仍原样POST落盘。这是降低探针DOM/AX观测负担的harness变化；不计为产品优化，也不能据此将旧633ms异常确定归因于AX读取。性能期间不读取大型AX树，保留每个冷准备/三连播轮次及外部进程边界样本。

14:32:02Z轻量HTTP核查全部通过：旧1280×720参考和新组合107帧参考均经HTTP gzip透明还原后SHA一致，真实有声媒体Range为206；页面、cases、源SHA状态均200。boot版本0.10.0，backend engine尾7543809c5dea2c4f0603aaeed89c5558c087bb46d2e9711fd421e3cef42cebca；index前端SHA仍6e3e4b9aab4d8e8af1e1f9b7e9dd83b37f3b8efc7a50a9b791fd792f2b7ff2a3，webgl/plan/core/captions/glyph及4个流水模块也单列SHA。实际四按钮结果见下节；集成全量结果以父任务报告为准，临时服务清理见文末。


## 实际GPU结果（父Cua点击）

2026-10-19T14:33:43.430Z—14:35:33.242Z，在Apple M3/ANGLE Metal实际WebGL2上依次完成四按钮，全部原始JSON保留在纯证据目录。冷指本探针service PNG缓存清空，浏览器/OS缓存没有全局清空；每轮新建/销毁preview实例。准备计时从setDocument开始，播放墙钟包含play内再次缓存验证；transport单列。页面保持visible/focus=true，期间无巨型AX读取。四个模式共8个起止ps边界均未见外部FFmpeg，这只是边界样本，不能证明整机全程空闲。

| 轮次 | 准备ms | play墙钟ms | transport ms | 输出掉帧 | decoder掉帧 | buffer |
|---|---:|---:|---:|---:|---:|---:|
| scalar冷（对照） | 8525.4 | 36429.3 | 36420.6 | 0 | 135 | 145 |
| batch冷 | 6941.1 | 6178.4 | 6021.6 | 0 | 0 | 0 |
| batch保留1 | 345.7 | 6174.1 | 6022.2 | 0 | 0 | 0 |
| batch保留2 | 277.8 | 6161.6 | 6012.3 | 0 | 0 | 0 |
| batch保留3 | 284.7 | 6165.8 | 6013.7 | 0 | 0 | 0 |

batch冷6.941秒由约2.606秒首帧/首窗请求及解码、4.335秒显式磁盘准备HTTP构成（服务内elapsed4331.75ms）。不要把纯CLI的4.763秒或播放前热验证约150ms当作完整首次准备。0.9同fixture真实冷准备记录15.373秒，本次6.941秒；这是两个版本各自真实轮次，harness显示与运行条件不同，严格同窗口前后对照使用上文CLI19.039→4.763秒。scalar的0输出掉帧同时发生145次buffer且6秒内容需36.4秒，不能称实时。

四次batch均180张精确PNG/4,105,871B，最终32张解码纹理/117,964,800估计RGBA字节，180次解码、148次驱逐。播放期间实际HTTP请求20/23/23/23，仍有有界滚动取PNG及缓存验证。四次最大rAF间隔9.3—9.4ms、无>33.4ms间隔、无LongTask条目；batch最大源时钟偏差31.948ms。所有静默准备AudioContext新增0、AudioParam异常0，dispose后纹理与音频缓存归零、音频状态closed。本轮四次batch全0掉帧/缓冲不覆盖0.9保留的633ms异常，也不外推其它工程或负载。

63帧精确像素检查通过：旧22帧最大RGB误差仍2；新41帧仅soft-six的frame6达到3（该帧mean0.013704），其余新帧最大2，全部alpha误差0；新组最高帧均值0.021123。107/108/111/119组合边界均已实际GPU核对。自动ready同步恢复与同帧确认seek两种context恢复比较均max/mean/alpha=0，静默检查AudioContext新增0。

本轮未改变动画像素、时钟、分辨率或帧数，未修改GPU tick与预取水位。仍保留≤300精确帧/片段、≤1080p等原有支持边界；更长工程、复杂字形、全部原生预设与长时稳定性并未由这63帧和4次batch证明。


## 清理

父正常关闭文字GPU tab23后，仅向自有server85278/observer85530发送SIGTERM；观察到对应exec session退出码143/0。两PID均已不存在，8838/8839逐一成功绑定并关闭，未留下监听；原始核查为`evidence/2026-10-19-gpu-preparation-v10/service-stopped.json`。未停止其它任务进程。截图保留为`artifacts/qa/gpu-v10/final.png`。
