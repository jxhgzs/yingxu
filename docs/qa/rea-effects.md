# REA：剪映 5.9.0 本地调节与特效资源调查

本轮对固定 `/Applications/VideoFusion-macOS.app` 做了 REA artifact inventory，并用 REA/Ghidra 分析 3 个精确原生入口。发现包内有 **35 个基础调节资源变体、670 个文件**；可读取部分数学公式、参数桥接和合并调节顺序。没有操作原程序 UI、执行 GPU shader 或核对实际输出，不能把资源存在或公式可读记为“画面已与剪映一致”。没有复制闭源 shader、纹理、场景或伪代码到产品实现。

## 本地具备什么

| 范围 | 静态证据 | 离线可用边界 |
| --- | --- | --- |
| `DefaultAdjustBundle` | brightness、contrast、saturation、sharpen、highlight/shadow、temperature/tone、fade、light_sensation、vignetting、particle、hsl、black_white、clear 与多代变体 | 本地有配置、Lua、shader/材质/场景及部分 LUT。35 是资源变体数，不是 35 个独立已验证功能；尚未在运行引擎执行 |
| `combine_adjust` | 本地 Lua + 单个调节 shader，亮度/对比度等多项合并；lightSensation 两张 LUT PNG 均为 289×17，fade 纹理为序列化容器 | 所需资源文件就在 app 内；当前合并路径是否启用未知。资产不随独立产品复制 |
| `Resources/lut` | `AmazingFilter` 配置，Link.path 为空；另有算法图与 skinseg 声明 | 是滤镜框架配置，不能据此称已有所有 LUT/命名滤镜。实际 LUT 数据和算法依赖要另外提供/核对 |
| `Resources/oobe/effect/...` | 安装包带一个 ID 为 4118382 的特效样例；extra.json 有 speed/intensity 默认、最小和最大值 | 样例本体在本地，但不能代表素材商店目录或所有特效均离线可用 |
| `VEMetalBinary_Mac.bundle` | 本地包含纹理采样、YUV/RGB 与 HDR/SDR 转换的 metallib 文件 | 说明有 Metal 资源；未执行，不能推断当前 GPU 路径、吞吐或预览一致性 |

本轮只读安装包与既有分析提取件，没有读用户资源缓存或查询在线素材目录。**尚不能列出具体哪些命名商店特效必须联网下载**；也不能把“安装包没有某文件”当成这台机器缓存没有。独立产品若要支持未随包携带的特效、风格 LUT、模型等，必须获得对应资源，来源可为下载或用户导入，不能用默认样式静默替代。

## 格式、参数和顺序

`config.json` 的 `effect.Link[]` 给出 `path/type/zorder`；这里多数 type 为 AmazingFeature。入口通常为 `AmazingFeature/` 或 `amazingfeature/`，HSL 为 `HSL/`。内部有 JSON 元数据、Lua 的 `SetEffectIntensity` 事件、GLSL 文本，以及带 `%SerializedFormat%@` 标记的 `.scene/.material/.xshader/.texture` 容器。部分旧 GLSL 文件包含转义的换行文本；不能把所有资源都当作可直接读取的 JSON 或标准 GLSL 文件。二进制容器本轮只识别边界与引用，没有实现完整解码。

旧资源常用事件 key `intensity`；合并资源用 `brightness_intensity`、`contrast_intensity`、`saturation_intensity` 等独立 key。合并 Lua 默认强度 0，常用归一化区间 -1..1，fade 限制 0..1，启用阈值为 `abs(intensity)>1e-5`，contrast pivot 为 0.435。这里的强度不能未经核对直接等同 UI 百分数或草稿字段。

合并 shader 的实际处理顺序为：

**brightness → contrast → saturation → highlight → shadow → black/white → temperature/tint → fade LUT → light_sensation LUT**。

每个启用阶段后都有 RGB clamp，alpha 在这些运算中保留。顺序变化、只在最后 clamp、输入颜色空间不同都会改变结果。不同独立包的 zorder 还有 999/8011/10000/10010 等值，不能单凭这些声明推断整个剪映特效栈的全局顺序。

## 可以独立描述的公式候选

以下是对本地资源的数学观察，供独立设计和后续对照使用；不是已经通过原生输出验收的实现规范。没有把 shader 源码放进产品。

