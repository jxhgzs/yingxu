# REA：转场资源绑定与库存复核（0.7）

2026-10-19；固定 `/Applications/VideoFusion-macOS.app` 5.9.0。仅静态只读调查；没有操作原生 UI、启动目标、下载安装、修改产品源码或提交 Git。原始资源快照、REA Evidence、独立 JSON 解析与校核只存 ignored `artifacts/rea/transitions-v7/`。本轮不重新反编译已归档的 20 个转场函数。

## 结论

本机缓存中**确有 transition 声明的仍只有叠化 322577 与闪黑 321493**。这是两个本地资源包的完整声明检查，不是在线素材库完整库存。新证据补上了两项的实际 shader／Lua／配置绑定，不能据此把任意名称转场映射成同一叠化。

| 项目 | 本轮状态 |
| --- | --- |
| 两个缓存路径是否漏扫 | 已回答：它们指向同一物理目录 |
| 其他本地 transition 声明 | 有界未发现，非在线素材库否定 |
| 叠化像素数学及进度绑定 | 精确资源静态已恢复；原生已有 RGB 证据交叉支持 |
| 闪黑两半进度和不透明黑 | 精确资源静态已恢复；原生已有 RGB／下层绿底证据交叉支持 |
| handles 不足的冻结／黑帧策略 | 仍未知；资源无解码边界策略，不猜测 |
| 曲线端部速度扩展 | 复用已核汇编证据，本轮未新增运行验证 |
| 转场动画字段联动 | 复用已核服务证据；文字动画由独立调查负责 |

## 两条路径与有界库存

同时检查：

- `/Users/tal/Movies/JianyingPro/User Data/Cache/effect`
- `/Users/tal/Library/Containers/com.lemon.lvpro/Data/Movies/JianyingPro/User Data/Cache/effect`

第二条 `resolve()` 等于第一条；两者设备号 16777231、inode 106629809 相同。不能把它们算作两份独立资源库存。首次遍历 7,211 文件、227 个 config.json、8 个 extra.json；主任务真实 UI 下载文字资源期间，随后遍历为 7,215 文件、228 个 config.json、8 个 extra.json。第二次两条路径各自得到相同数量。扫描不是原子快照，数量仅代表两个读取时间点。

对每个 `config.json` 和 `extra.json` 先成功 JSON 解析，再检查对象序列化文本的 transition 声明，仅两个 extra 命中；未把文件名含 fade、glitch 或资源目录数字 ID 当成转场声明。明细为 `bounded-inventory.json` 和 `both-cache-inventory.json`。

| effect_id | 缓存末段 | extra SHA-256 | defaultDura／isOverlap |
| --- | --- | --- | --- |
| 322577 | `2d641adc4bb63e37e3a0067d8c8cc3c3` | `aed526713f1b762623fa7ab2a234b1ea41543d9f2cb7ef9080ca90b3ca3dda4f` | 0.5／true |
| 321493 | `3bca53e9f3dfa2c184fbee96438ea097` | `bc228a293fdf91674ddb5000dc31d095088cba7795af72d23d20c29d6cb4d0e1` | 0.5／false |

## 新 REA 证据与格式边界

使用现有 REA 6.7.0。对直接 JSON 文件调用 `inspect-artifact` 被明确拒绝 `unsupported binary format`，拒绝原文保存在 `rea-extra-322577.json`，没有把失败算为已分析。

随后只把这两个已定位包的全部 38 个文件冻结到本任务 ignored ZIP，保留各文件原路径、长度与 SHA。REA `open_binary` 成功识别 ZIP，`inspect_artifact` 以 `integrity_policy=fail` 完整读取归档，获得：

- ZIP SHA-256：`0677faa6bfb4b5f5e204a45de6a5f51147231555d74795578239e297148a185a`。
- inspect Evidence：`ev_4b145740f8986bdaf9c283233f89c43c1072c232d5b9330811fc189f1b165f19`。
- inventory Evidence：`ev_a83d46a45795b9096ced25021ef599ef576b718cd3ae714d0e12be9d784ce694`。
- manifest：`agm_7587079f835b056a871b8febd3e8a4aeec1f989a617adb9e77a91f945c1bb75b`。

REA 提供字节身份和归档结构证据，**没有解析 Lua／GLSL 的行为语义，也没有执行这些资源**。数学关系由 analyst 对精确 JSON、Lua 和 GLSL 静态阅读独立描述，不能称 REA 运行恢复出的画面。JSON 已用标准解析器读取；`.scene/.material/.xshader` 有 `%SerializedFormat%@` magic、offset20 的小端 version=2，但本轮未完整解码其类型系统，只保留带字节偏移的字符串引用，不能把字符串出现视作运行材质绑定已经证明。明细 `format-bindings.json`。

会话已 `export_evidence_bundle`、`close_binary`，随后写入自有 STOP；helper 正常退出，未保留后台进程。38 个来源文件在结束时重新核 SHA，全部与冻结副本相同，见 `archive-verification.json`。

## 叠化 322577 的独立数学关系

config 通过 AmazingFeature link 指向 `AmazingAuto_out/`，zorder=10000，资源版本 13.3.0。JSON `xshader/generalEffect.json` 明确为单 pass；两输入 uniform 的 inputTextureIndex 分别 0 与 1；progress type=3007，声明 keyframes 为 (0,0) 与 (1,1)、Linear。

Lua 非 debug 路径把 `Amaz.Input.frameTimestamp` 放入协议项 3007；callback 对 type=3007 直接设置 progress。上述 JSON keyframes 在当前 Lua 此分支没有另做 easing。两路输入直接读取 `#TransitionInput0` 与 `#TransitionInput1`。即使片段目标时钟归一化已知，也不能把这个资源推断为使用绝对秒。

