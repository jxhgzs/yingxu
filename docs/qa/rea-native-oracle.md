# REA 原生反编译 oracle：真实执行与语义重放

这是自有源码编译的小样例，用于独立衡量 REA + 原生 provider 的结果。不是剪映代码，也不代表剪映全功能已经恢复。真实目标上的复杂函数需要另行验证。

## 样例和已通过的核验

- 源码：`artifacts/rea/oracle-test/editor_oracle.c`。
- arm64 Mach-O：`artifacts/rea/oracle-test/editor_oracle`，Apple clang 17.0.0，`-arch arm64 -O1 -g -fno-inline -Wall -Wextra -Werror`；未 strip，全局函数符号保留。
- 两个待测函数：`split_and_retime_us`（地址 `0x100000460`）、`keyframe_value_milli`（地址 `0x1000004a8`）。地址仅适用于本次二进制，改编译器或源码后须重新读取。
- 独立 Python `fractions.Fraction` oracle 实际执行 271 组，271 通过、0 失败；133 组 split/speed、138 组关键帧。完整输入、预期、实际、退出码与耗时在 `oracle-results.json`。
- REA `decompile --help` 已留存；本轮两个函数实际反编译成功，恢复的原样伪代码编译后重放 271 组，271 通过、0 失败。完整证据与局限见下文。

## 对照标准

`split_and_retime_us(start,duration,split,speed)`：

1. start/duration 非负，且 start + duration 不溢出有符号 64 位。
2. speed 在 1..16，split 在闭区间 [start,start+duration]；非法返回 -1。
3. 右段长度为 `(start+duration-split)/speed`，正数整数除法向下取整。
4. 对 0..6 秒素材在 3 秒处分割，右段 2 倍速输出精确 1,500,000 微秒。
5. 边界包含 split=起点、终点、前后一微秒、空段、INT64_MAX 与溢出防卫。

`keyframe_value_milli(time_us)`：

1. 固定四个关键帧 `(0,0), (1,000,000,1000), (3,000,000,-500), (6,000,000,2000)`。
2. 小于等于 0 返回 0，大于等于 6 秒返回 2000。
3. 三个区间分别线性插值；增减量的正数商截断后再加/减锚点值。这一定义不能替换成对整个负数结果取整。
4. 核对每个关键帧前后一微秒、两个不同斜率、非零和负值锚点，以及域外夹紧。

本轮已逐项比较条件、分段边界与公式，并在原样伪代码重新编译后执行边界重放。成功退出、函数名正确、能打印伪代码均不足以算语义通过。

## 复跑

在仓库根目录执行 `/opt/homebrew/bin/python3.13 scripts/rea-oracle-benchmark.py --prepare`。此命令只编译和执行本目录的自有 fixture，不启动剪映，不安装 provider，不修改全局设置。重复执行会覆盖该样例的构建与 oracle 产物。

## Ghidra macOS ARM 原生 decompiler 补齐

官方 Ghidra 12.1.4 包不预带 macOS decompiler。已先读取自带 `GettingStarted.md` 的 Building Native Components：官方支持 macOS ARM 用户自行构建，完整推荐流程为 Gradle `buildNatives`。本次遵循局部范围，仅用现有 clang++/make 构建其 C++ `ghidra_opt` 目标，不下载 Gradle、不构建其他原生模块。

自带 Makefile 的 Darwin 默认仍为 `-arch x86_64` / 最低系统 10.6；没有修改源码或 Makefile，通过命令行变量指定 arm64 和最低系统 11.0：

```text
/usr/bin/make -j4 ghidra_opt \
  'CXX=/usr/bin/clang++ -std=c++11' \
  'ARCH_TYPE=-arch arm64' \
  'ADDITIONAL_FLAGS=-mmacosx-version-min=11.0 -w' \
  'OSDIR=mac_arm_64'
```

