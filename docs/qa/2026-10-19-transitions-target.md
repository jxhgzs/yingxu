# 剪映 5.9.0 转场与基础调节：原生运行证据

日期：2026-10-19。目标为 `/Applications/VideoFusion-macOS.app`，5.9.0；仅操作专用实验草稿 `Yingxu-REA-20261018`。证据目录：`evidence/2026-10-19-transitions/`。

## 实验范围与方法

本次取得真实原生 JSON、界面截图及 10 份原生导出 MOV。导出设置为 H.264 / MOV / 720P / 30fps / Rec.709 SDR。所有 MOV 均经过 FFmpeg 完整解码，退出码为 0；文件 SHA256、完整 ffprobe 与解码 stderr 保存在 `media-probes.json`。

素材卡片的拖动、双击和右下点击未能稳定添加主轨。先用原生界面清空专用草稿，再正常退出应用，以既有普通 video clip/material 字段构造隔离的基线 JSON，随后由原生应用重新打开接受。**剪辑基线不是原生 UI 创建**，不把它描述为 UI 操作验证。叠化、闪黑和调节均在原生界面实际应用，并以保存 JSON 与原生 MOV 验证启用。

双色源 `/tmp/yingxu-transition-probe-20261019.mp4` 为 640×360、30fps、6秒，0—3秒红、3—6秒蓝。采用红源 0—2秒 → 目标 0—2秒，蓝源 4—6秒 → 目标 2—4秒，使转场两侧可用源 handles 仍保持同色。源素材由本项目生成，未复制闭源素材到产品。

构造与原生接受过程见 `construction.json`、`02-constructed-baseline.json`、`03-native-accepted-baseline.json`。两段源区间、目标区间与 4,000,000µs 总时长在本次全部转场操作后均未改变。

## 原生转场材料身份

| 项 | 叠化 | 闪黑 |
|---|---|---|
| effect_id | `322577` | `321493` |
| resource_id | `6724845717472416269` | `6724239388189921806` |
| is_overlap | `true` | `false` |
| type | `transition` | `transition` |
| category | `39663` / 热门 | `39663` / 热门 |
| path 末段 | `effect/322577/2d641adc4bb63e37e3a0067d8c8cc3c3` | `effect/321493/3bca53e9f3dfa2c184fbee96438ea097` |

上述 path 的本机前缀为 `/Users/tal/Library/Containers/com.lemon.lvpro/Data/Movies/JianyingPro/User Data/Cache/`。转场材料通过**左侧片段**的 `extra_material_refs` 引用。完整字段见 `06-dissolve-ui-1s.json`、`10-flash-black-1s.json`。不能仅凭显示名称允许任意未知转场。

原生 UI 操作：转场 → 热门 → 资源卡片右下角“+”应用。双击资源卡片只下载/预览，不构成已应用。时间线上双击切点转场块可显示时长滑杆。

## 时长显示与实际时长

| 原生界面/操作 | JSON duration（µs） | 文件 |
|---|---:|---|
| 初次叠化，UI 显示 0.5s | 466666 | `04-dissolve-default.json`、`05-dissolve-ui-0.5s.json` |
| 叠化滑杆最右，UI 1.0s | 1000000 | `06-dissolve-ui-1s.json/.png`、`dissolve-1s.mov` |
| 中间步进，UI 0.3s | 333333 | `07-step-down-0.333333s.json` |
| 叠化滑杆中间，UI 0.5s | 533333 | `08-dissolve-ui-0.5s.json/.png`、`dissolve-ui05-533333us.mov` |
| 替换为闪黑，继承上次时长 | 533333 | `09-flash-black-default.json` |
| 闪黑滑杆最右，UI 1.0s | 1000000 | `10-flash-black-1s.json/.png`、`flash-black-1s.mov` |

界面只显示一位小数，不能把显示 0.5s 当成精确 500000µs。观察到的 333333/466666/533333/600000/1000000µs 在 30fps 对应 10/14/16/18/30帧，支持“居中转场半长按帧量化”的推断，但尚未用静态公式证明量化规则。实现/导入应保留原始时长，不从 UI 文本反推精确值。

## 实际逐帧像素

完整 120 帧的中心 2×2 RGB 均值在 `center-pixels.json`。以下帧号从 0 开始，切点为第 60 帧，30fps。

| 帧 | baseline | 叠化 1s | 闪黑 1s |
|---:|---|---|---|
| 45 | 红端点 | [253,22,0] | [253,22,0] |
| 50 | 红端点 | [211,22,40] | [169,13,0] |
| 55 | 红端点 | [168,19,82] | [82,5,0] |
| 59 | 红端点 | [134,18,118] | [15,0,0] |
| 60 | 蓝端点 | [126,18,127] | [0,0,0] |
| 61 | 蓝端点 | [117,17,136] | [0,0,15] |
| 70 | 蓝端点 | [41,15,209] | [0,9,169] |
| 75 | 蓝端点 | [0,12,253] | [0,12,253] |

这组证据支持：叠化在切点两侧居中，混合相对两端接近线性；闪黑淡出到切点纯黑、再淡入，且不缩短本组剪辑总时长。未验证其他帧率、旋转裁切、不同画布尺寸和未知转场资源，因此不能扩大为所有转场均已 1:1 对齐。

### 半透明上层与下方轨道边界

