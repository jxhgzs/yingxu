# REA 曲线变速跟进

本轮继续针对本机剪映专业版 5.9.0 作静态分析，目标是曲线速度的坐标、平均速度、源/目标时间映射与分割规则。尚未完成全部曲线媒体行为对照，不能据此宣称 1:1 完成。

已从请求封装继续追到 SDK 内部数学对象，取得源/目标点转换、平均速度、三段线性速度积分和逆映射。独立核心模块已实现，5 项测试通过；其中一个真实曲线导出有 59 帧编号对照，两处非节点分割有草稿数值对照。

## 固定目标与边界

- 复用原 `libvideoeditor.arm64.dylib`，SHA-256 `be0dd5c522e2b0511202cfa2bd27dc7075b3e5ab7cea820bef4c2664d80afe81`。
- 读取旧 `native-focused-session/analysis-snapshot.json` 与已有证据，没有覆盖旧文件。新记录统一位于 ignored `artifacts/rea/curve-followup/`，闭源伪代码仅保存在该目录。
- 由同一原 app 中的 `libvesdk.dylib` 只读提取 arm64，SHA-256 `60a4d61ec74ee6cd4d231f1d06cbb91e89bac955c127de0852c970c73b143623`；原始 universal 文件哈希与提取操作保存在 `vesdk-provenance.json`。
- 本节REA静态子任务没有执行分析目标、Frida/LLDB attach或UI自动化，也没有更改原app、全局配置或分析引擎依赖。原生界面实验由主任务另用CUA操作专用草稿。

## 已取得的函数线索

| 层次 | 入口 | 地址 | 当前观察 |
| --- | --- | --- | --- |
| 文档速度 | `VideoUpdateSpeedUtils::getCurveAveSpeed` | `0x1337a90` | 点的 double x/y 转为 float 数组，经 CurveSpeedUtils 虚表初始化并查询平均速度 |
| 时间映射 | `mapSeqDeltaToTrimDelta` / `mapTrimDeltaToSeqDelta` | `0x133840c` / `0x13388e8` | 初始化点后用 FrameTimeFactory 配置帧时间，再分别委派虚方法 |
| 分割 | `splitCurveSpeedPoints` | `0x1338dc4` | 先映射目标切点到源位置，再重归一化左右 x 并插入三次插值边界 y |
| 工厂 | `CurveSpeedUtils::create` | `0x1466900` | 分配对象，构造器在 `0x1466940`，使用虚表 `0x25f4ae0` |
| SDK | `VECurveSpeedUtilsImpl::transferTrimPointXtoSeqPointX` | `0xc63718` | 逐段 float 累加 `dx/((y0+y1)*.5)`，再除以总和，得到目标序列点 x |
| 数学对象 | 平均速度累加 | `0x303a40` | 相邻 float 速度和、序列 x 差转换 double 后求梯形面积和 |
| 数学对象 | seq→source / source→seq | `0x303e80` / `0x30422c` | 三段线性速度的解析面积与二次方程逆解，返回整数微秒 |
| 数学对象 | 速度查询 | `0x303b20` | 每个相邻点区间分成三个线性速度段 |

`splitCurveSpeedPoints` 的非退化路径观察到：源切分比例由 `float(mappedTrim) / float(sourceLength)` 得到；左侧 x 除以此比例，右侧 x 减去此比例后除以剩余比例。相邻点间的边界 y 使用端点重复控制值的三次式，等价于 `y0 + (y1-y0)*(3*t*t-2*t*t*t)`，中间 t 和最终 y 有 float 降精度。该静态观察描述新点生成规则，不足以证明媒体逐帧时间映射也直接使用相同源坐标公式。

原草稿行为证据由主代理采集，见 `evidence/2026-10-19-curve/`。自定义中点升高实例的点为 x `0/.25/.5/.75/1`、y `1/1/5.375/1/1`，草稿平均速度 `1.5223880801349878`。REA 对 SDK transfer 函数确认：当对象 flag 为零，逐段 float 累加 `dx/((y0+y1)*.5)`，再将所有累计值除以总和；非零 flag 直接复制输入 x。Evidence：`ev_cf16b3697be126a2143a7b23e444bd8a0049b8f5ab5175c5a3916f548b3919eb`，请求 13.131 秒。

