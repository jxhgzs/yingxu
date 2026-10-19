# REA 对剪映 5.9.0 原生库的真实测试

REA 6.7.0 + Ghidra 12.1.4 已在实际剪映 `libvideoeditor` 的 arm64 提取件上返回 5 个函数的伪代码和调用关系：3 个客户端入口、会话分派入口、速度数据到请求的转换函数。**已经观察到常量速度与曲线点的请求构造，尚未恢复曲线时间映射、音频或渲染算法。**

目标：`artifacts/rea/libvideoeditor.arm64.dylib`，SHA-256 `be0dd5c522e2b0511202cfa2bd27dc7075b3e5ab7cea820bef4c2664d80afe81`。本报告只读解析既有 `structuredContent`，没有执行剪映或发起额外分析。

## 结果与耗时

| 函数 | 地址 / Ghidra 函数体 | 请求墙钟 | caller / resolved callee / unresolved call |
| --- | --- | ---: | --- |
| `VideoClient::splitVideo` | `0x1cc2f0` / 384 字节 | 650.852 秒 | 5 / 5 / 4 |
| `VideoClient::updateVideoSpeed` | `0x1bcf54` / 384 字节 | 0.199 秒 | 6 / 5 / 4 |
| `VideoClient::updateVideoCurveSpeed` | `0x1c7f3c` / 384 字节 | 0.545 秒 | 0 / 5 / 4 |
| `lyra::Server::invoke` | `0x3560f4` / 460 字节 | 1.550 秒 | 1168 / 10 / 2 |
| `lvve::VideoUtils::updateVideoSpeedByVideo` | `0x13502d0` / 2396 字节 | 1.369 秒 | 1 / 20 / 7 |

第一条包含该 profile 的冷分析等待；后四条复用同一会话。这是请求墙钟，不能当作纯反编译时间、函数复杂度或剪映操作速度。caller 数为当前 Ghidra 数据库观察，不是动态调用次数；curve 的 0 不证明该功能未被使用。

此 profile 为 `ghidra-default+disabled:Mach-O Function Starts`，只关闭一项 analyzer，不是关闭全部 30 项模式。3 个函数种子来自调用方的 nm 地址/符号证据，seed SHA 为 `7721a583697c3f7cd8520571c8312ef3bdb72ac21ad3a28b32a3191305c1a7af`；它们不是 Ghidra 自主发现，亦不等于只分析了 3 个函数。

## 观察到的请求和会话边界

3 个 VideoClient 函数都使用各自的 `shared_ptr<lyra::...ReqStruct>`，共用 `lyra::Server::instance()`（`0x354f6c`）及 `Server::invoke(shared_ptr<ReqStruct>, long)`（`0x3560f4`），并出现 shared_ptr 生命周期处理。只替换函数名和一个后续处理 helper，3 段伪代码骨架相同；这些是请求封装，内部没有实际分割/变速计算。

Server 的实现进一步表明：

- 末尾 long 参数等于 `-100` 时走 `FUN_00356364` 特殊分支，业务含义尚未核实。
- 其他值传给 `Server::getSession(long)`（`0x3564f4`）；找到会话后调用 `Session::invoke(shared_ptr<ReqStruct>)`（`0x367974`）。
- 无会话时有明确日志 `Server::invoke: session is nullptr`，随后构造一个含 `0xffffffff` 字段的对象；没有足够类型信息将它定义成完整的错误码/响应协议。

这支持“编辑请求通过统一接口按会话分派”的局部架构结论。`Server` / `Session` 是 C++ 符号，不建立网络、HTTP、云服务、独立进程、异步队列或特定线程模型。Session 的内部处理本轮没有反编译。

## 速度数据转换：已测到什么

`VideoUtils::updateVideoSpeedByVideo` 的实际伪代码包括：