实测退出 0，30.997 秒；构建前后 236 项源码与 Makefile 哈希均未变。`file` 验证为 `Mach-O 64-bit executable arm64`，拷贝至该局部 Ghidra 的 `Ghidra/Features/Decompiler/os/mac_arm_64/decompile`，SHA-256 为 `36eb0df940f4f9a6ba4979699081f5870d15999464625d01c489ccfa0239b216`。

记录：`artifacts/rea/native-build/build.json`、`source-manifest.json`、`make.stdout`、`make.stderr`。初次生成依赖文件时 make 输出过 `ghi_opt/depend: No such file or directory`，随后自动生成并成功构建；没有把这条初始提示当作最终失败。随后已在 Java 环境就绪后通过 REA 的两个真实函数反编译验证，不只依赖 `file` 结果。

## 两个真实 REA/Ghidra 反编译请求

运行环境为局部 REA 6.7.0、Ghidra 12.1.4、现有 JDK 23.0.1，自有 native decompiler，`GHIDRA_HEADLESS_MAXMEM=1G`。所需 JAR/Java 文件由主代理逐文件 CRC 核对；完整官方 ZIP 的 SHA 尚未匹配，部分非运行所需文档/Windows 参考数据仍缺件，不能称整个分发包完整验证。

| 请求 | 结果 | 墙钟耗时 | 证据 |
| --- | --- | ---: | --- |
| 裸符号 `split_and_retime_us` | 退出 1：`Unknown Ghidra procedure name or address` | 10.226 秒 | `rea-split_and_retime_us.stdout` |
| 地址 `0x100000460` | 退出 0，返回 `_split_and_retime_us` 伪代码 | 9.900 秒 | `rea-split_and_retime_us-address.stdout` |
| 地址 `0x1000004a8` | 退出 0，返回 `_keyframe_value_milli` 伪代码 | 10.166 秒 | `rea-keyframe_value_milli-address.stdout` |

失败未隐藏：Mach-O 的真实导出符号带前导 `_`，首次使用未加前缀的源码名称失败。随后依据已观测的 nm 地址修正输入，没有重复安装或盲目重试。脚本现改为从当前二进制的 `nm -g` 获取精确地址，不依赖重编译后可能变化的固定地址。

首次失败的诊断还留存了 Ghidra 在中文安装路径解析 Log4j XInclude 时的 `Opaque part contains invalid character: 天` 警告。bridge 已实际正常回复，改用地址后成功；本轮未修改系统路径或日志库，仍将该兼容性问题保留为限制。

## 逐项语义核对

分割/变速函数：

- 伪代码 `-1 < (long)(param_2 | param_1)` 同时验证 start/duration 非负。
- 非负 start 下，`param_1 ^ 0x7fffffffffffffff` 等于 `INT64_MAX-start`，与 duration 的比较恢复了原先加法溢出防卫。
- `0xffffffef < param_4 - 0x11` 在 uint32 模运算下恰好允许 1..16，拒绝 0、17 及负 int 对应位模式。
- 两个带符号比较恢复 split 的闭区间；最终 `(end-split)/speed` 为非负时长的整数除法。额外的除零分支是反编译结果的一部分，原样保留。

关键帧函数：

- `(long)param_1 < 1` 与原始 `time_us <= 0` 一致；其后三个 `<` 保持 1、3、6 秒的边界，末尾返回 2000。
- 第一段化简为 `param_1 / 1000`，在所覆盖的非负区间等价于原来的乘 1000 再除 1,000,000。
- 第二段 `1000-(t*0x5dc-1500000000)/2000000` 恢复了 `1000-(t-1000000)*1500/2000000`。
- 第三段 `(t*0x9c4-7500000000)/3000000-500` 恢复了 `-500+(t-3000000)*2500/3000000`。
- 所有乘法均在对应有界正数分段内，域外值先被夹紧，未用数学实数公式掩盖整数截断行为。

## 原样恢复、编译与 271 组重放

从两条 Evidence 的 `normalized_result` 自动提取原始字符串，并断言与 `raw_result.value` 相同。保存为两个 `.ghidra.c` 文件后拼接，仅增加 `ulong/uint` 类型别名、位宽断言和 CLI 测试适配器；**没有改分支、公式或常量**。Apple clang 以 `-arch arm64 -O1 -Wall -Wextra -Werror` 编译，退出 0，0.341 秒。

