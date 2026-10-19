# SRT默认字体与字号研究

2026-10-19。只读分析目标字体，以自有文字做临时渲染；没有安装系统字体、安装fontTools或将目标应用字体复制进产品。产品字体接入与字号变更由主任务处理。

## 官方来源与资产

Adobe官方仓库仍有 [1.000源码tag](https://github.com/adobe-fonts/source-han-sans/tree/1.000)，commit `f25136e6c310c99be8354d447b7e17404075415f`。其 [README](https://github.com/adobe-fonts/source-han-sans/blob/1.000/README.md) 指向的旧预编译字体下载站现重定向；未取得精确对应的CN子集TrueType原始发布文件。

在该固定commit取得 [SourceHanSansSC-Medium.otf](https://github.com/adobe-fonts/source-han-sans/blob/f25136e6c310c99be8354d447b7e17404075415f/Medium/OTC/SourceHanSansSC-Medium.otf)：17,886,896字节，SHA-256 `d0124d3b7dbdb2b97a003b0999a217ddbdc408517c1edb76872d958ebfb08f1a`。计算的Git blob SHA-1 `f8e1debe90de0b34d5e34bd1e46527d8cc3750e6` 与官方树API记录一致。

该版的 [原始LICENSE](https://github.com/adobe-fonts/source-han-sans/blob/1.000/LICENSE.txt) 是Apache 2.0，不能套用当前master的OFL。文件树未发现独立NOTICE。根据父任务授权，已把未经修改的**官方SC全量CFF**、原始LICENSE、明确由本项目编写的来源NOTICE和provenance.json放入 `assets/fonts/source-han-sans-1.000/`。这不是目标CN字体的精确副本。

分发工程建议：固定commit及文件哈希，随资产保留原始许可、字体内署名与本项目来源说明；如将来修改字体文件，单列修改记录。这里记录来源及 [Apache第4节](https://www.apache.org/licenses/LICENSE-2.0) 的工程落实方式，不作法律意见。

## 文件对照

通过自编struct读取SFNT表，无第三方解析库。

| 项 | 目标zh-hans.ttf | 官方1.000 SC Medium |
| --- | --- | --- |
| 家族 | Source Han Sans CN Medium | Source Han Sans SC Medium |
| 轮廓 | TrueType，30888字形 | CFF，65535字形 |
| 文件SHA-256 | 23c4c2392431725af8a8cf23b8e355c181ead687a43e79e842c9ae1647b293b2 | d0124d3b7dbdb2b97a003b0999a217ddbdc408517c1edb76872d958ebfb08f1a |
| name 5 | Version1.000 / hotconv1.0.78 | 同版工具版本 |
| unitsPerEm | 1000 | 1000 |
| hhea ascender/descender/lineGap | 880 / -120 / 500 | 880 / -120 / 500 |
| OS/2 typo | 880 / -120 / 500 | 880 / -120 / 500 |
| OS/2 win ascent/descent | 1104 / 308 | 1104 / 308 |
| OS/2 weight / fsSelection | 500 / 0x180 | 500 / 0x180 |

同版、度量一致与字节/栅格完全一致分开记账。官方CFF和目标转换后的CN TTF在同一libass设置下已出现少量像素边界差异。

## 单行字号测量

文字“第一条字幕”，1280×720，中心(640,648)，白字、描边0、阴影0。临时fontsdir各只含所测字体，FFmpeg日志确认实际选中 `SourceHanSansCN-Medium` / `SourceHanSansSC-Medium`，没有拿回退字体冒充。阈值为所有RGB通道>200。

| 输出 | ASS字号 | 白字bbox宽×高 |
| --- | --- | --- |
| 目标原生MOV | UI字段5；不是ASS字号 | 178×35 |
| 目标TTF经libass | 36 | 124×23 |
| 目标TTF经libass | 51.5 | 178×33 |
| 目标TTF经libass | 54 | 186×35 |
| 官方CFF经libass | 51.5 | 178×33 |
| 官方CFF经libass | 54 | 186×35 |

`(1104+308)/1000=1.412` 可作为本版字体从名义em尺度到当前ASS行度量的首阶归一化参考：名义36→ASS50.832。它接近实测字号范围，**尚不是完整恢复的目标字号公式**。单一字号没有同时精确命中178×35：51.5命中宽度但高度小2px，54命中高度但宽8px。故不继续围绕一个样例盲调、也不把SRT模型字号36直接改成54。

## 多行行高

目标2秒的“中文与 English / 两行保持换行”整体白字范围y614—683，高70px。在明确的中文字形区域分别测得两行中心629.5/667.5，间距38px。相同官方字体和位置，ASS51.5的中文行中心622/674，间距52px；ASS54为621/675.5，间距54.5px。

这说明补偿字形大小与多行基线间距必须分别处理：直接增大ASS字号会把 `\N` 行距一起拉大。目标默认行距字段0.02目前也不能直接当成像素。下一步若接入官方字体，应保留名义字号，单独验证字体度量归一化、每行定位和跨字体回退；本子任务不声称排版已1:1。

研究记录与完整指标：`evidence/2026-10-19-font/`。临时字体、ASS、图片与fontselect日志：`artifacts/qa/font-parity/`；其中目标字体副本仅供本次分析，不在产品资产中。
