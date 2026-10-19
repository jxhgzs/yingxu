# SRT字面语义与默认布局校正计划

**目标：** 按剪映5.9.0实测，让SRT标签/实体保持可见字面，采用0.9H中心与0.1H重叠层间距；仅作用于新字幕导入。

**依据：** `docs/qa/2026-10-19-subtitle-target.md`、`evidence/2026-10-19-subtitles/verification.json`。

**边界：** 不改已导入工程、不改普通新建文字、不改VTT既有显式格式转换、不使用目标字体二进制。源码限定subtitles.ts、subtitle-import.ts和subtitles.test.ts。

- [x] 将SRT可见文字直接保留，仅执行原有文本有效性检查和ASS字面诊断；VTT继续移除已支持标记并解码其支持实体。
- [x] SRT默认字号取画布高5%，中心位置取0.9H，重叠层每层上移0.1H；逐cue行数只参与越界检查，不改变全文件层间距。
- [x] 更新旧剥标签/实体解码断言，以两份真实目标fixture覆盖<b>、实体、i及script字面；覆盖两行默认位置、独立较高cue不改变其他lane、后续cue复用lane仍执行越界检查。
- [x] 通知父任务实现已更新，再运行本组测试及typecheck；记录可用PingFang字体与目标system字体尚未完全一致。
