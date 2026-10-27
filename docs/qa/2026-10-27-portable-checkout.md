# 0.12.1 独立检出启动与打包验证

目标：Apple 芯片 Mac 安装 Node.js 24+、FFmpeg/FFprobe、Rubber Band 并 npm ci 后，不依赖作者私人调研目录即可运行、使用练习素材和构建开发包。

## 实现

- `fixtures/timeline-probe.mp4` 为 FFmpeg testsrc2 与正弦音自主生成，640×360、30fps、6秒；SHA256 `857b7fbfa3cd907585d7d5ec1e375fae417b518f5c103fcb98eddd6edc9972c3`。服务和桌面包共用该文件，来源与清单一起入库；旧原生研究基线不变。
- 媒体工具按显式环境变量、PATH、macOS 标准 Homebrew 目录查找；显式错误配置不允许回退到另一引擎。曲线音频缓存仍固定实际可执行文件身份和哈希。
- doctor 检查运行时、工具、subtitles/zscale、输出编码器、素材 SHA 和字体文件。启动和打包自动预检；打包再检查 macOS 工具和 npm 安装的 Electron。
- Vite 开发代理覆盖 `/text-renders` 与 `/curve-audio`。

## 本机验证

Node.js 24.18.0、FFmpeg/FFprobe 7.1.1、Rubber Band 4.0.0、macOS arm64。

- 完整研发测试370项通过，保留全部既有测试；新工具路径与 doctor 回归通过。
- 类型检查和前端/桌面服务构建通过。
- 去掉 PATH 中 Homebrew 后，doctor --package 通过，验证标准路径回退；显式三个工具均配置不存在路径时返回非零并提示安装。
- 已查看自主生成素材首帧，只有测试图和计时，没有私人资料。

## 独立检出验证

在系统临时目录重新 `git clone --no-hardlinks`（提交 `7e772b040e9006e511cdee46384231dce1909996`），新目录没有相邻研究资料，也没有旧 node_modules。只保留 Node24 与系统工具在 PATH，媒体工具通过标准 Homebrew 位置查找。

1. `npm ci` 自动执行项目安装钩子，下载并安装 Electron 44.9.3；依赖审计0漏洞。首次安装含网络下载约2分钟，未复制旧 node_modules。
2. `npm run test:portable`：17/17通过，无跳过，不需要原生研究基线。
3. `npm run package:mac`：自动环境检查、类型检查、前端构建、服务构建和开发包签名全部通过。`codesign --verify --deep --strict` 通过。
4. 独立数据目录执行 `npm start`：预检通过，HTTP bootstrap 返回0.12.1与空工程列表，随后只停止本次测试服务。
5. 直接加载新包内 `dist-desktop/service/server.mjs`，包内不存在源码 `packages/`：练习项目创建成功、媒体HTTP206成功；随包中文字体生成320×180透明PNG；真实R3曲线音频输出44100Hz/88200采样；含文字与曲线的2秒MP4实际导出60帧，下载HTTP206成功。
6. 真实 Vite 开发服务器代理同一包内服务，`/text-renders`、`/curve-audio` 均返回实际资源HTTP206。
7. 浏览器实际加载包内前端、播放曲线视频与中文文字，到达2秒末帧，GPU预览画面正常。截图、脚本、原始结果保存在 ignored `artifacts/portable-validation/`。本轮界面验证是浏览器连接包内服务，未重启用户正在使用的桌面实例。

构建记录：0.12.1，Electron44.9.3，后端SHA256 `bac7260eb0f3c21b9b4137fa764ad130bd37b6a6ed4e7c9dae4eaeba58bcc40e`；随包素材SHA与仓库一致，随包字体和许可证存在。

独立克隆首轮暴露 Electron SDK 安装后缺少桌面运行时：项目现显式 `postinstall → desktop:install → install-electron`，缺失时 doctor 提示恢复命令，并核对 SDK 与 dist 版本。还按 [Electron 官方安全公告](https://github.com/electron/electron/security/advisories/GHSA-jr5w-w6x2-84p9) 将44.6.0升级到同主版本44.9.3；当前 npm audit 为0漏洞。新增提交使用 Gitleaks 8.30.1 扫描，未发现泄露。

## 边界

标准媒体工具是公开可安装的前置依赖，没有随 .app 捆绑。开发包采用本地临时签名，未公证；没有借本次构建宣称完全复刻或独立分发完成。完整原生对照测试和 replay 仍需历史研究基线，`test:portable` 不需要。没有修改正在使用的桌面程序、生产数据库或媒体。
