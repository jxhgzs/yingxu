# 0.12.1 独立检出启动与打包验证

目标：Apple 芯片 Mac 安装 Node.js 24+、FFmpeg/FFprobe、Rubber Band 并 npm ci 后，不依赖作者私人调研目录即可运行、使用练习素材和构建开发包。

## 实现

- `fixtures/timeline-probe.mp4` 为 FFmpeg testsrc2 与正弦音自主生成，640×360、30fps、6秒；SHA256 `857b7fbfa3cd907585d7d5ec1e375fae417b518f5c103fcb98eddd6edc9972c3`。服务和桌面包共用该文件，来源与清单一起入库；旧原生研究基线不变。
- 媒体工具按显式环境变量、PATH、macOS 标准 Homebrew 目录查找；显式错误配置不允许回退到另一引擎。曲线音频缓存仍固定实际可执行文件身份和哈希。
- doctor 检查运行时、工具、subtitles/zscale、输出编码器、素材 SHA 和字体文件。启动和打包自动预检；打包再检查 macOS 工具和 npm 安装的 Electron。
- Vite 开发代理覆盖 `/text-renders` 与 `/curve-audio`。

## 本机验证

Node.js 24.18.0、FFmpeg/FFprobe 7.1.1、Rubber Band 4.0.0、macOS arm64。

- 首轮可移植回归16项通过；随后保留原媒体状态回归并单列路径测试（最终结果见下方）。
- 类型检查和前端/桌面服务构建通过。
- 去掉 PATH 中 Homebrew 后，doctor --package 通过，验证标准路径回退；显式三个工具均配置不存在路径时返回非零并提示安装。
- 已查看自主生成素材首帧，只有测试图和计时，没有私人资料。

## 独立检出验证

待完成独立检出、依赖安装、打包和打包服务验收后，记录真实提交、输出哈希与结果。

## 边界

标准媒体工具是公开可安装的前置依赖，没有随 .app 捆绑。开发包采用本地临时签名，未公证；没有借本次构建宣称完全复刻或独立分发完成。完整原生对照测试和 replay 仍需历史研究基线，`test:portable` 不需要。没有修改正在使用的桌面程序、生产数据库或媒体。