1. 检查 SegmentVideo 与 speed 数据；查询 `MaterialSpeed::get_mode()`。
2. `mode == 0` 时设置局部模式值 0，读取 `MaterialSpeed::get_speed()`；这是常量速度数据分支。
3. `mode != 0` 时读取并检查 `get_curve_speed()`；存在曲线时设置局部模式值 1，读取 `CurveSpeed::get_name()` 和 `get_speed_points()`，遍历非空 SpeedPoint，通过 `get_x()` / `get_y()` 复制两个坐标值并构造集合。
4. 两路汇入请求构造，出现字面量 `VideoService` / `updateVideoSpeed`，随后调用已测过的 `VideoClient::updateVideoSpeed`。这条业务路径把常量/曲线数据装入通用速度更新请求；不能据此认定独立 `updateVideoCurveSpeed` 入口没有用途。

可支持独立实现时把速度数据建模为“常量或曲线点集合”，并将请求准备与引擎执行分开。不能从这些 getter 名推断 x/y 的单位、归一化范围、插值类型、曲线积分、目标时长计算、空点/重复点规则、音高保持或 GPU 行为；这些尚未实测。局部偏移和 `undefined` 类型也不足以当作稳定可调用 ABI。

## 调用关系与覆盖限制

三客户端封装共用 `FUN_000174ec` 和 `__shared_weak_count::__release_weak` thunk；分别调用后续 helper `0x1cc4fc / 0x1bd160 / 0x1c8148`，业务角色未知。split caller 为 `0xc2bd1c, 0xc4c7c0, 0xc56b4c, 0xc57c68, 0xc6d54c`；speed caller 为 `0xb26eb4, 0xbb0d68, 0xc54e7c, 0xfaba5c, 0xfb489c, 0x13502d0`。其他匿名 caller 的 UI/业务角色未核实，完整列表在提取 JSON。

5 个函数的关系覆盖均为 `partial`。各有表中数量的无目标间接调用；Server caller 还缺少 4 个调用来源的归属，VideoUtils 缺少 2 个调用来源的归属。callee/caller 列表不能作为完整行为图，Ghidra 函数体范围也只是本次数据库观测。VideoUtils 伪代码另有延迟 deadcode elimination 的警告，尚未在原程序中动态核验。

自有 oracle 的 271 组通过结果另见 [原生 oracle 评测](rea-native-oracle.md)，不能替代真实剪映算法的动态验证。本轮测出 REA 对大型原生库的调用封装、数据转换和会话边界分析有用；冷分析成本高，恢复深度与类型仍需要检查，不能宣称 1:1 复刻完成。

## 证据与关闭

| 函数 | Evidence ID | 原始 outbox |
| --- | --- | --- |
| split | `ev_8ebba5c910d2a5ff0c4ac960af4a969946cb58cafd236cc3f94499d0f4a067a4` | `002-split.json` |
| speed | `ev_e53bef4c313b61b91488ffa97f3214f8ff605362fec45e5a0caca9d6b25239d0` | `003-speed.json` |
| curve | `ev_c9d1f28d3520e5ed076c79d2ec3f6608a9f840783199050d8bc40fdd74737a7f` | `004-curve.json` |
| dispatch | `ev_b77f1e5eef7cc69c494a58a817b099c7bb25a98f6222bdc27993ba539c53c13b` | `005-dispatch.json` |
| speed-utils | `ev_3290d36fafe626649d4fd7a67cf1b3e6368e637d3324faec3a14b6310a70702b` | `007-speed-utils.json` |

原始文件位于 `artifacts/rea/native-focused-session/outbox/`；原样伪代码、caller/callee、覆盖限制、输入/证据哈希及 profile 在 `extracted/summary.json`、`*.ghidra.c`、`*-relationships.json`。

已有操作 006 导出 4 条证据（5,161,526 字节），008 最终导出 5 条证据（8,921,854 字节）；bundle 的 `unknowns: 0` 是其记录字段，不取消每条函数证据的 partial 覆盖限制。009 成功关闭并保存 snapshot（17,834,874 字节、5 个 primitive entries / 5 条证据），STOP 已由主代理写入。文件大小与实际产物匹配，提取 summary 保留 SHA-256；没有为此报告重新打开分析。
