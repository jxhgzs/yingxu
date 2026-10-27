# 映序剪辑内核

映序剪辑内核是一套在本机运行的视频剪辑工程，包含编辑界面、工程管理和媒体渲染服务。它支持多轨剪辑、文字动画、基础调色、转场、预览与导出，后续计划接入映序。

项目以剪映专业版 **5.9.0** 作为功能与操作对照，独立实现已验证的能力。目前版本为 **0.12.0**，仍处于开发阶段，尚未完成完整1:1对齐，映序宿主集成也尚未完成。

技术栈：**Vue 3 + TypeScript + Ant Design Vue**，桌面端采用 **Electron**，媒体处理使用 **FFmpeg / FFprobe**，曲线变速保调使用 **Rubber Band**。

## 已实现能力

- **时间线剪辑**：视频、音频、图片、文字，多轨编辑，分割、裁切、移动、复制、恒速与曲线变速，轨道锁定、隐藏和静音。
- **画面与声音**：位置、缩放、旋转、裁剪、透明度、关键帧、音量、淡入淡出，以及基础调色和已支持的转场。
- **文字与字幕**：文字样式、入场/出场/循环动画，SRT / WebVTT 字幕导入。
- **本地特效库**：扫描本机已有资源，开放已适配项，未适配项置灰。资源数量取决于本机缓存，项目不附带原始特效资源。
- **预览**：WebGL2 实时合成；需要精确文字或不满足实时预览条件时，使用纹理准备或后台渲染。
- **工程管理**：自动保存、撤销/重做、工程文件下载与重开，以及已验证范围内的剪映草稿导入和素材重链接。
- **导出**：MP4、MOV、GIF、MP3、WAV、M4A，支持输出参数、区间导出和任务取消。

## 环境要求

| 依赖 | 要求 |
| --- | --- |
| 操作系统 | 当前主要在 macOS Apple 芯片电脑上验证；其他平台尚未完整验证 |
| Node.js | **24 或更高版本**，并带有 npm |
| FFmpeg / FFprobe | 本机可执行，FFmpeg 需支持字幕渲染等项目使用的滤镜 |
| Rubber Band CLI | 曲线变速保调音频需要；本机验证版本为 4.0.0 |
| 浏览器 | 需要支持 WebGL2；当前主要使用 Chromium 系浏览器验证 |

基础剪辑无需安装剪映。剪映缓存只用于可选的本地资源适配，原生对照研究资料也不是浏览器版启动的前置条件。

macOS 使用 Homebrew 安装媒体工具：

```sh
brew install ffmpeg rubberband
```

如果使用 nvm 管理 Node.js：

```sh
nvm install 24
nvm use 24
```

安装后确认各工具可用：

```sh
node --version  # 应为 v24 或更高版本
npm --version
ffmpeg -version
ffprobe -version
rubberband --version
```

## 快速开始：浏览器版

```sh
# 1. 获取源码
git clone https://github.com/jxhgzs/yingxu.git
cd yingxu

# 2. 安装依赖
npm ci

# 3. 构建前端并启动本地服务
npm run build
npm start
```