按该 float32 过程复算得到目标序列 x `[0, 0.3805970251560211, 0.5, 0.6194030046463013, 1]`；以 double 累加 `seqDx*(y0+y1)*.5` 得到平均速度 `1.5223880801349878`，与草稿逐位一致。纯 double 的简化公式 `1/sum(2*dx/(y0+y1))` 只得到 `1.5223880597014925`，因此不能忽略中间 float32 舍入。这是静态转换公式与单例行为的交叉核验；继续追踪内部对象得到的积分与取整规则见下文。计算记录见 `average-hypothesis.json`。

## 媒体插值与分割规则不同

内部工厂 `0x14e570` 在非离散分支写入两项常量：`a=0.800000011920929`、`b=0.29510000348091125`。相邻目标序列锚点间的速度变化，按相对时间 `0 / (.5-b) / (.5+b) / 1` 和相对速度 `0 / (.5-a/2) / (.5+a/2) / 1` 拆成三个线性速度段。因此媒体时间映射是分段二次积分；逆映射解相应的二次方程。输出微秒由正数 `value+.5` 转整数取得。

这与分割新点的 cubic smoothstep 规则不同，不能用“界面曲线看起来平滑”将两者合并。源坐标也不能直接拿来作目标播放时钟。

关键 Evidence：

- 平均速度：`ev_af0bae12e2fd9aef08dd775f7059e03e0b15b00274c9af9289a7ae317947f8fc`。
- seq→source：`ev_6393384c5286313d9b9a8d6b042f26deabd13e99c39cf83912dd6c6ac6f2a24d`。
- source→seq：`ev_f0e2c470d82f7f0fbdd9033bcde253e882a0d785375cfa066c599bdea129901e`。
- 速度查询：`ev_b5e87227fb8b05531a1fbb32afcea45f14236dec4ffdf5d970e9fbce43d9b5a7`。

内部数学 profile 首个请求 13.427 秒，其余函数复用请求 0.009–0.172 秒。此 profile 只关闭实际枚举的 analyzer 并种入相关地址，关系覆盖仍保留各 dossier 的限制。

## 原程序交叉验证

| 原程序操作 | 独立复算 | 结果 |
| --- | --- | --- |
| 自定义中点升高 | float32 点转换后累加平均速度 | `1.5223880801349878` 逐位相同 |
| target delta `833333us` 分割 | 原始 source `876935us`，ratio `.2923116683959961`，边界 y `1.3335384130477905` | 边界值、左右 x 逐位相同；源区间为 26 帧 `866666us` |
| target delta `900000us` 分割 | 原始 source `1090693us`，ratio `.3635643422603607`，边界 y `2.8881514072418213` | 边界值、左右 x 逐位相同；源区间为最近的 33 帧 `1100000us`，排除 floor 32 帧 |
| 59 帧实际 MOV 曲线片段 | 目标帧时钟取最近微秒，三段速度积分、原始映射取整数微秒 | 在源帧边界允许微秒取整的 ±0.5us 精度时，59/59 源编号匹配 |

59 帧对照采用主代理对原始编号素材逐帧做最小 RGB MAE 的机器候选，不能代替全部视觉验收或音频验收。直接将取整后的微秒再严格向下除帧宽，会把 `33333us` 误当作第 0 帧，得到 51/59；因此报告保留所用的微秒边界规则，不能隐瞒这项条件。原对照为 `artifacts/qa/curve/target-source-frame-matches.json`，独立计算为 `frame-replay.json`；只覆盖一个自定义曲线、30fps 与一次真实导出。

第二次分割还证明源区间量化是最近帧：`32.72079` 源帧取 33，而曲线点仍使用量化前的 `1090693us`。第一个 `26.30805` 源帧例子本身不足以区分 floor 与 nearest，已由第二例补齐。原始操作分别见 `03-split-at-8s10f.json`、`04-split-at-8s12f.json`。

## 独立核心契约

`packages/core/src/curve-speed.ts` 公开 `SpeedCurve={points:{x,y}[]}`，并提供：

```ts
curveAverageSpeed(curve): number;
curveDuration(curve, sourceDuration, fps): Rational;
curveSourceDelta(curve, sourceDuration, targetDuration, targetDelta): Rational;
curveTargetDelta(curve, sourceDuration, targetDuration, sourceDelta): Rational;
curveNearestFrame(time, fps): Rational;
splitSpeedCurve(curve, sourceDuration, targetDuration, targetDelta, fps): {
  left; right; sourceDelta; rawSourceDelta; targetDelta;
};
curveVelocitySpans(curve, targetDuration): {start;end;from;to}[];
```

