# 独立曲线保调音频验证

日期：2026-10-19。实现为独立编辑器的离线保调路径；原目标剪映5.9.0音频算法尚未对齐，不能将本项标为1:1音频一致。

## 接口与实现

`packages/media/src/curve-audio.ts`：

```ts
renderCurveAudio(asset:Asset,clip:Clip,directory:string,{
  sampleRate:number,signal?:AbortSignal,onProgress?:(progress:number)=>void
}):Promise<{
  path:string;sampleCount:number;
  timemap:{sampleRate:number;sourceSamples:number;targetSamples:number;
    coverage:Rational;points:{sourceSample:number;targetSample:number}[]}
}>;
```

只接受曲线片段和有音轨素材。源覆盖长度为`min(source.duration, curveSourceDelta(...,target.duration))`，从原始source.start解码；不将整条曲线重新归一化到元数据平均速度。FFmpeg生成固定采样率、stereo、浮点WAV，检查实际源样本数和非有限样本。

以20ms目标网格及核心速度span边界构造内部sample timemap，保留严格递增源/目标样本，合并双时钟间距小于5ms的点，不含0/end首尾点；最多200000候选点。调用本机既有Rubber Band 4.0.0 CLI：`-3 --window-short --timemap ... -D explicitDuration`，没有安装库或修改全局环境。

每次处理在directory内创建独立`curve-audio-*`目录，保留原始decode、timemap JSON/文本、完整引擎stdout/stderr及输入/输出finite扫描。最终WAV先写partial；probe确认stereo/采样率及样本数，实际长度与`round(target.duration*sampleRate)`最多相差1 sample，非有限扫描通过后才rename。没有输出后处理atrim/apad，没有平均恒速或静音fallback。

取消信号贯穿decode、probe、有限性扫描与引擎。只停止本次子进程；SIGTERM后未退出最多2秒再SIGKILL。通过`YINGXU_RUBBERBAND`可指定引擎，默认`/opt/homebrew/bin/rubberband`；缺失依赖明确`CURVE_AUDIO_ENGINE_UNAVAILABLE`。非0退出、warning/NaN/Inf提示、音频NaN/Inf或长度错误均拒绝并保留日志。

## 实际验证

`node --test test/curve-audio.test.ts`：5/5通过，约4.2秒（机器调度会影响耗时）；Node v24.18.0、FFmpeg 7.1.1、Rubber Band 4.0.0。

- 真实PCM：连续440Hz底音+四个2kHz Gaussian短标记，原素材4秒、源入点0.1秒、采用3秒，五点峰值曲线目标1.966666秒；实际输出94400样本/48kHz。
- 原生解码后逐个检查timemap严格递增、无首尾点、样本数及finite扫描，FFT窗口中的主音高与440Hz差不超过5Hz。
- 44.1kHz输出通过；平坦0.1倍、10倍曲线也通过样本数与有限性检查。
- 预取消、活跃引擎取消、缺失依赖明确失败；70kB日志之前的NaN warning也不会被内存摘要截断掩盖，完整日志保留。
- 模拟引擎产生错误样本数或真实NaN浮点WAV时均拒绝；无最终`output.wav`提交，不靠补静音/裁齐掩盖错误。

`npm run typecheck`通过。渲染图接入及完整音画导出验收仍由主任务执行。

## 事件位置与诚实边界

保调算法会改变载波相位，单个绝对载波最大值并非唯一事件位置定义。因此测试同时保留绝对峰值和扣除连续底音功率后的能量质心；以能量质心检查事件时刻，容差固定20ms，没有对音频作人工平移补偿。

| 源标记秒（相对入点） | 核心目标秒 | 输出绝对峰值秒 | 输出能量质心秒 |
| --- | ---: | ---: | ---: |
| 0.35 | 0.350000 | 0.349375 | 0.349999 |
| 0.90 | 0.842626 | 0.864063 | 0.860677 |
| 1.50 | 0.983889 | 1.005000 | 0.996945 |
| 2.40 | 1.372637 | 1.389479 | 1.389233 |

四处质心误差约0/+18.05/+13.06/+16.60ms，全部在20ms内；两个绝对峰值偏移约21.1—21.4ms，未达到“所有波峰±20ms”。该差异明确保留，不能声称逐样本波形或口型一致。本次没有实际听审、原目标音轨波形对照或自然语音大样本验收。

工具能力与选择依据见[曲线表达式和音频调查](2026-10-19-curve-expressions.md)。Rubber Band定义内部keyframe map与离线模式的文档：[官方API](https://breakfastquay.com/rubberband/code-doc/classRubberBand_1_1RubberBandStretcher.html)；实际R3包含`0 0`产生NaN warning的调查已记录，生产map不写首尾点。