逐组使用同一批预先生成的 271 个输入，对比独立 Fraction oracle、原源码编译产物、恢复伪代码编译产物：271 一致、0 失败。样例不是仅挑成功样本，包含未定义域拒绝、边界、截断与负关键帧值。记录保留每组完整输入、三方输出、退出码与耗时。

类型恢复存在实质限制：Ghidra 将 `keyframe_value_milli` 的返回值推断为 `ulong`，原源码是 `int64_t`。测试适配器将 ARM64 返回寄存器位模式解释为 `int64_t`，负数结果才与原 API 对齐。输入中原先带符号的整数也被推断成部分无符号类型；分支内部保留了带符号 cast。因此本轮证明的是这些输入的 **ABI 位模式与运算行为匹配**，不是原始 C API 类型或源码文本完整恢复，更不是任意输入的形式化证明。

Evidence ID：

- split/speed：`ev_4af40483c7eac0c5a106bfee78f789e501a44ace11b1f48e4dc09f89781895c8`
- keyframe：`ev_2bc1b8ec48ba0505d2dadc39b8de1bdd75b4bc2d0eb299b57c04fe4daf0c1620`

重放文件：`artifacts/rea/oracle-test/recovered-replay-results.json`、`recovered_pseudocode.c`、`recovered-build.stdout/stderr`。重放脚本：`artifacts/rea/oracle-test/restore_replay.py`。`scripts/rea-oracle-benchmark.py --decompile` 需要显式设置以上局部环境变量；CLI 会逐次建立和关闭临时 Ghidra 分析环境。

## 对 REA 能力的结论

本轮真实测到了 REA 原生反编译链路：两个短小、已有符号的 arm64 函数可以恢复为可编译表达式，并通过有针对性的边界重放。结构化 Evidence 可绑定输入 SHA、provider 版本和分析配置；名称选择、整数有符号性和运行环境仍需人工核对。每个独立 CLI 请求约 10 秒，包含重复导入/自动分析成本；这不是纯反编译函数耗时。

该结果不能外推为剪映大型、剥离符号、多线程/GPU/Qt 框架下所有函数都能恢复。自有 oracle 和真实目标分析必须分别记录；业务行为复刻仍要由真实操作及输出对照验证。

## 大库性能调查辅助：精确枚举 analyzer

为缩小真实大库的后续分析范围，另用上述自有微型 Mach-O，直接通过官方 `analyzeHeadless` 的 `-readOnly -noanalysis -deleteProject` 和独立只读脚本 `ReadAnalyzers.java` 枚举实际分析选项。没有启动另一份大库分析、修改 REA 或 Ghidra 现有源码。

1G 堆运行 7.005 秒、退出 0，返回 146 个选项，其中 30 个选项同时满足 `AutoAnalysisManager.getAnalyzer(name) != null`。这些是 analyzer 名，其他诸如超时、阈值等子选项没有混入禁用名单。30 个名称均不含逗号，可直接用逗号连接传入 `REA_GHIDRA_DISABLED_ANALYZERS`。

- 完整选项与默认值/类名：`artifacts/rea/analyzer-options.json`
- 一行一个 analyzer：`artifacts/rea/analyzer-names.txt`
- 可直接读取的环境字符串：`artifacts/rea/analyzer-disabled-env.txt`
- 脚本、命令、退出码与耗时：`artifacts/rea/analyzer-probe/`

名单只覆盖本次 Ghidra 12.1.4 对该 arm64 Mach-O 实际注册的 analyzer。把它用于其他对象时须以 REA 的验证结果为准，不能推断所有格式的 analyzer 都相同。关闭全部 analyzer 会减少自动发现、类型推断和引用覆盖；下一步应只对有 nm 地址证据的目标函数建种子并精准反编译，不能把缩小范围的结果包装成整库分析完成。本轮没有验证关闭全部 analyzer 后大库的速度或完整性。