映射返回尚未按源帧量化的整数微秒。`targetDuration` 为必填的已存区间，不从源时长和平均速度偷偷重算。分割先从原始映射计算点，再将返回源区间量化到最近帧并截断到微秒；源码用稳定二次逆根表达式，没有复制闭源伪代码。`curveVelocitySpans` 的 start/end 单位为微秒，供原生媒体表达式复用相同模型。

`curveDuration` 仅供新设曲线时，以当前观察采用 floor 到项目帧后截断微秒；不能用它覆盖分割后的已有 target duration。原程序 FrameTimeFactory 的 aligned getter `0x160ecc0` 确实先截断分数帧、乘帧周期、再截断微秒；构造器另有 800us 阈值吸附，且全局 `auto_alignment` 控制不同对象路径。没有动态读取这个 flag，没有覆盖其全部临界条件；内部 Rational 支持分数帧率不等于已验证目标 NTSC 或跨整秒规则。名为 getRoundAlignTime / getTailAlignTime 的两个方法在本二进制中也包含条件 floor 分支，不能仅凭名称推断最近帧行为。

输入限制为 2–100 个源归一化点，x 在 0..1 且 float32 后仍严格递增，y 在 0.1..10。遇到精度合并或无法构造递增速度区间时显式拒绝，不对任意密集点作未验证的修复。

## 会话复用和 profile 实测

旧 snapshot 打开成功，用时 6.249 秒；请求未曾保存的新函数仍启动新的临时 Ghidra import。这说明该 snapshot 是既有查询/证据缓存，不能把它当作可增量继续的完整 Ghidra 数据库。本轮在 32.951 秒主动终止这次新冷分析，失败收据与进程身份已保留。

用小程序枚举的 analyzer 列表不能直接套用真实库：小程序有 DWARF analyzer，真实 libvideoeditor 没有，并新增两个 Objective-C analyzer。首次套用失败后，对固定库用 `-readOnly -noanalysis -deleteProject` 重新枚举 31 项；libvesdk 另行枚举 32 项。具体列表与命令见 `actual-analyzers/`、`vesdk-analyzers/`。

实际库 profile 关闭其枚举出的全部 analyzer，并只按已核验地址种入 4 个函数。该 profile 的首个平均函数请求 17.140 秒；同会话的 seq→trim、trim→seq、split 分别 0.632、0.396、0.993 秒。与先前约 651 秒冷请求有不同的种子和覆盖设置，不能当作同条件加速比。禁用自动分析后，匿名虚表函数需要显式新增种子；没有现成 procedure 的查询保留 invalid_request，不伪装成分析成功。

首个 setup 调用错误地使用了 `REA_GHIDRA_INSTALL_DIR`，随后纠正为既有环境要求的 `GHIDRA_INSTALL_DIR`；未重装软件。首个新 profile 成功前预排多条请求导致同一 DWARF 错误重复，后续改为先验证首个请求再扩展。移动待处理请求还暴露本地 helper 已缓存文件名时会因 ENOENT 退出，退出在 finally 中关闭传输；此处均保留原始收据，未归因于目标程序。

## 仍需核对

- 其他曲线、长片和高密度锚点的数值/输出对照；本轮只验证一个自定义曲线及两处非节点切分。
- FrameTimeFactory 的 800us 吸附临界、全局 flag、NTSC 与跨整秒路径。
- 重复/越界/空点、极端速度、音高保持与音频同步。
- 媒体编号帧对照和完整导出；静态关系不代表实际动态执行次数。

本轮 39 条成功 Evidence 观察中有 34 条函数 dossier；这些包含大量封装与类型边界，不等于 34 项编辑功能。原样伪代码、覆盖声明与耗时在各会话 `outbox/` 和 `extracted/`，总索引在 `summary.json`。每个成功分析会话先导出 bundle 和 snapshot，再 `close_binary`；不同 profile 保持独立目录，不混淆证据身份。原 app 中 libvesdk 的前后 SHA 相同，所有本轮 REA helper / Ghidra 进程已关闭。