打开 **[http://127.0.0.1:8815](http://127.0.0.1:8815)**，即可进入编辑器。终端保持运行，按 `Ctrl+C` 停止服务。

首次使用可以从“媒体”页导入自己的视频、音频或图片，点击素材的添加按钮或拖入时间线；也可以从“文本”页添加文字。选择片段后在右侧调整属性，使用空格播放/暂停，最后点击右上角“导出”。

“使用练习素材”依赖未随仓库分发的研究样片，纯净克隆时请直接导入自己的素材。单个上传文件上限为 **512 MB**。

### 媒体工具不在默认路径时

程序默认查找 Apple 芯片 Homebrew 的 `/opt/homebrew/bin/ffmpeg`、`ffprobe` 和 `rubberband`。Intel Mac 或其他安装位置需要在启动前指定路径；以下命令从当前 `PATH` 查找：

```sh
export YINGXU_FFMPEG="$(command -v ffmpeg)"
export YINGXU_FFPROBE="$(command -v ffprobe)"
export YINGXU_RUBBERBAND="$(command -v rubberband)"
npm start
```

程序直接读取当前终端的环境变量，不会自动加载 `.env` 文件。

## 开发调试

在项目根目录打开两个终端。

终端一启动媒体服务：

```sh
npm start
```

终端二启动前端开发服务器：

```sh
npm run dev
```

打开 **[http://127.0.0.1:8816](http://127.0.0.1:8816)**。Vite 提供热更新，并将 API、素材和后台渲染请求代理到 `8815`。

当前开发代理尚未覆盖 `/text-renders` 和 `/curve-audio` 资源路径；完整文字动画与曲线音频预览请使用 `npm run build` 后的 **8815 构建版**验证。后端源码修改后，需要重启 `npm start`。

## 运行桌面版

```sh
npm run build:desktop
npm run desktop
```

这会构建前端和媒体服务，再通过 Electron 打开桌面窗口。桌面服务自动选择本地端口，仍需本机已安装 FFmpeg / FFprobe 和所需的 Rubber Band。

### 生成 macOS 开发包

```sh
npm run package:mac
```

成功后生成 `artifacts/desktop/<时间戳>/映序剪辑.app`，最新构建路径和版本记录在 `artifacts/desktop/latest.json`。

**打包前置条件**：当前脚本还依赖相邻研究目录中的 `../剪映5.9.0复刻分析_20261018/fixtures/timeline-probe.mp4`。该文件未随仓库分发，纯净克隆暂不能直接完成打包；可先按上一节从源码运行桌面版。当前生成的是依赖本机媒体工具、采用本地临时签名的开发包，尚未完成公证和完整分发验证。

## 配置与数据目录

| 环境变量 | 用途 | 默认值 |
| --- | --- | --- |
| `PORT` | 浏览器版后端端口 | `8815`；桌面版自动分配端口 |
| `YINGXU_EDITOR_DATA` | 工程、素材、任务与缓存存储目录 | 浏览器版为项目根目录 `.local/`；桌面版见下文 |
| `YINGXU_FFMPEG` | FFmpeg 可执行文件路径 | `/opt/homebrew/bin/ffmpeg` |
| `YINGXU_FFPROBE` | FFprobe 可执行文件路径 | `/opt/homebrew/bin/ffprobe` |
| `YINGXU_RUBBERBAND` | Rubber Band 可执行文件路径 | `/opt/homebrew/bin/rubberband` |

桌面版默认数据目录为 `~/Library/Application Support/映序剪辑/editor-data/`，与浏览器版隔离。历史最多保留最近100个撤销/重做快照。工程文件下载不会把全部媒体打包进去，迁移到另一台电脑时还需携带素材并重新链接。

服务仅监听 `127.0.0.1`，用于本地编辑。`.local/`、`artifacts/`、构建产物和本地凭据文件均已加入 Git 忽略规则。

## 项目结构

```text
apps/
  editor/       Vue 编辑器与 WebGL 预览
  service/      本地 HTTP 服务、工程存储和渲染任务
  desktop/      Electron 主进程、预加载与打包配置
packages/
  core/         工程模型、有理数时间、编辑命令和动画规则
  media/        FFmpeg 渲染、文字排版和声音处理
  jianying/     已支持的剪映草稿字段解析
assets/fonts/   字体及其来源、许可证
scripts/        基线回放、打包与研发验证脚本
test/           自动化测试
docs/           设计、功能对照和验收记录
evidence/       已入库的测试数据与验收证据
```

## 验证与测试

无需原生对照资料即可进行类型检查和构建：

```sh
npm run typecheck
npm run build
```

研发环境中还可执行：

```sh
npm test
npm run replay
```

**完整测试不是首次启动的必需步骤。** 部分测试和基线回放依赖未入库的原生草稿、样片和本机研究路径；相关配置见 `docs/parity/baseline.json`。缺少资料时，纯净克隆无法直接复现全部本地验收。`replay` 可显式指定基线目录：

```sh
npm run replay -- --baseline-root /path/to/baseline
```

`replay` 只验证已登记的时序语义，不代表所有画面、声音、效果与性能均已对齐。各版本实测范围和差异以 QA 记录为准。

## 当前限制与文档

完整剪映预设库、复杂模板、全部收费特效、云端能力和映序宿主接入仍未完成。未知草稿字段和效果会保留诊断，阻止无提示地丢弃效果后导出。部分文字动画和转场存在字形、画幅、帧率或素材条件限制；首次精确预览也可能需要准备缓存。

- [编辑器设计](docs/plans/2026-10-19-editor-design.md)
- [功能与操作对照清单](docs/parity/功能与操作对照清单.md)
- [推进路线与验收关卡](docs/plans/2026-10-19-delivery-roadmap.md)
- [本地特效库0.12：范围与验证](docs/qa/2026-10-27-local-effects-v12.md)
- [GPU预览与复杂预设验证](docs/qa/2026-10-19-presets-performance-v10.md)
- [快捷键与焦点验证](docs/qa/2026-10-26-keyboard.md)
- [发布前凭据检查](docs/qa/2026-10-27-secret-audit.md)

## 许可证

项目许可证见 [LICENSE](LICENSE)。随附思源黑体的来源和独立许可证见 [NOTICE](assets/fonts/source-han-sans-1.000/NOTICE.txt) 与 [Apache 2.0许可证](assets/fonts/source-han-sans-1.000/LICENSE.txt)。
