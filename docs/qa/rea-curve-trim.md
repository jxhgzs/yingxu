# REA 曲线直接裁切与帧量化

2026-10-19。本轮只做静态分析和独立数值复算，没有修改产品源码、原 app，也没有操作原生 UI。原生操作及导出由主任务在专用草稿采集。结论限于本机剪映专业版 5.9.0 和已测 30fps 样例，不代表全部裁切、关键帧或媒体行为已一致。

## 固定目标与证据目录

- 只读复用 `artifacts/rea/libvideoeditor.arm64.dylib`，前后 SHA-256 均为 `be0dd5c522e2b0511202cfa2bd27dc7075b3e5ab7cea820bef4c2664d80afe81`。
- 新会话全部在 ignored `artifacts/rea/curve-trim/`，分为 `native`、`handlers`、`final-path`。闭源伪代码和汇编仅留在该目录，不复制进实现或本文。
- 复用本地 REA、Ghidra 12.1.4、Java 23；没有下载安装或修改依赖。使用已核验函数地址种子和关闭 31 项实际存在的 analyzer 的独立 profile；关系覆盖受此限制。
- 每个会话均导出 `evidence-bundle.json`、`snapshot.json` 后 `close_binary`。初步 `ceil-hypothesis.json` 保留当时尚未闭合调用链的状态；最终独立复算为 `final-replay.json`。

## 裁切实际调用路径

| 层次 | 入口 | 地址 | 证据结论 |
| --- | --- | --- | --- |
| 服务注册 | updateVideoTimeRange 回调注册 | `0x143c6e8` 内 `0x143d420` | ADR 指向 `0x14196b0`；此大函数本身是注册表，不是裁切算法 |
| 服务回调 | 时间请求分发 | `0x14196b0` | 调用 `0x1361298` |
| 视频更新 | updateVideoTimeRange | `0x1361298` | 提取 clip type/value 和可选 curve points，调用 DraftUpdate，再更新片段特效和轨道 |
| 区间数学 | DraftUpdate::update_segment_time_range | `0x1705d20` | 保存的平均速度参与源区间换算，结果先截断微秒，再经帧工厂写目标时长 |
| 对齐 getter | FrameTime 对象虚表 `+0x20` | `0x160ed60` | FRINTP 向正无穷取帧，再 FCVTZS 截断微秒 |
| 不对齐 getter | 非对齐对象虚表 `+0x20` | `0x160eeec` | 直接返回原始微秒；不能将全部调用概括成无条件 ceil |

关键 Evidence：区间数学 `ev_65406e5d6a35e9022c421eb5d4b9b8046e8d4740ca93221fe6460e8edc911a88`；对齐 getter `ev_366a0481565eab760612a0790c6dbf1b8c8df0835ed2f298af4bfe79b6076990`；非对齐 getter `ev_2ceb7d96c3320480e5e514b2ff65a47448277b2b210400a1cc7d0f4fe56f1723`；服务回调 `ev_a2bb6972a02eb0aae0953625f615f48b342498a65e6dd1f11f68c64c6f4c9955`。

## 空曲线点请求的直接裁切

此路径读取片段保存的 `MaterialSpeed.speed`。对于曲线片段，这是平均速度元数据；不按曲线积分求裁切位置，也不修改现有曲线点。输入请求 points 非空时有另一个重建曲线分支，不能与当前空点路径混为一谈。

设旧目标起点为 T、时长为 D，旧源起点为 S、时长为 L，保存的平均速度为 A，所有时间为整数微秒。对于本轮没有触及素材边界的样例，独立表达为：

- 左裁到 U：`delta = trunc(A * (T - U))`，新源起点 `S - delta`、源时长 `L + delta`，新目标起点 U。实际函数还把 U 限制为不早于 `trunc(T - S/A)`，并处理负源起点和目标起点；本轮未测试这些极限路径。
- 右裁到目标终点 V：`delta = trunc(A * (V - (T+D)))`，新源时长 `L + delta`，源起点不变。
- 更新源区间后计算 `rawDuration = trunc(newSourceDuration / A)`；对齐开启时，经帧工厂虚表 `+0x20` 得到目标时长。

指令证据：右裁乘法 `0x1706144 FMUL`、`0x1706148 FCVTZS`；左裁 `0x1706244 FMUL`、`0x1706248 FCVTZS`；剩余时长 `0x170626c FDIV`、`0x1706270 FCVTZS`；`0x17062e4` 调工厂、`0x17062f0` 读取虚表 `+0x20`。FCVTZS 是向零截断，不能把负 delta 改写成 floor。

原生草稿位于 `evidence/2026-10-19-curve-trim/`：

| 操作 | 源区间结果 | sourceDuration / A 截断 | 对齐目标时长 | 原生结果 |
| --- | --- | --- | --- | --- |
| `01-left-edge-drag`，左曲线左裁 .2s | start 235762、duration 864238 | 733142 | 733333 | 一致 |
| `02-right-edge-drag`，左曲线右裁 | start 0、duration 1021413 | 866475 | 866666 | 一致 |
| `03-second-left-edge-drag`，右曲线左裁 .2s | start 1452153、duration 1547847 | 879076 | 900000 | 一致 |

