# REA 循环与组合文字动画调查

对照目标为本机剪映专业版 5.9.0。本轮使用既有 REA MCP、Ghidra 12.1.4 和 Java 23，复用 `text-animation-v7/expanded-native-snapshot.json` 与完全相同的精简分析 profile（digest `6d47acb8fafee66c25ab41012c41ee6d1ffb78f9f65162917c011a4a96b4d329`）。没有重新冷分析大库、安装组件、修改注册或执行目标私有代码。原始记录和目标代码只留在 ignored `artifacts/rea/loop-combo-v8/`；可提交的数字观察位于 `evidence/2026-10-19-loop-combo-v8/`。

## 当前确定的原生语义

主库 arm64 SHA256 为 `be0dd5c522e2b0511202cfa2bd27dc7075b3e5ab7cea820bef4c2664d80afe81`。新 REA `search_procedures` 证据 `ev_bee25f79216c3fd822518889186e17f57faaccd9d7498d13b7971b208960bf29` 只用于补充本精简 profile 可见过程与导入接口；函数库存不是全部动画库存。

复用并重新核对 0.7 原始完整 Evidence，而不是重复调用相同反编译：

| 问题 | 已观察结果 | Evidence |
|---|---|---|
| 动画类型 | 0 none、1 in、2 out、3 loop、4 caption、5 group | `ev_b718e11faa65db1242e425fa3190455c3f088585c311f23b03c7c91953c362e7` |
| 替换规则 | 非空 type 4 独占；其他类型替换同型、移除 type 4，保留其他类型 | `ev_3eb82d880d2e17aaf2ff35613d7c6f20abcd9661d9a0c8bd82a25d66803e5c8b` |
| 时长修正 | 修正器分别处理 in/out/loop/caption，不处理 group；有 in/out 时 loop duration 最多为剩余目标时长，并有 100ms 下限；仅有 loop 时保留现有 duration，仍有 100ms 下限 | `ev_76eeae95a19f24508d3602aa933e56a313b8bb118c4609ea9a3a0bcf3f2c94f3` |
| 联动缩放 | 按新旧 target duration 比例缩放动画 duration，type 3 上限 5 秒 | `ev_138a22815aa788df92db987f3f272628702e5ebc8282af566d7cd26e6491fa9e` |

上表更正了旧文字报告关于 loop 修正的概括边界：不能推断循环的 duration 总是片长或总是剩余区间。该数值究竟对应整次重复周期还是资源内部一次动画，仍需读取具体资源及真实导出。

## 原生 UI 与资源

本轮主任务实际打开普通文字动画面板，只有入场、出场、循环三个页签。没有观察到普通文字的独立“组合”页。UI 可同时保留入场渐显、出场渐隐、循环闪烁；本轮“组合”实现明确指这三种 phase 共存，不能把它冒称为原生 enum caption/group。

原生 UI 正常下载并应用「闪烁」，effect id `1644514`，resource id `6724921437930394120`，category `xunhuan`，type `loop`，start `0`，duration `500000us`。REA 资源目录父 Evidence 为 `ev_b33bda241086a762bee23a712a89802b234b3322f9fa48bb9950a798bc172d59`，summary Evidence 为 `ev_d317aafb18ace9488a1269929f6e58b83b382bb2be26b3ad2c8f6db611cd166d`。JS 分析只验证目录、JSON 和库存，不提供 Lua 语义；数学从固定字节资源及已有 libeffect 内嵌 Ease 单独核对。

`Spark.lua` SHA256 `769740a2e5b0b81316dc844efbcfc35dcc4f9b3e4971f3acedf0db8339a044d1`，4252 字节。其 duration D 为完整周期，令 r=`(time mod D)/D`：前半程 alpha=`4r−4r²`（quadOut 0→1），后半程 alpha=`1−(2r−1)²`（quadIn 1→0）。不能用线性、正弦或同一入/出 ease 替换。资源身份及全部四份资源文件哈希保存在 `flash-resource-identity.json`，私有代码不进入产品。

## 真实导出与组合时钟

两个原生 MOV 都为 1280×720、30fps、4 秒、120 帧。对照使用 0.7 的独立无动画原生导出；本轮重新核对其文本、字体、尺寸、样式与 clip transform 字段相同。灰度实心字形 mask 为无动画第 17 帧像素>220，逐帧最小二乘估计相对 alpha；这不等于字形边缘最终像素完全相同。

单独循环默认 D=.5 秒，真实周期 15 帧，帧 0/15/30/45…为 alpha 0，帧 7/8 近峰。资源公式对实际编码图像 alpha 最大差 `0.0195462`、MAE `0.0054724`、RMSE `0.0069450`；实心 mask 像素 MAE `2.4424`、最大差 `38.28`。原始行与 MOV SHA 在 `native-loop-measurements.json`。

组合先用原生 UI 取得三 phase 共存，默认各 .5 秒。Qt 数值框修改没有成功时，主任务正常退出后构造受控自有草稿 in=.3/out=.4/loop=.5 秒，再正常开原生并导出；退出后另存 `04-combo-native-reopen.json`，确值和三项共存均保留。没有用 .5/.5 同相样例推断时钟。

受控组合真实结果：

- 帧 0..9（t<=.3）使用入场渐显；精确入场尾帧 9 仍满字，观察 alpha≈.9863。
- 帧 10 起使用循环，时钟为 `t−D_in`。帧 24/39/54/69/84/99 为循环起点黑帧。若用全局 t 时钟会明显错误。
- 从帧 108（t>=3.6）改用出场渐隐，覆盖循环；它们不是把三种 alpha 同时相乘。

