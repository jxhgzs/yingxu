# REA 6.7.0：剪映 5.9.0 Apple 静态能力实测

本轮使用 REA 自带 `reverse-engineer-anything` skill 的 native/artifact 指引，通过局部安装的 CLI 真实运行。未配置全局 MCP；这些结果不等于当前聊天已接入 REA MCP。目标为 `/Applications/VideoFusion-macOS.app`，不启动目标、不修改目标或原始基线。

## 实测结果

| REA 操作 | 耗时（单次墙钟） | 退出码 | 独立核验与用途 |
| --- | ---: | ---: | --- |
| `inspect-plist` | 3.574 秒 | 0 | 与 `plutil` 的完整 JSON 深比较一致；固定 5.9.0 / `com.lemon.lvpro` 身份、启动文件与声明配置 |
| `list-architectures` | 1.709 秒 | 0 | 与 `lipo -archs` 一致：x86_64、arm64；保留 slice 文件偏移与大小 |
| `inspect-macho` | 2.084 秒 | 0 | 与 `otool -arch arm64 -l` 一致：78 条 load commands、60 条依赖、UUID、入口文件偏移；指导后续选择具体原生库 |
| `inspect-signature` | 1.973 秒 | 0 | 与直接 `codesign` 一致：标识、团队、CDHash、hardened runtime 和全部 entitlements；界定调试前提 |

4/4 操作成功，15/15 独立断言通过，失败 0。每次命令、stdout、stderr、退出码、耗时均保留。上述是本机单次测试，未做冷启动/热缓存重复试验，不推断其他机器性能。

主程序 SHA-256：`62167243d729ae663731b8e224d1eeb204a601242a40fc1f0b86d3aba49a492c`。REA 四条记录均与独立文件哈希相同。

## 对复刻工作的实际帮助

- 结构化结果保留 Evidence ID、实际工具命令、工具可执行文件哈希和覆盖限制，便于把结论关联到固定二进制，而不是凭产品名或库名猜测。
- 当前选中的 arm64 主程序直接依赖 QtCore、QtQuick、QtQml 等，load-command 版本声明为 6.2.2；同时列出 `libvideoeditor.dylib`、`libeffect.dylib`、`libAGFX.dylib` 和 FFmpeg 系列库。这能帮助后续选择正确的分析入口，不能仅凭链接关系确定功能实现。
- Info.plist 声明最低 macOS 10.14；arm64 slice 的 LC_BUILD_VERSION 声明最低 11.0。必须区分 bundle 声明和选中架构的实际构建信息，不能把 10.14 当作 arm64 的兼容保证。
- 签名记录声明 hardened runtime；entitlements 未列 `com.apple.security.get-task-allow`。这为后续 LLDB/原生调用观察提供边界线索，未尝试 attach，也未据此宣称调试已成功。

## 能力评价与边界

这组能力对“固定对象、盘点原生依赖、审计证据”有用，结果与系统工具一致。CLI 本质上对系统工具增加了结构化和 provenance 包装；本次 REA 单项需约 1.7–3.6 秒，直接 metadata 命令约 0.006–0.021 秒，未观察到速度优势。额外运行的 `codesign --verify --deep --strict` 约 4.5 秒且退出 0，是独立完整性检查，不是 REA `signed: true` 自动提供的信任结论。

本轮没有恢复函数伪代码、原始源码或剪辑算法。`inspect-macho` 的 imports/exports 显式 `exhaustive: false`，不能根据未返回某个符号推断没有某项功能。仅对主程序的 arm64 slice 核对 Mach-O 布局；其他库、x86_64 函数体、动态加载关系、GPU 行为、云端服务与界面操作均不在本轮覆盖范围。签名 metadata 不等于 notarization 或完整信任评估。这四项通过不能证明 1:1 复刻已完成。

## 证据与复跑

- 原始记录：`artifacts/rea/static-test/runs.json`
- 独立验证：`artifacts/rea/static-test/verification.json`
- 四条 REA 记录：同目录的 `inspect-plist.stdout`、`list-architectures.stdout`、`inspect-macho.stdout`、`inspect-signature.stdout`
- 复跑命令：`/opt/homebrew/bin/python3.13 artifacts/rea/static-test/run_benchmark.py`，随后 `/opt/homebrew/bin/python3.13 artifacts/rea/static-test/verify_static.py`
- 脚本只读取目标，产物写入独立 `artifacts/rea/static-test`。重复运行会替换该测试目录下的同名输出，不修改基线或产品文件。

Evidence ID：

- plist：`ev_95247ec476d98f9ddb291f0b66d79e1305f8e55dd195b5cd6d3df7a30021f281`
- architectures：`ev_690e1a1bf27c76b63708f1df80b4acc8fdf20ed0418bedf302df8ff46c98608a`
- Mach-O：`ev_eb0ba33b99053b28091f44d7e8102bc9c96a020b23a5cb3671d5c13d4e8c1940`
- signature：`ev_191b298e254cf8aec2925c1f2686ae5c1ba401c05c7635f6716639b30ab69095`
