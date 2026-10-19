# REA common_keyframes 裁切过滤

2026-10-19。针对本机剪映专业版 5.9.0 的独立静态调查。已定位实际裁切过滤和删光后的静态值回退路径；没有修改产品源码、目标 app、操作 UI 或提交 Git。原生操作证据由主任务采集。

## 证据身份与范围

- 目标仍为 `artifacts/rea/libvideoeditor.arm64.dylib`，SHA-256 `be0dd5c522e2b0511202cfa2bd27dc7075b3e5ab7cea820bef4c2664d80afe81`。
- 只读复用上一轮 `curve-trim/native` 已导出的 commonTimeRange / multiUpdateTimeRangeSegment dossier；新会话为 ignored `artifacts/rea/keyframe-trim/` 与其中 `crop-path/`。闭源伪代码、汇编、目标字节及具体反编译内容仅存在该目录。
- 复用现有 REA / Ghidra / Java、地址种子和已核验 profile，没有下载安装依赖或启动全库自动分析。符号筛选后只对明确 helper 入口及少量调用者分析；两次定点 ARM64 BL 检索各只匹配所选 2–3 个入口，检索范围为目标 `__TEXT.__text` 32,367,380 字节，保留了原始哈希和函数起点映射。
- Ghidra 对 shared_ptr 返回值及未使用参数存在类型传播警告。下文的比较、方向参数和调用关系均与 ARM64 指令交叉核对，不依赖反编译器推测的函数签名。

## 实际路径

| 位置 | 地址 | 当前作用 |
| --- | --- | --- |
| commonTimeRange | `0xc30024` | 时间更新后调用逐属性过滤；已有上一轮证据 |
| multiUpdateTimeRangeSegment | `0xc30e90` | 多片段时间更新后的相同过滤入口；已有上一轮证据 |
| 逐属性处理 | `0x1996b78` | 遍历 common_keyframes，过滤单属性；删空时恢复静态值并移除该属性记录 |
| 单属性逐点处理 | `0x1996ed4` | 时间边界吸附、越界删除及回退候选选择 |
| 恢复静态属性 | `0x198a9e4` | 将选中关键帧 values 恢复为对应属性；包含统一缩放的 ScaleX/ScaleY 特殊处理 |
| 首尾曲线类型修复 | `0x19974b4` | 单点改 Line、多点修首尾 curveType；不做时间去重 |

commonTimeRange 汇编 `0xc305bc / 0xc305fc` 从请求 `+0x38` 加载 clipType 到 w2，直接调用 `0x1996b78`；请求 `+0x48` 的布尔值控制是否真正过滤。逐属性函数再将同一方向值送入单属性 helper。区间更新函数 `DraftUpdate::update_segment_time_range`（上一轮 `0x1705d20`）使用相同 `LVVEClipType`：0 修改左起点，1 修改右终点。因此本路径的 0/1 可对应左裁/右裁，不能把它当作通用排序标志。

关键 Evidence：

- commonTimeRange：`ev_14d6055cadc083c3d240ea2cac5552f2feccbe90cd61f1e58a3c86563ef1661f`，复用上一轮。
- 逐属性过滤：`ev_02d11a10cc3d9af2cd67c2bdd0dd3fa1976d41e11a72cb2b42807b62b31231ec`。
- 单属性过滤：`ev_e9d9efacfab2e1e796c51e08d800cb6d7197e46d174f62ca7bb6a085aee78028`。
- 属性恢复：`ev_15c44c0bc69c7d58a655b6b8c9190fe91db1a121028693a751d981901740efc0`。
- 首尾类型修复：`ev_8474d124d9cdbe223ac3e45e37658197240522c08495e444c688fe721dd8111a`。

## 边界先吸附，再删除

过滤启用时，先用 `KeyframeTimeHelper::getKeyframeTimeOffsetByTimeline`（`0x199a9b4`）把新目标区间起止点转换到关键帧偏移时钟，得到边界 B/E。它对视频/音频委派专用转换，对其他片段有局部时钟分支。不要把所有轨型的边界机械当作目标时间，曲线片段也不能未经核验就以平均速度替代该 helper。

逐点规则是：

