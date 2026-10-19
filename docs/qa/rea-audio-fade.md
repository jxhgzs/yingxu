# REA 音频淡入淡出静态调查

2026-10-19，固定本机剪映专业版 5.9.0。已恢复视频淡变的保存时钟、实际 SDK 曲线选择及 processor 的候选增益回调；SDK 字段到 processor 配置的中间传值、底层 DSP 的时间步进、采样端点和与音量关键帧的交汇路径尚未完全恢复。没有修改产品源码、原 app、操作 UI 或提交 Git。

## 目标与证据

- 主库复用 `artifacts/rea/libvideoeditor.arm64.dylib`，SHA-256 `be0dd5c522e2b0511202cfa2bd27dc7075b3e5ab7cea820bef4c2664d80afe81`。
- SDK 复用 `artifacts/rea/curve-followup/libvesdk.arm64.dylib`，SHA-256 `60a4d61ec74ee6cd4d231f1d06cbb91e89bac955c127de0852c970c73b143623`。没有引入新库或下载依赖。
- 新会话统一在 ignored `artifacts/rea/audio-fade/`，包含 `native`、`adapter`、`sdk`、`processor`、`curves` 五个独立 profile。闭源伪代码及汇编只保存在该目录，本文记录事实和独立数学表达。
- 复用现有 REA / Ghidra / Java、禁用 analyzer profile 与精确函数地址种子，没有启动全库自动分析。定点指令检索只寻找所选时长 getter 或三个 processor 字符串的调用/引用，保留原始哈希、范围与候选限制。

主任务原生证据 `evidence/2026-10-19-curve-trim/06-keyframe-render-left.json`、`07-keyframe-render-final.json` 中，视频片段 `B71C0B09-4F73-42F1-B889-5767BE0F3825` 通过 extra_material_refs 引用 `type: audio_fade`；材料保存 `fade_type: 0`，淡入 200000us，最终淡出 166666us。原生操作如何生成该材料不在本静态子任务推断范围。

## 保存时钟与裁切上限

`0x1372cf0` 读取视频片段的 target.duration，必要时创建 MaterialAudioFade，再把请求的非负 fade_in/out 分别保存为 `min(requested, targetDuration)`。没有在这条保存路径乘除 source duration、平均速度或曲线积分。

音频片段 helper `0xbcea3c` 和已导出的视频后处理 `0x134b850` 也分别把现有 fade_in/out 限制为 target.duration。因此保存值属于目标播放时长体系，不能因 2x 速度直接把材料时长理解成两倍源时长。速度编辑是否在别的控制路径重写 fade，以及曲线变速音频如何叠加，还需实际操作和音频核对。

`0xe58418` 是帧对齐行政处理：经 FrameTimeFactory::create 和虚表 `+0x20` 后把时长写回材料；它不是 DSP。对齐 getter 的条件 ceil 与工厂吸附边界见 `rea-curve-trim.md`。

另外 `VideoUtils::update_audio_fade_in_out_value_if_needed`（`0x133fdf0`）对两个视频片段清掉左片淡出、右片淡入，再限制保留外侧淡变不超过各自 target.duration。这是已恢复的双片段函数体，尚未由本轮调用路径或 UI 样例证明所有分割场景必然调用它，不能据名称扩大结论。

Evidence：设置入口 `ev_4bbeaceeafab8803b629cd760a0823148bc0d65435f5488d75dfe45b46cf20a0`；音频上限 `ev_18dfba36f335520cc0889f3590889a5dfa54e5e628c62b8e9dac43165d689556`；双片段处理 `ev_43d851d16bceb5f055660004602ffc17618bfef321a602d61f6299da7429e5cc`。

## 草稿 fade_type 与实际 SDK 曲线不同

实际视频适配函数 `0x13ea19c` 读取 MaterialAudioFade 的两个 duration，经过邻片与可用时长处理，调用 `0x1cc2a58` 创建音频滤镜。此创建函数从 SDK create helper 的虚表 `+0x88` 调用显式曲线重载：

- 汇编 `0x1cc2b68 / 0x1cc2b6c` 将两个时长放入 x2/x3。
- `0x1cc2b70 MOV w4,#1`，`0x1cc2b74 BLR x9`，固定传入 SDK curve enum 1。
- 此视频路径没有读取 MaterialAudioFade.get_fade_type，不能将草稿 `fade_type: 0` 等同于 SDK enum 0。

SDK `VECreateHelperImpl::createAudioFadeFilter` 显式重载 `0xc5cba8` 把两个时长和 curve enum 原样保存到 AudioFadeFilter。默认重载 `0xc5cb98` 则显式传 enum 0；这是另一个入口，不能替代视频适配层的实参。