其中 `trunc(200000 * 1.178813075249991)=235762`，`trunc(200000 * 1.760765192046442)=352153`。第三例排除了 nearest/floor：879076us 最近的 30fps 帧为 866666us，实际为 900000us。

工厂另有已观察的 800us 处理：先将时间拆成整秒和秒内帧坐标 q；若 `abs(q-trunc(q)) < 800/framePeriod`，先把 q 吸到向零整数，再执行 getter。因此正时间是“刚超过下帧不到 800us 时先向下吸附，其余向上取帧”，不能将它解释为“离上帧不到 800us 才 ceil”。工厂原证据复用 `curve-followup/frame-clock/002-create`、`003-create-aligned`。恰好 800us、不同帧率、跨整秒及负时间没有本轮 UI 对照；全局 auto_alignment 的静态 BSS 初值不能当作运行值。三次原生结果支持本轮 UI 使用了对齐对象。

分割产生的已有时长不能据此全局重算。基线左曲线 L/A 的对齐值为 933333us，已保存 D 却是 900000us；右曲线相应为 1100000us 与 1066666us。只有正在裁切的片段走上述换算。

## 后续片段的端点对齐

调用链进一步闭合到 `VideoUtils::update_video_special_by_timeRange`（`0x134b850`）。请求 byte `+0x6a` 为真时，它调用 `adjust_track_target_start_time`（`0x16ff4e8`），再对每个片段调用 `align_timerange`（`0x170173c`）。主轨且磁吸开启时，从 0 开始按前片终点顺排；主轨磁吸关闭或副视频轨保留首片起点，并以 `max(后片原起点, 前片终点)` 继续，允许保留原间隙。转场和其他轨型还有独立分支，本轮未逐项实测。

`align_timerange` 对两个绝对端点分别调用同一 `+0x20`：新起点为 align(start)，新时长为 align(start+duration) - align(start)。其函数返回值占 ARM64 x0/x1；Ghidra 伪代码只显示 x0，不能据此漏掉时长。汇编 `0x170182c SUB x20,x20,x19`、`0x1701838 MOV x1,x20` 确认第二返回值。

`01` 中未裁右曲线保存 duration 1066666us，被前片推进到 start 8433333us 后，end 对齐为 9500000us，结果 duration 1066667us；源区间及曲线元数据不变。这与原生保存值相同，无需重算 sourceDuration/A。

Evidence：轨道顺排 `ev_a11569523ae3961e2aea3857ebf01999f262f2cee026754df5d26ac068584bd9`；端点对齐 `ev_c57953706bbc6705b2deda5fe16ea8117700907ce13aee9ac1a584c863a19299`；视频后处理 `ev_babdb7354f7fa5a385344e15e1d93786d3d950d0d7f950b743331ab153c2f044`。完整 ID 以各原始 dossier 为准。

另有 `arrange_after_spread`（`0x134bc50`），在请求 byte `+0x49` 非零、且不走主轨磁吸时从选中片段向前后推开重叠，保留片段时长。该函数与上述磁吸顺排不同，不能只凭函数名称替代实际请求条件。

## 媒体与关键帧边界

主任务已从 `03` 导出 27 个真实源编号帧，证据为 `artifacts/qa/curve-trim/native-matches.json`。源起点 1452153us 介于第 43/44 帧，实际首帧为 43；声明源终点为 3s，末帧却出现源编号 90，即 3s。说明不能用声明源时长钳制曲线积分或简单将非帧源入点直接作为解码首帧。该媒体实现由主任务处理，本静态子任务没有改渲染代码。

主任务另测 `04/05` 恒速关键帧裁切：越界点被删除，没有分割式的插值边界；最后一点被删时，静态属性落为原剩余单点值。当前 wrapper 确有 `clear_video_effect_keyframes`（`0x1345184`）及后续特效时间更新，但尚未定位 common keyframes 的实际过滤函数，不能由 effect 函数名称推断其规则。本轮没有开放曲线含动画裁切。

## REA 使用边界

`handlers` 首个大函数是注册表，41.610s 分析完成后因大于 MCP 10MB 返回资源限制；通过 retained evidence 的分页视图取出 123871 字符，避免误判引擎分析失败。另一个自动对齐函数也同样保留完整证据。不同 seed profile 的首次函数分析约 29.140s、41.610s、21.047s，后续函数通常低于数秒；这些是不同 profile，不能宣称同条件缓存提速。

本轮证据回答了平均速度裁切、向零截断、条件 ceil、两绝对端点对齐及磁吸顺排入口。尚未覆盖素材极限、反向/音频、NTSC/VFR、800us 边界、转场、所有轨型与 common keyframes 静态过滤，不据此宣称剪映完整 1:1 已完成。