1. 当点不等于 B 且与 B 的绝对距离小于 1000us，改为 B。
2. 否则，当点不等于 E 且与 E 的绝对距离小于 1000us，改为 E。起点吸附优先；点原本恰等于 B 时，代码仍可检查 E。
3. 吸附后，只有 offset < B 或 offset > E 才删除。等于边界的点保留，形成闭区间。

严格小于 1000 的汇编依据：`0x1997184 CMP #0x3e7`、`0x1997188 B.HI`，即绝对差 <=999 才吸附；`0x19971cc` 比较起点，`0x1997228` 比较终点。`set_time_offset` 在比较删除之前调用，顺序明确。

已分析的单属性过滤、逐属性容器处理及其后首尾类型修复均没有合并同时间点。因此两个原点吸到同一边界时，这段路径可以保留两个记录；不能擅自按时间去重。尚未实测该重复点样例，未排除更外层另有归并或修复。

## 删光时的回退选择

函数按实际列表遍历顺序选择被删点候选；没有为了选回退点额外排序。

- 左裁 clipType=0：每删除一点都更新候选。因此若该属性全部删空，取遍历顺序中最后被删除点的 values。
- 右裁 clipType=1：只在尚无候选时记录被删点。因此若该属性全部删空，取遍历顺序中首个被删除点的 values。
- 该属性还有任何点时，不恢复静态值。
- 原来就是空 list 的属性直接移除，没有候选可恢复。

方向判断在 `0x19971d4–0x19971e4` 和 `0x1997230–0x1997240` 两组指令重复出现：type=0 直接替换候选；type=1 且已有候选时跳过替换。逐属性调用返回后，只有候选非空且过滤后 list 为空，才读取候选 `values` 调恢复函数。

这解释了原生 `04/05`：

| 原生证据 | 保留点 | 静态缩放 |
| --- | --- | --- |
| `00-before-trim` | 3s=1、4.666666s=1.20833325 | 约 1.25 |
| `04-constant-keyframe-trim` 左裁到 3.2s | 仅 4.666666s=1.20833325；没有插入 3.2s 点 | 仍约 1.25 |
| `05-constant-keyframes-removed` 右裁到 4.5s | 空 | 变为 1.20833325 |

原始文件位于 `evidence/2026-10-19-curve-trim/`；抽取为 `native-observations.json`。`independent-rule-replay.json` 包含这两项真实操作复算和严格容差、重复点、左右多点删光的合成规则检查。合成检查验证独立规则实现，没有冒充新的原生操作。

恢复函数对统一缩放有专门分支：ScaleX 恢复会处理相关 ScaleY 与统一缩放值，ScaleY 单独恢复可能被跳过；其他属性委派 `setPropertyValues`。本轮原生例子只覆盖统一缩放值为 1 的 ScaleX，不能由此推断旋转、透明度、音量或非 1 统一缩放的全部回退像素行为。

## 空容器与排除的候选

逐属性函数会把空 property 记录从外层列表移除。全部属性删空后，列表对象存在但元素数为零；原生 JSON 明确保留 `common_keyframes: []` 字段，没有留下空 `keyframe_list` 的 property 记录。不能把这项事实外推为所有材料中的 `animations` 字段都要删除或保留；内部工程的 animations 容器仍需按其自身模型处理。

另查 `KeyframeUtils::clearEmptyKeyframes`（`0x19a2e70`）：只有全部 property list 均空，才清空外层列表；这与本次实际逐个移除空 property 的路径不同。`transformCommonKeyframeTimeOffsetList`（`0x19985f0`）是时钟转换，`clearInvalidKeyframeFromApp / isValidKeyframe`（`0x198ba00 / 0x198bad0`）检查等值/无效属性，不能因名称相近当作本次裁切算法。

## 结论边界与会话关闭

本轮恢复了方向候选、严格 1000us 吸附、闭边界、删光恢复和空 property 移除。原生 UI 只验证了两次单边恒速缩放裁切。双边同时裁、多点同时越界、重复点、反向、素材边界和曲线关键帧时钟还没有本轮原生对照；不把静态分支存在等同于这些操作已全部实现或验收。

两组会话均导出 bundle / snapshot 后关闭；源码哈希复核不变。首个函数冷分析分别约 23.787s、25.561s；不同 seed profile 的耗时不能作为同条件缓存基准。14 项成功函数 dossier 包含排除候选和属性封装，不等于 14 项编辑能力完成。
