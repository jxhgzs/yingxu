# 自主生成的练习素材

`timeline-probe.mp4` 由 `scripts/generate-demo.ts` 使用 FFmpeg 的 `testsrc2` 测试图和 440 Hz 正弦音生成，640×360、30fps、6秒（180帧）、H.264/AAC。不含个人资料、剪映资源或原生研究样片，可随工程复制使用。

文件和校验清单 `demo.json` 随 Git 入库，克隆后无需额外下载或生成。服务的“使用练习素材”和桌面包共用本文件。它不是原生对照实验的历史基线，不替换那些样片或哈希。

需要重新生成时运行 `npm run fixtures:generate`。FFmpeg 版本和编码实现会改变文件哈希；生成脚本同时更新清单，提交时一并提交并复验。该演示素材按项目 LICENSE 分发。
