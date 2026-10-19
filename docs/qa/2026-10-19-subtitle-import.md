# 字幕解析与原子导入验证

日期：2026-10-19。范围为独立内核，不含剪映5.9.0字幕界面实测或字体效果一致性结论。

## 已实现

- `parseSubtitles(input, 'srt' | 'vtt')`返回精确有理数cue、原始文本和逐cue诊断；BOM、CRLF、中文、多行、序号/标识和三位毫秒支持。小时可大于99；不经过浮点秒或项目帧吸附。
- 严格限制UTF-8 4 MiB、5000 cues、10000 blocks、每cue可见文字2000字符；任何非法时间、空/倒置区间、未知核心结构都会拒绝整个文件。
- 普通SRT/VTT字体及说话者标签转换为纯文本，返回`SUBTITLE_FORMATTING_REMOVED` warning；原始文件文本仍在解析结果中。转换不能称为原富文本样式保留。
- WebVTT NOTE与头部说明返回info；cue settings、STYLE、REGION、X-TIMESTAMP-MAP头部、ruby、逐词时间戳、未知HTML标签与实体均拒绝，防止丢弃有意义的布局或时序。
- 字符实体只经明确字符串映射解码，不调用DOM/HTML/CSS/脚本解释器。转义的`<script>`保持可见文字。SRT里类似ASS覆盖标记保留为字面文字并警告，不执行其命令。
- `applySubtitleImport(document, parsed, options)`一次clone工程、单一文字素材、逐cue文字片段、重叠字幕分轨；源时间从0开始、目标时间保留cue开始+精确offset。返回新document、片段/轨道ID与诊断。一次历史提交由主执行者接入专用`subtitles.import`命令。
- 重叠轨按最大显式行数和1.3倍字号向上分层，分轨产生warning；超过画布安全高度或工程500轨上限明确拒绝。该排版是独立编辑器自己的规则，未证明与剪映一致。长行不会自动重排，实际画面仍需检查。

## 实际验证

执行：Node v24.18.0，`node --test test/subtitles.test.ts`，9/9通过；5000 cues解析与导入约111ms，一条新文字轨、一个素材、5000片段，边界精确连续。

测试覆盖：

1. BOM/CRLF、100小时、中文空格/多行、1ms精度与来源文本完整保留。
2. WebVTT标识、无小时的时间、实体、voice/bold转换及诊断。
3. 非法/空/倒置时间、超过大小/长度、settings/STYLE/REGION/ruby/karaoke/未知标签拒绝。
4. 精确1/3秒offset、相邻cue复用轨道、重叠分轨及垂直区分、ID冲突和负目标时间；输入工程不变。
5. 非法字体、轨道上限、布局超界、伪造parsed负时长拒绝。
6. 5000 cues压力、5001 cues明确拒绝。
7. 转义HTML、SRT字体标签、非法数值实体、时间映射头部及缺少cue分隔拒绝。
8. 原文通过`subtitleSources`随Document持久保存，真实Session一次命令撤销/重做、JSON序列化与恢复均保留原文；来源ID冲突拒绝。

`npm run typecheck`通过（本独立模块接入时的仓库快照）；UI、原生合成、撤销/重做和服务请求由主执行者继续验证。

## 审查修复

独立复查复现了两处问题并加回归：普通SRT正文中的`左 --> 右`原先被误判成缺少cue分隔，现只把另一条时间行识别为嵌套cue；SRT数值实体`&#13;`原先留下裸CR，现与原始CRLF一致规范化为换行，防止后续ASS事件文本被打断。WebVTT正文禁止箭头的既有严格规则保持。

## 未支持

完整自定义ASS/SSA、WebVTT CSS/区域/布局/逐词效果、自动语音识别、字幕翻译、目标原生字幕样式与识别拆分/合并行为、导入5000条字幕后的UI与实时播放性能。原始字幕通过`Document.subtitleSources`保留；本模块不写文件或读取用户草稿。工程文件下载/存储由服务处理。

解析语法参照：[W3C WebVTT](https://www.w3.org/TR/webvtt1/)（2026-10-19访问）。本模块为严格支持子集，不声称完整WebVTT标准实现。