最终 fragment 在同一 UV 取两张纹理，RGB 输出为：

`rgb = (1 − p) × A.rgb + p × B.rgb`，`alpha = 1`。

shader 对 alpha **强制不透明**，并非对 A/B alpha 线性混合。其没有在本段显式执行 gamma 解码或线性光转换；输入纹理的颜色意义仍由上游媒体管线决定。`precision mediump` 与 progress 的 lowp 声明也不能直接外推桌面驱动实际数值精度。

关键文件 SHA：

| 包内相对路径 | SHA-256 |
| --- | --- |
| `AmazingAuto_out/xshader/generalEffect.json` | `f8fb7f6e11c501858c61a81f1a94a78612341168c9e3ff63de9575b2fcff75f8` |
| `AmazingAuto_out/lua/SadGE.lua` | `9722c8df776082d6204e4b2c6649515439b90cb25fe6677ecccde9ca9ac1128a` |
| `AmazingAuto_out/xshader/resource1/shader/VerticalGlitch0.frag` | `fbe96fb7fee463ac8f400418aef0ee4ace827b5c2af3b923c78eb676b8014be4` |

当前真实原生导出支持不透明红蓝叠化；已有半透明叠轨实验针对闪黑。不能只凭 shader 最后 alpha=1 就认定叠化发生在全部轨道合成之前或之后；仍应补一份 alpha=.5 红蓝上层＋绿色下层的原生叠化导出。

## 闪黑 321493 的独立数学关系

config 指向 `AmazingFeature/`；Lua 从真实转场输入取 A/B，progress 采用 `Amaz.Input.frameTimestamp`。p<0.5 时选择 A 并把材质 progress 设为 2p；另一半选择 B，把材质 progress 设为 2(1−p)。

`VerticalGlitch0.frag` 向 RGBA 黑色 K=(0,0,0,1) 线性混合。因此完整输出是：

- p<0.5：`C = (1 − 2p) A + 2p K`。
- p≥0.5：`C = (2p − 1) B + 2(1 − p) K`。
- p=0.5：C=K，不透明黑。

包内另有 `VerticalGlitch0 2.frag`，其进度方向相反，不能把两个文件混同。序列化 main.scene 可打印引用依次指向 `material/Black_1.material`、Lua；Black_1.material 引用 `xshader/Black_1.xshader`；Black_1.xshader 引用未带“ 2”的 fragment。该链是字节中的引用观察，完整类型解析仍未完成；其方向由已有原生完整帧淡黑结果交叉支持。

| 包内相对路径 | SHA-256 |
| --- | --- |
| `AmazingFeature/lua/SeekModeScript.lua` | `f8e52d77c9e3f1056070a6cc15c8449b9f67a689f9d6ce5dfbd8052d43159e85` |
| `AmazingFeature/xshader/VerticalGlitch0.frag` | `8eba8eaa012f814a65e9b01942df37075983b6f2638b80c71866b703ce3e8282` |
| `AmazingFeature/main.scene` | `f5c9658d0f6bc0b907460efd157032e5b428cbef62e265b595ef9eb937c135aa` |
| `AmazingFeature/material/Black_1.material` | `c5d7277fc90ada25fe6eef51724c76d0d03170767ec18a5ced590359d7e2dedd` |
| `AmazingFeature/xshader/Black_1.xshader` | `4e7d40bdcba6c4b0aca9d8b6446fbb0ce14fa15999c2ef70d946c6bc18bc1af9` |

此前原生 alpha=.5 上层＋绿底的真实输出在中心同样纯黑，支持下层也随本组闪黑淡出；这不是把上层 RGB 染黑后仍透绿底的效果。跨轨全栈执行顺序仍需分别验证。

## 与既有原生逐帧证据交叉检查

本轮没有新导出，重用 `evidence/2026-10-19-transitions/center-pixels.json` 中真实 30fps、4秒、切点第60帧、D=1秒导出。取同一导出的首尾稳定 RGB 为 A/B，按上述独立数学式计算第45—75帧，与原生编码后 RGB 比较：

| 原生输出 | 最大绝对误差／8bit码值 | 平均绝对误差 |
| --- | ---: | ---: |
| dissolve-1s.mov | 2.4333 | 0.8624 |
| flash-black-1s.mov | 2.7333 | 0.5828 |

这解释了旧原生曲线与资源方程相符；包含 H.264 编码及色彩转换误差，不能称 GPU 浮点逐像素一致、handles 已验证或完整转场库已实现。计算输入 SHA 和范围见 `existing-native-math-crosscheck.json`。

## handles、曲线与动画的明确剩余边界

继续复用 `docs/qa/rea-transitions.md` 的原证据：is_overlap=true→SDK type1；对居中 D/2 的源扩展使用首／末速度点 y，缺点时用备用标量速度；加到带符号端点后 FCVTZS 截断。该内部适配函数没有素材边界 clamp，故**不能推断负 sourceIn 或超过末尾 sourceOut 的最终帧策略**。本轮两项资源也不包含源区间、解码或首末帧策略。源编码帧到真实输出逐帧对照才可解决该问题。

更新转场会对视频动画 start 按新旧半时长差作联动；此函数不是文字动画公式，不能移作文字效果时钟。各动画 subtype、循环、分割及裁切仍以文字调查的独立证据为准。

优先原生补验：编号源右片从0开始、左片结束恰为素材末尾，D=1秒叠化；各自零／充足 handles 对照；再做曲线两端非1速度。须保存原草稿与真实逐帧源编号，不能只看 JSON 源范围未改变。仅两项本地资源的有效数学关系已补齐，完整1:1目标尚未达成。
