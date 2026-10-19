# REA 能力实测总评

本轮真实使用了局部安装的 **REA 6.7.0 CLI 和独立 stdio MCP 会话**，并使用其 `reverse-engineer-anything` skill。REA 对固定二进制身份、组织证据、定向恢复调用关系有实际帮助；本轮进一步得到了真实剪映的速度数据构造与会话分派线索。完整 1:1 复刻仍需功能行为、媒体输出和性能逐项对照，当前结果没有达到该目标。

| 测试 | 实际结果 | 实测范围与耗时 |
| --- | --- | --- |
| [Apple 静态能力](rea-static-capabilities.md) | 4 项成功，15 项独立核验一致 | plist、架构、主程序 arm64 布局、签名；单项 1.709–3.574 秒 |
| [自有原生 oracle](rea-native-oracle.md) | 2 个函数反编译成功；原样伪代码编译后 271/271 组重放一致 | 分割/整数变速与分段线性关键帧；成功调用 9.900 / 10.166 秒 |
| [真实剪映原生库](rea-jianying-native.md) | 5 个函数有伪代码与调用证据；关系均 partial | 3 个客户端封装、Server::invoke、速度数据转换；冷请求 650.852 秒，复用请求 0.199–1.550 秒 |
| analyzer 枚举 | 146 个选项、30 个真实 analyzer，无逗号名称 | 自有小程序 `-readOnly -noanalysis -deleteProject`；7.005 秒 |

这些是本机单次观察，未做重复冷/热性能统计，不作为其他机器的性能承诺。静态 metadata 的结构化包装没有显示速度优势；主要收益是 provenance、对象哈希、覆盖限制与可追溯输出。

## 真实目标带来的信息

剪映的 split / speed / curve 客户端入口使用各自请求类型，共用 Server::invoke；分派入口依据参数查询 Session，再调用 Session::invoke，并处理无会话路径。速度转换函数区分 mode==0 的 speed 值与非零模式的曲线对象，遍历 speed points 的 x/y，之后构造通用速度更新请求。

这给独立实现提供了“文档速度数据—请求构造—会话引擎调用”的可核对分层线索。尚未确认点坐标单位、插值/积分、目标时长、音高保持、实际分割算法、GPU 渲染、错误响应全协议或线程模型。Server/Session 名称不证明网络或进程边界，getter 不等于媒体算法。

## 问题、修正与未覆盖项

- 自有函数首次用未带 `_` 的源码名称选择失败；依据 Mach-O 的 nm 地址改输入后成功，失败 JSON 和 10.226 秒耗时保留。Ghidra 将部分有符号类型推断成无符号，重放仅通过类型别名与 ABI 位模式适配验证，没有把类型猜测写成已恢复 API。
- 大型库默认 profile 的首次搜索在 567.981 秒后由主代理终止并返回失败；改为 3 个明确种子并关闭 Mach-O Function Starts 后完成冷分析。种子只是调用方断言，其他自动分析仍运行，不能把它称为仅分析 3 个函数。后续已枚举更完整的禁用列表，但没有测试“关闭全部 30 项”在大库上的效果。
- Ghidra 在中文安装路径有 Log4j XInclude 警告，实际 bridge 和脚本仍成功；保留兼容性问题，未改系统日志库。
- 本轮没有执行 Frida attach、动态 hook、LLDB 真实调用观察或剪映交互录制，也没有验证动态调用次数、真实媒体输出和调试权限。这些能力没有实测成绩。

## 环境取得与完整性边界

REA npm 包在 `artifacts/rea/runtime` 局部安装，版本/来源记录在 `package-provenance.json`。Ghidra 12.1.4 从官方发布地址取得；下载遇到断流和压缩条目损坏，整 ZIP 的 SHA-256 **未匹配官方预期**。文件名含 `complete` 不构成完整性证明。

本轮运行所需的 JAR/Java 条目经过局部修复与 ZIP 条目 CRC 核对，见 `engine-jar-verification.json`（修复记录 missing 为空）；其余有效条目按解压校验使用。CRC 是传输/条目一致性检查，不是整包来源真实性验证。非运行必需的文档/Windows 参考条目仍有缺件，不能声称整套官方分发包已验证。修复过程与未匹配结果保存在 `download-verification.json`、`crc-verification.json`。

官方包不预带 macOS decompiler，本轮用现有 clang++/make 从包内源码构建 arm64 `ghidra_opt`，30.997 秒完成；236 项源码/Makefile 的前后哈希一致，产物 SHA 已记录。没有安装全局 provider、改全局 MCP 或 Gatekeeper。

## 复现与留存

本机路径/工具版本、各命令、退出码和耗时均在 `artifacts/rea/` 留存。准备与原生 oracle 基准入口为 `scripts/rea-oracle-benchmark.py`；独立 MCP 测试客户端为 `scripts/rea-session.mjs`。依赖、fixture、原始日志和闭源目标的伪代码均在 ignored artifacts，代码仓库没有包含它们；因此干净 checkout 需要重新提供对应局部包、引擎和相同哈希目标，不能宣称零准备一键复现。

真实目标已导出最终 5 条 Evidence 和分析 snapshot 并关闭会话；分别保存于 `native-focused-session/final-evidence-bundle.json` 与 `analysis-snapshot.json`。导出字段 `unknowns: 0` 不覆盖每条函数记录中的 partial 调用覆盖。原样伪代码和关系提取件在 `native-focused-session/extracted`；SHA、耗时、profile 与生命周期操作均有记录。

后续宜复用已导出证据，围绕具体缺口继续函数/行为验证。REA 已证明能提供真实分析线索；把这些线索落实为编辑能力仍需要独立实现与验收。