- **亮度 v2 / 合并版**：强度 i≤0 时 b=i；0<i≤0.7 时 b=0.3i；0.7<i≤1 时 b=0.6333i−0.2333。b>0 时指数 p=1+5b；否则 p=1/(1−2.5b)，输入 RGB 另减去 `−0.01b`。各通道输出 `1−(1−c)^p` 后 clamp。它不同于线性加亮或直接加曝光。
- **饱和度合并版**：s=1+i，Y=0.208540R+0.702086G+0.089374B，输出向量 `s·RGB+(1−s)·Y` 后 clamp。不能替换成任意 luma 权重并称像素一致。
- **对比度 v3 / 合并版**：i≤0 时 k=1+0.4i，否则 k=1+0.6i。k≤1 为绕 0.435 的线性缩放；k>1 为 sigmoid 加端点修正，sigmoid 参数 `a=exp(8.33k−12.16)+5.82k−1.72`。修正依据端点/pivot 导数差的平方比例，不是单纯 contrast 乘法。
- **高光/阴影合并版**：参数分别为 `1+0.503i+0.183i²+0.147i³+0.067i⁴` 与 `1−0.503i+0.183i²−0.147i³+0.067i⁴`。阴影通道曲线为 `c^p+(p−1)(c²−c³)`；高光是其关于 (0.5,0.5) 的反向形式，阶段后 clamp。
- **黑白场合并版**：通过位于四条边上的两个控制点求 slope/bias，位置偏移尺度 0.5，最小间隔 0.005；最终为仿射映射后 clamp。不是“黑白滤镜”或全局去饱和。
- **暗角 v1**：强度先经两组不同控制点的 cubic Bezier 映射，再用于空间 shader；控制点与二分精度可读。仅实现径向乘暗不能直接称符合这套暗角。
- **fade / 光感和旧版亮度、对比度、饱和度**：使用本地 LUT 或纹理查表/混合；仅有算法名称不够，纹理内容是结果的一部分。旧版采用 17³ LUT 网格，新版存在不同路径，必须确认目标实际选择版本。

温度/tint 的矩阵、黑体近似表、HSL、锐化、颗粒等还有更多可读资源；本轮未逐项恢复或执行。即使公式独立重写，仍需核对纹理格式/采样、RGB 编码/线性空间、预乘 alpha、色彩管理、浮点精度、顺序和实际 slider→uniform 映射。不能把静态公式直接当作跨 FFmpeg/GPU 一致性的证明。

## 实际 REA 原生结果

| 原始符号 / 地址 | 观察 | 请求墙钟 / Evidence |
| --- | --- | --- |
| `lvve::CreatePresetAdjust` / `0x16827d4` | 解析 JSON 成功后调用 StructCoding::Deserialize，失败记录 preset JSON parse error；没有恢复资源版本选择 | 14.364 秒 / `ev_5f0f69117986e4e17a7a1e3ae974640391c04287321b527c47bf39f63994a4a7` |
| `lvve::preset::AdjustBase::RegisterParams` / `0x1683168` | 注册 brightness/contrast/saturation/sharpen/highlight/shadow/temperature/tone/fade/light_sensation/particle/vignetting/white/black/clear 的 `_value` 字段及 enable | 0.283 秒 / `ev_fd75af619c6b523c961e0dbef6c653b37bbfcf4fe9a09545c3b00fc6cd6d083c` |
| `lyra::AbtestConfig::getMergeAdjustColor` / `0xc278` | 返回一个带引用计数的配置对象；没有读到当前运行时布尔值 | 0.014 秒 / `ev_1c4508a6c2cfc635b3717fca95991c396ce2511c0d5288a06fad8f4612c5f722` |

原生符号定位由 nm 核对；自定义 seed 名只是本轮标签，不能称 Ghidra 自主发现。profile 复用对实际 libvideoeditor 枚举的 analyzer 禁用名单、1G 堆及 3 个精确种子；CreatePresetAdjust 调用关系仍 partial。以上结果证明预设参数接口存在，不证明其字段已直通 shader，更没有证明算法在 CPU/GPU 上的实际结果。

`libVECreator` 的只读字符串搜索另命中 `DefaultAdjustBundle`、brightness_v2、contrast_v3、combine_adjust。该库没有在本轮反编译，字符串存在无法决定当前资源选择/AB 配置。

## 证据、复核和关闭

- REA `inspect-artifact` 实际成功，5.184 秒；Evidence `ev_8ba3cab42fdf2a353252f24f47c6c0a8cb51360185c0995c501510b51bb8111e`，内部 inventory Evidence `ev_49b3f997a23308212e8af6b6c612aba80deaf51a110c7c718fd40615e69fe8c5`。
- 图 manifest `agm_45d1e7b25f0c5d1fbc8c8fce6154f99bdcb9d08f73f955e996cf7ec8524835c2`，3062 nodes / 3896 occurrences。图是文件库存，REA 明确不据此解释格式语义。
- 对 DefaultAdjustBundle 的 670 个文件独立 SHA-256 与图逐一一致；明细在 ignored `artifacts/rea/effects/resource-details.json`、`resource-corroboration.json`，数学来源文件哈希与边界在 `findings.json`。没有把 app 文件树摘要冒充主程序 SHA。
- 原生伪代码、完整 JSON、profile 与摘要位于 `artifacts/rea/effects/native/`。已导出 3 条证据并关闭保存 snapshot，随后写 STOP；本轮所有 REA/原生会话均结束。
- 复用的 Ghidra 整 ZIP SHA 尚未匹配；运行必需条目修复/CRC 的已有边界保持，见 [REA 总评](rea-evaluation.md)。本轮未安装依赖、改全局配置或 Gatekeeper。

当前可交付的是资源与公式线索。真正的目标渲染对照、当前路径选择、独立公式实现和帧级结果验证仍需单独完成；报告没有将这些缺口标作通过。
