# SRT字体和多行布局实施

依据：本机5.9.0原生导出字幕，官方Adobe Source Han Sans 1.000源文件，详见字幕目标与字体QA。

- [x] 独立加入官方Apache2.0 SC Medium字体与原许可证/来源，不分发目标app字体；打包使用同一资产。
- [x] TextStyle兼容增加outline/shadow/lineHeight；旧工程缺省保持原来的1/1和ASS换行行为。
- [x] SRT使用0描边/阴影；ASS字号依据同版字体win ascent/descent=1412、UPM1000归一化，显式多行间距依据720p实测38px按比例缩放。
- [x] 多行作为同一cue的多条ASS事件，保持整体中心、缩放、旋转和动画时钟；事件数量限制计算真实行数。
- [x] 实际原生输出检查，并明确SC CFF与目标CN TTF的字形栅格差异仍未消除；不把尺寸近似写成像素一致。
