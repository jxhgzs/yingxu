# 曲线媒体表达式与音频路径调查

日期：2026-10-19。固定对照剪映专业版5.9.0。此记录只确认媒体表达式复用已恢复的核心模型及本机音频工具能力，不表示完整曲线变速、音质或全部目标行为已对齐。

## 媒体表达式

新增 `packages/media/src/curve-speed.ts`：

```ts
curveSourceExpression(clip, targetDeltaExpression:string):string;
curveTargetExpression(clip, sourceDeltaExpression:string):string;
```

输入、输出均为片段局部delta秒。curve存在时复用核心`curveVelocitySpans`的同组float32派生分段，不另造速度曲线，不将曲线积分按source/target元数据比例缩放。输入先夹在元数据范围，再取整微秒；输出也取整微秒。无curve时保留常速乘/除的简单表达式。

正向每段使用数值累计面积常量与二次积分；逆向使用稳定二次根，平坦段单独相除，超出覆盖源面积时夹至显式目标终点。决策树使用平衡`if/lt`，100点、297个线性速度段仍只约9层决策，避免线性深度触发表达式解析限制。所有内容都是FFmpeg AVExpr语法，没有JavaScript表达式求值。

表达式长度（clock为`N/30`）：

| 控制点 | 正向字符 | 逆向字符 |
| --- | ---: | ---: |
| 2 | 1254 | 1025 |
| 5 | 5331 | 4340 |
| 20 | 25805 | 21130 |
| 50 | 66904 | 54956 |
| 100 | 135289 | 111103 |

长度随点数线性增长；预算为每表达式250000字符。将完整曲线clock再重复内联进数百个属性关键帧分支会放大到数十MiB，渲染集成应优先在源时钟执行属性或缓存中间时钟，不能把本表当整个渲染图的无条件性能保证。

## 真实FFmpeg验证

Node v24.18.0，FFmpeg 7.1.1，`node --test test/curve-expression.test.ts`：5/5通过，约656ms；815个原生输出PTS逐个与核心微秒映射一致。测试不是把表达式翻译成JS执行，而是使用真实`color → settb → setpts → showinfo`并读取整数PTS。

- 固定原生五点峰值曲线的正向映射，包含目标终点夹取。
- 峰值、下降、平坦2倍、平坦0.1倍的稳定逆向映射。
- 负输入与越界输入夹取。
- 100点曲线正/逆各130个PTS，覆盖整个时间域及终点。
- 无curve时1.5倍常速fallback与无效clock参数拒绝。

`npm run typecheck`通过。实际渲染图接入、目标59帧逐帧golden比对和音画对齐由主执行者继续。

表达式返回整数微秒除以1e6，集成到timebase时仍需显式取整，例如测试使用`setpts='floor((EXPR)*1000000+0.5)'`。直接乘回timebase后截断可能因浮点表示回落一个tick；不能用showinfo的简写小数时间代替整数PTS校验。

## 本机动态音频命令调查

本机FFmpeg已编译librubberband，`atempo`与`rubberband`的tempo选项都可接收动态command；实测`asendcmd`在源时钟1.002667秒的输入块接收到预设1秒的命令，命令返回成功。未安装或更改系统工具。

2秒、48kHz正弦信号，源1秒处从tempo1变为2，理想输出72000样本：

| 方式 | 实际样本 | 实际秒 | 与理想时长差 |
| --- | ---: | ---: | ---: |
| FFmpeg atempo动态command | 71670 | 1.493125 | -6.875ms |
| FFmpeg rubberband动态command | 70915 | 1.477396 | -22.604ms |

复现过滤器：`asendcmd=c='1.0 atempo@tempo tempo 2',atempo@tempo=1`；另一个将两处实例改为`rubberband@tempo`与`rubberband@tempo=tempo=1`。动态command可用并不代表块调度与算法尾处理已满足精确曲线同步。不能靠末尾补静音或裁齐总时长掩盖内容漂移。

此外`asendcmd`位于变速前时接收的是源时间；已恢复的速度是目标时间的函数，因此不能直接把目标曲线x当成command的源时间。

## 已有离线timemap方案

本机已有 `/opt/homebrew/bin/rubberband` 4.0.0及头文件，无需安装。CLI支持`--timemap`，由源采样帧与目标采样帧的内部锚点约束变速，并另外指定全局时长/比例。

实测输入96000样本、内部map `48000 48000`、全局`-t .75`：R2/R3均输出72000样本、零warning。R3若包含`0 0`会出现NaN/Inf warning，即使进程返回0；因此不能仅凭退出码接受结果。官方头文件要求合理间距的内部keyframes，不宜传每一个sample，也不应把首尾当内部锚点。

同一合法map下，4个440Hz短脉冲的绝对幅度峰值相对预期时刻：R2为+1.125/+2.458/+10.542/+9.875ms；R3为-0.562/-0.563/+8.438/+9.229ms。此检测同时受到波形相位与瞬态处理影响，只用于说明总样本数正确不等于事件形状逐样本一致；没有实际听审或目标音频对照。

该路径现已作为独立功能实现并验证，见[曲线保调音频验证](2026-10-19-curve-audio.md)。实现原则：冻结同一曲线模型，解码片段音轨至固定采样率，按核心映射生成严格单调的内部sample锚点；采用已有离线timemap引擎处理，明确固定全局时长；验证样本数、事件位置、峰值及实际听感后再混音。原曲线累计源面积可能与素材区间末端不同，须按核心原始时钟显式处理尾部，不能暗中重新归一化整条曲线。缺少引擎或产生未处理warning时明确失败，不能跳过音轨或降级为平均恒速。

依据：[FFmpeg atempo命令](https://ffmpeg.org/ffmpeg-filters.html#atempo)、[FFmpeg sendcmd/asendcmd](https://ffmpeg.org/ffmpeg-filters.html#sendcmd_002c-asendcmd)、[Rubber Band官方API](https://breakfastquay.com/rubberband/code-doc/classRubberBand_1_1RubberBandStretcher.html)；另核对本机`ffmpeg -h filter=...`、`rubberband --help`及`RubberBandStretcher.h`。本记录未修改render、graph或核心曲线模块。
