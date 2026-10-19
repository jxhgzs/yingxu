# 映序剪辑内核

以本机剪映专业版 **5.9.0** 为固定对照，独立实现编辑界面、工程系统和媒体引擎，验证后内置映序。

2026-10-19：用户已确认独立编辑器、原生媒体引擎与映序宿主适配的架构，随后补充团队更熟悉Vue，并指定Ant Design Vue。编辑器界面采用 **Vue 3＋TypeScript＋Ant Design Vue**；现已实现首轮独立编辑与导出链路。完整1:1复刻仍未完成，映序宿主尚未接入。

- [已确认设计](docs/plans/2026-10-19-editor-design.md)
- [功能与操作对照清单](docs/parity/功能与操作对照清单.md)
- [完整推进路线与验收关卡](docs/plans/2026-10-19-delivery-roadmap.md)
- [首个实施包：时间、工程、命令与回归](docs/superpowers/plans/2026-10-19-editor-document-core.md)
- [证据索引](docs/parity/baseline.json)
- [首轮运行与验证记录](docs/qa/2026-10-19-first-working-build.md)
- [源时钟关键帧验证](docs/qa/2026-10-19-keyframes.md)
- [多格式导出与区间验证](docs/qa/2026-10-19-export-formats.md)
- [REA实际能力评测](docs/qa/rea-evaluation.md)
- [0.3曲线、字幕与草稿恢复验证](docs/qa/2026-10-19-continuation-v3.md)
- [REA曲线时钟恢复](docs/qa/rea-curve-followup.md)

原始分析、反汇编、六份草稿快照和实际导出文件保留在相邻目录 `../剪映5.9.0复刻分析_20261018/`。本仓库不修改这些基线文件，也不修改 `../../视频生产平台/` 的既有产品和数据。

执行顺序为工程与命令 → 媒体引擎 → 编辑界面 → 映序宿主。功能登记册保留完整对照目标；首包只是后续工作的基础，不是缩减后的替代交付。

## 当前可运行范围

视频/声音/图片素材探测与本地导入，多轨片段、精确分割、裁切、移动、恒速、轨道锁定/隐藏/静音，画面变换、透明度、音量和文字；修订号事务、撤销/重做、原子自动保存、工程文件下载/重开；源时钟线性/保持关键帧与拆分边界插值；同一渲染图驱动低清预览与MP4/MOV/GIF/MP3/WAV/M4A原生导出，支持HEVC、输出设置、区间、任务取消与HTTP206。

已知video草稿支持统一缩放线性关键帧与已核验的曲线变速，原始草稿和哈希保留；显式重链接恢复媒体，支持同路径重复素材整批恢复。未知关键帧、效果及其他草稿轨道类型继续诊断并阻止无提示导出。SRT/WebVTT可导入编辑、保留原文；曲线可设置、分割并导出视频与保调音频。直接曲线裁切、全部预设、完整效果、GPU实时预览、云端能力及逐屏对齐仍未完成。

## 本地运行

要求Node 24+、macOS以及可用的FFmpeg/FFprobe；本机已验证默认路径 `/opt/homebrew/bin/ffmpeg` 和 `/opt/homebrew/bin/ffprobe`，也可通过 `YINGXU_FFMPEG` / `YINGXU_FFPROBE` 配置。曲线保调音频还需Rubber Band CLI（本机4.0.0），默认`/opt/homebrew/bin/rubberband`，可由`YINGXU_RUBBERBAND`指定；缺失时明确失败。官方Apache2.0思源黑体1.000字体与来源许可证位于`assets/fonts`。

```sh
npm ci
npm test
npm run replay
npm run build
npm start
```

浏览器访问 `http://127.0.0.1:8815`。开发调试时另开终端运行 `npm run dev`，入口为8816。数据独立保存在本仓库`.local/`，不会读取或改写映序数据库。上传的单个文件上限512MB；磁盘会话保留最近100个撤销/重做快照。

```sh
npm run build:desktop
npm run desktop
npm run package:mac
```

最后一条命令生成独立macOS开发包，路径记录在 `artifacts/desktop/latest.json`。当前本地包依赖上述FFmpeg/FFprobe与曲线音频Rubber Band，不是已经公证和完整分发验证的安装程序。桌面运行数据默认位于应用自己的userData目录，可用 `YINGXU_EDITOR_DATA` 指定。

## 验证证据

- 六份真实剪映草稿的九项对照：`artifacts/core-baseline.json`。
- 已实际操作素材导入、三秒分割、二倍速、撤销/重做、文字、工程下载重开与导出下载；135帧、4.5秒、720p30的真实文件已完整解码。
- 原生像素用例覆盖叠轨、透明度、缩放、隐藏与图片倍速；单帧用例覆盖30、60和30000/1001帧率的起止边界。
- `/lifecycle-test.html`为单独的研发验证页；20次挂载/卸载后，DOM残留、迟到更新和卸载后的轮询请求均为0。尚未据此宣称映序React宿主接入通过。

普通启动只进入剪辑器，研发检查不进入用户主流程。当前90项自动测试和九项真实草稿对照通过，真实UI曲线区59帧源编号全部一致；声音和字体仍有明确差异。桌面退出重开验证另见对应版本QA；实际证据与已知差异见上面的QA记录。
