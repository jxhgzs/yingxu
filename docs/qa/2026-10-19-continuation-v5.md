# 0.5：GPU文字、静音曲线与对比度

固定对照 `/Applications/VideoFusion-macOS.app` 5.9.0；独立实现继续沿用 Vue3/Ant Design Vue＋Electron＋原生媒体进程。完整1:1未完成。

## 已接通

- 静态文字复用导出的 captionScript/libass，按需黑白双底栅格恢复RGBA；GPU保留字形排版与已烘焙静态transform，不重复施加透明度或缩放。绑定修订、取消、串行队列、内容缓存与磁盘上限，未把纹理添加到素材库。
- 静音曲线共享REA确认的积分源时钟，逐输出帧seek并保持HTML媒体暂停；独立目标时钟照常推进，晚帧不靠重锚掩盖。带可闻声音的曲线仍显式后台。
- 对比度 v3 的正半轴为修正sigmoid、负半轴为线性，stage顺序B→C→Sat→H→S。工程、严格草稿导入、UI、GPU和浮点LUT导出均已接通，旧文档无需迁移。对比度可选字段与旧combine-adjust-v2契约兼容；未知字段与代际继续诊断。
- 修复文字属性提交或播放头变化时属性页自动跳回“文本”：当前页只在选择片段/工程变化时初始化。

## 验证与边界

文字三种背景与实际离线排版像素比较最大≤3码值；中文两行、12°旋转、85%缩放、60%不透明、描边与阴影、真实编辑/撤销重做/重开/播放通过，见[文字记录](2026-10-19-gpu-text.md)。HTTP覆盖修订冲突、坏输入、会话token、未知工程/片段、PNG RGBA签名/MIME/HEAD/206，进入FFmpeg实际输出后断连取消，子进程及临时输出清理。

静音曲线正式GpuPreview对640×360及1280×720源各59帧检查全部正确，两次0输出/解码掉帧，完成约2.004/2.007秒，合成画幅为640×360；另有慢调度8个输出跳帧样本，见[曲线记录](2026-10-19-gpu-curve-clock.md)。不能外推所有画幅、VFR、长工程、多路曲线或目标性能一致。

真实WebGL2（ANGLE Metal/Apple M3）13组×4096个RGB像素：相对CPU最大0.500035码值（包含RGBA8舍入），neutral逐码值一致。可重复执行 `node scripts/probes/gpu-color/server.mjs`，打开 `http://127.0.0.1:8832/scripts/probes/gpu-color/index.html` 点击运行。报告与截图在 `evidence/2026-10-19-gpu-contrast/`。此处测试独立生成的静态RGB格，不是视频解码或原生像素一致性证明。

四组原生对比度实际MOV单变量完整渲染灰阶≤2/彩色≤3码值。B+50+C+50组合为灰阶≤3/彩色≤3，超过先前单变量灰2标准，单列为已知精度差异；不擅自调公式来凑阈值。原生实验完成后正常退出并恢复专用草稿47395字节，SHA256 `fbdb4f89720816fbffcb9cc42cc3236d3ef641da771ff78da0d348abc8a48a82`。原视频、完整草稿和恢复记录位于ignored `artifacts/qa/native-adjust-next/`及本机Downloads，未提交闭源资源。

浮点LUT的18设置×8192样本最大误差0.060292码值，alpha位完全相同；五阶段720p/60帧null sink约82.3fps、LUT准备108.74ms。此数据是本机小样本，不是完整GPU或原生性能对比。

本轮最终全量171项测试通过，九项原生基线通过，类型检查与桌面构建通过；新增对比度原生回归包含其中2项；组合量化假设与未确定的归因见[原生对比度记录](2026-10-19-native-contrast.md)。构建存在约1.65MB主JS chunk提示，未将其当作运行错误。

## 继续保留的缺口

完整商店特效/转场、温度/色调/锐化、文字动画、有声曲线GPU、所有字体版本冻结、HDR/VFR/长工程性能、逐屏UI与映序生产接入仍未完成。系统字体缓存包含Darwin build身份，但同一build内手动替换系统字体尚未独立探测；正式导出与预览仍依赖本机FFmpeg/ffprobe/Rubberband及系统字体环境。

## 最终桌面集成

最终app：`artifacts/desktop/20261019160322/映序剪辑.app`，0.5.0、Electron44.6.0，源码 `7c6f463920bbc5dc7a6318043c752e13bd988681`；后端bundle SHA256 `63f99b364c93a151a09dbc0d31eca103a6e7daf567cd7b7677cbf8e677d67585`。`codesign --verify --deep --strict`通过，本地ad-hoc签名，尚非公证安装包；仍依赖本机FFmpeg/ffprobe/Rubberband。

真实原生窗口完成：原0.4测试工程重开→打开独立0.5文字/调节工程→文字旋转14°改12°→撤销/重做→对比度25改20（模型.4）→GPU播放2秒→完整导出/下载→切换静音曲线GPU播放→正常退出→从相同包重开。文字与曲线两个工程的revision/document/jobs前后完全相同，原生剪映专用草稿恢复哈希也再次一致。验证期未接入映序产品。

实际桌面1280×720画幅的文字+调节GPU短片及静音曲线各记录到输出/解码掉帧0；界面显示平均CPU合成约8.07ms/6.80ms。此为AX/实际窗口观察，未逐帧读取桌面buffer，不能替代前述正式引擎59帧取样或外推原生性能。

真实下载 `/Users/tal/Downloads/Desktop-0.5.0-text-contrast.mp4`，2.000秒、60帧、1280×720、30fps、H264/709/limited；完整解码exit0，实际1秒帧已查看中文两行、旋转/透明度与色卡。下载与probe哈希记录见 `evidence/2026-10-19-v5-desktop/state-before-reopen.json`，截图与重开证据同目录。

当前构建的生命周期页面再执行20次mount/open/dispose：domChildren0、lateChanges0、requestsAfterDispose0、20次dispose后open均拒绝。真实WebGL context丢失一次后恢复第15帧，同一点RGBA前后均[0,195,255,255]，保持暂停、未自动播放；见该目录 `lifecycle.txt`。这些生命周期探针不等同所有GPU文字/曲线组合与全部资源压力都已验收。

最终桌面验收暴露并修复了Vue watch返回新数组导致页签保存后仍重置：改为两个独立watch source，当前画面页在保存、撤销重做与播放头变化时保持。第一轮0.5候选160119未作为最终包；交付仅160322目录。临时8830/8832探针服务已结束，最终0.5桌面窗口留在已重开的文字工程。