正确互斥、偏移、包含入场终点模型的 alpha 最大差 `0.0161564`、MAE `0.0052406`、RMSE `0.0066550`。将入场终点错误归循环会使帧9误差约 `.9863`；全局循环时钟 RMSE `.51310`，全局乘积 `.51547`，偏移后仍相乘 `.13492`。原始全部候选模型和逐帧数据保留在 `native-combo-measurements.json`，没有隐藏失败候选。

## 独立实现与验证

`packages/core/src/text-animation.ts` 新增 `phase:'loop', kind:'flash'`，duration 表示周期，沿用 `textAnimationOpacity` API。组合按上述实际阶段选择，而非随意相乘；有理数先精确取模再换成 double 计算 ease，长时钟不会因 Number modulo 丢失周期边界。最多三个不同 phase；loop 不计入 in/out 总时长，周期至少100ms且不得长于中间可用窗口。超界明确拒绝，没有开放未原生核对的短片自动修正。

10项核心回归通过，另与现有 schema/ASS/typewriter 实渲染3项共同通过，共13项。新增覆盖周期与半周期、精确三阶段边界、超大有理数时钟、loop duration 与阶段长度分离、未知 kind/caption/group/字段拒绝，以及两份原生120帧固定alpha观测门槛。typewriter 与循环的入口选择测试是共享模型的独立数学回归，原生组合 MOV 当前只覆盖 fade+flash+fade，不能把它称为原生 typewriter+flash 导出对照。

## UI、ASS 与纹理集成

文字动画面板新增循环「无/闪烁」及周期输入（至少 .1 秒），同时保留入场和出场；候选值直接经过核心有理数验证，不将 loop 周期加入入/出总长度。watch 使用独立 source getter，播放头更新不会因新数组 identity 重置未应用输入。错误中文明确周期与中间可用时长限制。实际 UI 截图、应用/撤销/重做及保存重开由主任务桌面验证另记。

预览 plan 将 flash 加入原纯 alpha neutral 字体/几何/无描边阴影白名单。原有未知字体、装饰文字和逐字动画仍使用精确 frame 路径。新增 27 个样本（9 帧×3 背景）与完整 ASS 当前帧比较，neutral 字形混合最大 RGB 差≤2、平均差<.08；包含原生 .3 秒入口终点、循环起点、出场与 3.7 秒敏感时刻。30 秒纯循环可走 neutral，仍保留精确帧路径的范围限制。

## 真实渲染揭露的事件时钟问题

完整4秒产品导出首次在帧111（3.7秒）与 native 相差 `.0725198`，产品 `.8850251`、native `.9575449`。ASS 该帧 alpha 本身正确；独立未编码 libass 探针使用原始1/30 PTS得 alpha `.8902812`，临时微秒 TB 内点取样得 `.9608868`。libass 将浮点 PTS 转整数毫秒时，3.7秒可能落3699ms，因而选择前一个 ASS 事件。不能把这个错帧归因有损编码。

最终修复在 `subtitle-clock.ts`：按整数输出帧 N 选择 `floor(N*100/fps)*10+1` 毫秒，即**该帧 ASS 厘秒事件内部**；取样后恢复原文档 fps TB 与整数 N。精确帧纹理把请求 frame 作为偏移传入同一函数。该查找时钟只用于 libass 选事件，动画、源属性、文字布局仍在原始 Rational 帧时刻评估。固定原 PTS+1ms 对接近100fps可能提前，故该尝试未作为最终实现。

30/60/30000/1001/99fps 的逐帧黑白 opacity hold 实渲染、首末单帧字幕、敏感 frame111/222 及同帧纹理均通过，证明修复没有把媒体和属性时钟一起平移。99fps 特意覆盖固定偏移会跨下一厘秒事件的情况。

## 产品编码与原生残差

产品使用同一完整4秒时序，分别保留未编码 libass 与正式 H264 输出；各自无动画参考建立实心字形 mask。编码与字形差异没有被归零：

| 样本 | 未编码alpha对公式最大差 | 产品完整颜色/编码链alpha变化最大 | 产品最终alpha对native最大差 | 对native MAE |
|---|---:|---:|---:|---:|
| 单独闪烁 | .00188192 | .02298316 | .02979538（帧41） | .00914645 |
| 三phase组合 | .00188192 | .02232163 | .03242509（帧20） | .00927888 |

最初为两条最终编码链设置 `.03` 的 alpha 门槛，组合帧20实际失败。隔离后将验收拆成未编码<.003、产品颜色/编码链<.025、两条有损链最终alpha<.045；**.045 是本实现两条有损链的组合边界，属于明确调整，不能称未放宽或像素1:1**。仍严格检查循环黑帧、入场终点和所有整数输出帧。完整240个最终样本、raw/encoded/native/formula四列及最初失败保存于 `product-render-comparison.json`、`initial-issues.json`。字体栅格和最终全帧RGB一致性仍未成立。

本轮字幕/文字相关36项测试共同通过，包含上述真实编码、原有5000字幕/叠轨/样式与取消测试。全仓最终回归和 GPU 浏览器像素由主任务另记。

未完成：caption/group 的其他入口及实际资源语义、完整线上循环动画库、复杂字形与装饰文字的原生组合对照、分割/裁切/速度编辑的动画规则、完整性能和最终像素一致。原生 UI 没有普通文字组合页不能证明其他模板或版本不存在该入口。完整 1:1 仍有实质缺口。

## 会话结束

REA 同 profile snapshot 重开耗时 4.281 秒，库存搜索 18.722 秒，新资源目录视图 .059 秒；这些是本次各工具墙钟时间，不冒充全冷分析时间。所有新 Evidence 已 export 到 ignored `final-evidence.json`，native 已 close 并保存自有 snapshot，STOP 后 helper 退出码 0。操作、耗时、Evidence ID 与收据哈希见 `rea-session-index.json`，没有遗留本 worker 的后台进程。