正常退出应用后，以已保存的原生闪黑 1秒材料构造上层两段红/蓝（`clip.alpha=0.5`），下层为满幅绿色 4秒视频。原生应用通过正常“链接媒体”文件选择器取得新绿底素材访问，再真实导出；本组**层级/透明度基线为离线构造，转场材料复用前述原生 UI 创建记录**。见 `17-alpha-flash-constructed.json`、`18-alpha-flash-native.json`、`flash-alpha05-green.mov`。

| 帧 | 原生最终合成中心 RGB |
|---:|---|
| 0、45 | [126,137,0] |
| 50 | [83,91,0] |
| 55 | [41,44,0] |
| 59 | [6,8,0] |
| 60 | [0,0,0] |
| 61 | [0,8,8] |
| 65 | [0,42,41] |
| 70 | [0,89,83] |
| 75、119 | [0,133,127] |

完整逐帧均值在 `alpha-flash-pixels.json`。这排除了“仅把上层 RGB 变黑、仍以 alpha=0.5 透出绿底”的实现；本组中下层绿色也被淡出到纯黑。它符合对合成结果淡入淡黑的行为，但尚未证明所有层级/特效组合的内部执行顺序。

## 亮度和饱和度的真实启用

调节采用原始彩条源 `/tmp/yingxu-jianying-probe-20261018.mp4` 的 0—6秒。基线由普通 clip/material 构造，见 `11-adjustment-constructed-baseline.json`，原生接受见 `12-adjustment-native-baseline.json`。原生选择片段 → 右侧“调节” → 基础 → 调节，分别操作亮度/饱和度并独立导出。

| UI | materials.effects.type | version | value | 证据 |
|---|---|---|---:|---|
| 亮度 +50 | `brightness` | `v2` | 1.0 | `13-brightness-plus50.json/.png`、`adjustment-brightness-plus50.mov` |
| 亮度 −50 | `brightness` | `v2` | −1.0 | `14-brightness-minus50.json/.png`、`adjustment-brightness-minus50.mov` |
| 饱和度 +50 | `saturation` | `v1` | 1.0 | `15-saturation-plus50.json/.png`、`adjustment-saturation-plus50.mov` |
| 饱和度 −50 | `saturation` | `v1` | −1.0 | `16-saturation-minus50.json/.png`、`adjustment-saturation-minus50.mov` |

这些效果的 `path` 都是 `/Applications/VideoFusion-macOS.app/Contents/MacOS/../Resources/DefaultAdjustBundle/combine_adjust`，`effect_id/resource_id/name` 为空，片段 `extra_material_refs` 引用对应 effect。本版本使用 `materials.effects`，不是 `materials.adjusts`。饱和度样本的亮度已归零，JSON 中保留 `brightness/value=0`。零调节 MOV 为 `adjustment-zero.mov`。

首帧 2×2 RGB 均值见 `adjustment-pixels.json`，六条色条采用远离边界的内部点：

| 样本 | 红 | 绿 | 黄 | 蓝 | 紫 | 青 |
|---|---|---|---|---|---|---|
| 0 | [252,0,0] | [0,254,0] | [252,253,0] | [0,0,255] | [253,0,252] | [0,253,254] |
| 亮度 −50 | [178,0,0] | [0,186,0] | [186,185,0] | [0,0,187] | [185,0,179] | [0,185,185] |
| 饱和度 −50 | [52,52,52] | [178,178,178] | [230,230,230] | [22,22,22] | [74,74,74] | [200,200,200] |

源的近中性区域只是约 2×4 源像素的小标记，并非大面积标准灰卡；在输出坐标 (316,542) 的 2×2 均值：零调节 [124,131,118]，亮度 +50 [215,225,221]，亮度 −50 [38,44,40]，饱和度 −50 [130,130,130]。其尺寸太小，受色度采样、缩放和 H.264 压缩影响，不能单靠这些点证明完整亮度公式。原生调节实际启用由 UI、JSON 和输出变化共同确认。

## 色彩解释的限制

三个输入 MP4 的 ffprobe 均没有 `color_range/color_space/color_transfer/color_primaries`；全部原生 MOV 都明确为 `tv/bt709/bt709/bt709`。源和输出完整元数据见 `media-probes.json`。

双色源在 FFmpeg 默认解码时端点接近 [253,0,0]/[0,0,254]，原生双色 MOV 却是 [253,22,0]/[0,12,253]。而彩条源原生零调节输出的纯色端点又接近常规红/蓝。尚不能把所有输入假定成同一种未标记色彩解释；**原始 RGB 的绝对差不得归因于叠化公式**。转场线性判断只基于同一原生导出两端之间的相对混合。后续精确像素对照应先固定并验证输入颜色矩阵及 range。

## 恢复与边界

`00-previous-experiment.json` 是实验前原始备份，SHA256 `fbdb4f89720816fbffcb9cc42cc3236d3ef641da771ff78da0d348abc8a48a82`。实验结束后正常退出、恢复原始字节，再由原生应用重开核对原 5 轨与 duration 完全一致，截图 `19-restored-native.png`。原生重开仅将 `sound_channel_mappings[].type` 从空字符串归一为 `none`，其他材料相同；随后正常退出并再次写回原备份，最终字节相等。详见 `restoration.json`、`19-restored-native.json`。

没有操作其他草稿或生产任务，没有覆盖原应用，没有将闭源转场资源复制进产品。当前证据只确认上述资源、参数和已列边界；不代表整个剪映已完成 1:1 复刻。
