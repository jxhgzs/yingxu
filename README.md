# 映序剪辑内核

映序剪辑内核是一套在本机运行的视频剪辑工程，包含编辑界面、工程管理和媒体渲染服务。它支持多轨剪辑、文字动画、基础调色、转场、预览与导出，后续计划接入映序。

项目以剪映专业版 **5.9.0** 作为功能与操作对照，独立实现已验证的能力。目前版本为 **0.12.1**，仍处于开发阶段，尚未完成完整1:1对齐，映序宿主集成也尚未完成。

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
| 操作系统 | macOS 13+，当前主要在 Apple 芯片电脑上验证；其他平台尚未完整验证 |
| Node.js | **24 或更高版本**，并带有 npm |
| FFmpeg / FFprobe | 本机可执行，FFmpeg 需支持字幕渲染等项目使用的滤镜 |
| Rubber Band CLI | 曲线变速保调音频需要；本机验证版本为 4.0.0 |
| 浏览器 | 需要支持 WebGL2；当前主要使用 Chromium 系浏览器验证 |

基础剪辑无需安装剪映。剪映缓存只用于可选的本地资源适配，原生对照研究资料也不是浏览器版启动的前置条件。

源码运行和使用 `.app` 的电脑都需要安装媒体工具；每台电脑首次安装一次即可，已安装且通过检查时可跳过。macOS 使用 Homebrew 安装：

```sh
brew install ffmpeg rubberband
```

`ffmpeg` 安装包同时提供 **FFmpeg 和 FFprobe**，无需另装 FFprobe；`rubberband` 用于曲线变速时保持音调。媒体工具由系统安装，程序会自动查找常用安装路径。

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

# 2. 安装依赖（媒体工具每台电脑只需安装一次）
brew install ffmpeg rubberband
npm ci  # 自动下载与锁定版本一致的 Electron 桌面运行时
npm run doctor

# 3. 构建前端并启动本地服务
npm run build
npm start
```

打开 **[http://127.0.0.1:8815](http://127.0.0.1:8815)**，即可进入编辑器。终端保持运行，按 `Ctrl+C` 停止服务。

首次使用可以从“媒体”页导入自己的视频、音频或图片，点击素材的添加按钮或拖入时间线；也可以从“文本”页添加文字。选择片段后在右侧调整属性，使用空格播放/暂停，最后点击右上角“导出”。

也可以点击“使用练习素材”：仓库已附带自主生成的六秒动态测试图和音频，启动和打包均无需相邻调研目录、剪映安装或私人样片。单个上传文件上限为 **512 MB**。

### 媒体工具查找与环境检查

程序依次使用显式环境变量、当前 `PATH` 和 macOS 常用 Homebrew 目录（`/opt/homebrew/bin`、`/usr/local/bin`），从 Finder 打开开发包时也能找到标准安装位置。自定义路径可在启动前指定：

```sh
export YINGXU_FFMPEG="$(command -v ffmpeg)"
export YINGXU_FFPROBE="$(command -v ffprobe)"
export YINGXU_RUBBERBAND="$(command -v rubberband)"
npm start
```

`npm run doctor` 检查 Node、媒体工具、关键滤镜/编码器、随库素材校验值和字体。`npm start`、`npm run desktop`、`npm run package:mac` 会自动先检查环境；缺失依赖时给出安装提示并停止。显式配置无效时不会悄悄切换引擎。程序直接读取当前终端的环境变量，不会自动加载 `.env` 文件。

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

打开 **[http://127.0.0.1:8816](http://127.0.0.1:8816)**。Vite 提供热更新，并将 API、素材、后台渲染、文字纹理（`/text-renders`）和曲线音频（`/curve-audio`）请求代理到 `8815`。

后端源码修改后，需要重启 `npm start`。

## 运行桌面版

```sh
npm run build:desktop
npm run desktop
```

这会构建前端和媒体服务，再通过 Electron 打开桌面窗口。`npm ci` 的安装钩子会下载 Electron 运行时；首次安装需要访问 npm 与 Electron 官方下载服务。若之前跳过安装脚本或下载中断，运行 `npm run desktop:install` 后重试。桌面服务自动选择本地端口，仍需本机已安装 FFmpeg / FFprobe 和所需的 Rubber Band。

### 生成 macOS 开发包

```sh
npm run package:mac
```

成功后生成 `artifacts/desktop/<时间戳>/映序剪辑.app`，最新构建路径和版本记录在 `artifacts/desktop/latest.json`。

干净克隆后安装上述标准依赖并执行 `npm ci`，即可直接运行此命令，无需复制作者机器上的资料。前端、服务、练习素材、字体及其许可证会一同放入 `.app`。

**给同事使用 `.app` 时**：同事先执行 `brew install ffmpeg rubberband`，再打开应用即可；只使用 `.app` 无需安装 Node.js、npm 或下载源码。FFmpeg / FFprobe / Rubber Band 由系统安装，不包含在 `.app` 内。

当前生成的是采用本地临时签名的开发包，尚未完成公证和完整分发验证。

## 配置与数据目录

| 环境变量 | 用途 | 默认值 |
| --- | --- | --- |
| `PORT` | 浏览器版后端端口 | `8815`；桌面版自动分配端口 |
| `YINGXU_EDITOR_DATA` | 工程、素材、任务与缓存存储目录 | 浏览器版为项目根目录 `.local/`；桌面版见下文 |
| `YINGXU_FFMPEG` | FFmpeg 可执行文件路径 | 自动查找 |
| `YINGXU_FFPROBE` | FFprobe 可执行文件路径 | 自动查找 |
| `YINGXU_RUBBERBAND` | Rubber Band 可执行文件路径 | 自动查找 |

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
fixtures/       随库练习素材、校验清单与生成说明
scripts/        基线回放、打包与研发验证脚本
test/           自动化测试
docs/           设计、功能对照和验收记录
evidence/       已入库的测试数据与验收证据
```

## 验证与测试

无需原生对照资料即可完成环境检查、基础回归和构建：

```sh
npm run doctor
npm run test:portable
npm run typecheck
npm run build
```

`test:portable` 真实检查演示导出、HTTP 字节范围、文字 PNG、曲线音频缓存/取消、媒体状态和工具路径，不读取私人原生基线。需要重新制作测试图时可运行 `npm run fixtures:generate`，并一并提交更新的素材与校验清单。

有原生研究资料的研发环境中还可执行：

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
- [独立检出与打包验证](docs/qa/2026-10-27-portable-checkout.md)
- [发布前凭据检查](docs/qa/2026-10-27-secret-audit.md)

## 许可证

项目许可证见 [LICENSE](LICENSE)。随附思源黑体的来源和独立许可证见 [NOTICE](assets/fonts/source-han-sans-1.000/NOTICE.txt) 与 [Apache 2.0许可证](assets/fonts/source-han-sans-1.000/LICENSE.txt)。

## Star History

<a href="https://www.star-history.com/?repos=jxhgzs%2Fyingxu&amp;type=date&amp;legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=jxhgzs/yingxu&amp;type=date&amp;theme=dark&amp;legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=jxhgzs/yingxu&amp;type=date&amp;legend=top-left" />
    <img alt="映序 Star History" src="https://api.star-history.com/chart?repos=jxhgzs/yingxu&amp;type=date&amp;legend=top-left" width="800" />
  </picture>
</a>