Evidence：适配函数 `ev_eceae1b5a70e8d3117aad302542e8aef6fd59708e6e407c7d329b9d9138661bc`；创建封装 `ev_e4f75bd60276cc13b2086fa39042ea4700601a37c19e186d815f404c154355af`；SDK 显式重载 `ev_1606d41dc1c8a82267869ef36a4baebed6483df95ee75ca6f9b5348f473a4070`。

## processor curvetype 1 的增益公式

SDK `AudioFadeInOutProcessor::init`（`0x87b4`）读取 duration、fadein、fadeout、start_time、curvetype 配置。curvetype=1 时，它把同一个本地回调 `0x8714` 交给 `_audio_fading_set_fadein_curve` 和 `_audio_fading_set_fadeout_curve`。

该回调恢复为：`float32(sin(double(float32(x)) * π/2))`。汇编先将 s0 转 d0、乘双精度 π/2，调用 sin，再将 d0 转回 s0。它是四分之一正弦；以归一化进度 x 表达时，0.25/0.5/0.75 对应约 0.38268343/0.70710677/0.92387950，而非线性增益 0.25/0.5/0.75。

淡入候选表达式为 `sin(π*t/(2*fadeInDuration))`；淡出若外部 DSP 采用反向归一化进度，相应为 `sin(π*(end-t)/(2*fadeOutDuration))`。已确认视频 factory 的 SDK enum 1，也确认 processor 配置 curvetype 1 的上述回调，但中间从 AudioFadeFilter 字段生成 processor 配置的函数尚未闭合；不能仅凭两个数值同为 1，排除枚举重映射。公式中的时间步进、外部输入归一化、淡出方向、采样首末端点也仍需原生输出核对，不能把恢复回调等同于完整音频处理链已恢复。

其他本地 enum 也被限定检查：enum 2 回调 `0x8780` 只有 RET，保留输入 s0，属于 identity；Ghidra 把它显示成 void 不能据此断言没有增益。enum 3/4 有其他本地回调，但视频路径固定 enum 1，本轮不将其他回调伪代码推测作为已验收的产品能力。

Evidence：processor init `ev_1ec296d0dcc4037a6f6e497625f8e6cff8fff65f95cc904a73891bb7a38cd700`；正弦回调 `ev_873d58768fb8eeec4d5f697866e8e5433146e9a11d71fbb7a63c02c7d3ea8b60`；identity `ev_d2613130a1157a0e05ec0e08b0f10545a08aa66fe3d80350e4aa0b2e7c8032fe`。独立数值计算见 `independent-gain-reference.json`，不是实际 DSP 执行或原生音频验收。

## 自动短淡变与剩余限制

视频适配层还读取 source neighbour / need_crossfade_in/out 标志：没有邻片时可从全局 `0x26a6610` 取得默认短淡变；crossfade 分支使用 `0x26a6608` 的半时长并处理可用区间。显式正 fade 时长会覆盖相应默认端部值，淡出还受淡入之后剩余可用区间限制。因此没有 audio_fades 材料，不足以证明渲染完全没有短端部增益处理。两个全局的实际运行值没有恢复，不能用静态零初值作结论。

真正的样本处理调用导入的 `_audio_fading_process_interleaving / _audio_fading_process_plannar` 等外部 DSP 接口。本轮按授权限定于已定位的两个库，没有继续分析新库。以下保持未知：

- Processor 日志把 duration/fadein/fadeout 标为 ms，但已查工厂链没有闭合微秒到配置的量化步骤；例如 166666us 是否内部截为 166ms，不能只据日志断言。
- 淡入淡出重叠时底层增益如何组合、淡出归一化方向与样本端点是否包含。
- 与静态 volume、音量关键帧的最终运算顺序、乘法关系及其时钟交汇点；没有由“两个都是增益”直接宣称恢复完成。
- 曲线变速、保调、反向、跨片 crossfade 和音频轨与视频原声是否共用相同完整路径。

主任务正在采集 1x / 2x 实际音频。推荐在同一输出格式中与无显式 fade 基线比较，检查 25%/50%/75% 进度及淡出 166ms 与 166.666ms 两种候选。真实波形核验结果应另追加到产品 QA，不把本静态报告冒充听审。

## 使用记录与关闭

实际视频适配函数分析完成后，完整 MCP 结果超过约 10MB 接收预算，REA 返回 resource_constraint 并保留完整 Evidence；通过分页取出 170909 字符伪代码，没有重跑该分析或把它记为反编译失败。该候选耗时约 57.927s，其余 profile 冷入口约 9.473–18.107s，不能把不同 profile 当作同条件缓存基准。

所有本轮会话均导出 bundle / snapshot 后关闭；两份目标库哈希复核不变。函数、封装、行政处理与实际增益算法分别记录，不据此宣称剪映音频能力或完整 1:1 已完成。
