# REA 转场设置、handles 与进度调查

2026-10-19，固定本机剪映专业版 5.9.0。本轮静态调查恢复了转场增删改服务、is_overlap 的 SDK 映射、居中延展源范围与进度归一化。具体叠化 shader、颜色混合、余量不足补帧和完整 GPU 渲染仍未恢复。原生 UI 与媒体对照由主任务负责；本子任务没有操作 UI、修改产品源码或目标 app、提交 Git。

## 固定身份与材料范围

- 主库 `artifacts/rea/libvideoeditor.arm64.dylib`，SHA-256 `be0dd5c522e2b0511202cfa2bd27dc7075b3e5ab7cea820bef4c2664d80afe81`。
- SDK `artifacts/rea/curve-followup/libvesdk.arm64.dylib`，SHA-256 `60a4d61ec74ee6cd4d231f1d06cbb91e89bac955c127de0852c970c73b143623`。
- 复用现有 REA 6.7.0、Ghidra 12.1.4、Java 23 和已核验 profile；重读当前 `reverse-engineer-anything` skill 与 native-and-artifacts 引用，没有安装依赖或启动全库自动分析。
- 新会话统一在 ignored `artifacts/rea/transitions/`，分为 native、adapter、sdk、edits、progress。闭源伪代码、汇编、目标字节仅保存在该目录。定点 BL / ADRP+ADD 检索范围、地址与哈希均保留，ADRP 候选再由 REA 指令和引用校核。

资源名清单只读枚举 `/Applications/VideoFusion-macOS.app/Contents/Resources` 的 2189 文件，名称匹配 transition/dissolve/fade 的 14 项都位于 DefaultAdjust 色彩调节资源，不能将其当作转场 shader。目标本地 `~/Movies/JianyingPro/User Data/Cache/effect` 有 7025 文件，目录多为数字 ID；名称过滤没有 transition/dissolve 匹配，不证明缓存没有转场。两份清单分别为 `resource-name-inventory.json`、`cache-resource-name-inventory.json`。没有触发下载，也没有复制缓存 shader 到产品。

## 问题与完成边界

| 问题 | 状态 | 已恢复内容 |
| --- | --- | --- |
| 转场增删与设置 | 静态路径已恢复 | 真正服务函数、材料字段、更新/删除后的动画与轨道处理 |
| 时长限制与占用 | 部分 | 添加服务的左片时长检查、overlap 的端部延展、整数方向；上游 UI 限制与全部轨型仍未知 |
| 源 handles | 部分 | type1 分支向两侧各延展 D/2，源范围乘端部速度；素材极限与冻结策略待原生输出 |
| 进度到效果 | 静态路径已恢复 | effectRange → float32 归一化 → 0–1 钳制 → setProgress: |
| shader / DSP 数学 | 未恢复 | 不能凭 progress 线性推出所有转场使用线性 blend |
| 基础叠化与 GPU 一致性 | 待原生验证 | 尚无本轮目标转场 JSON、每帧像素或实际导出对照 |

## 增删改服务

导出符号中的 VideoClient 方法只是请求入口。本轮继续定位到实际服务：

| 操作 | 实际地址 | 观察 |
| --- | --- | --- |
| addVideoTransition | `0x13679a4` | 材料挂在左片，写入 name/resource_id/effect_id/path/duration/is_overlap/category/request_id |
| updateVideoTransition | `0x136834c` | 找到关联片段及转场，更新 duration，联动动画和轨道 |
| removeVideoTransition | `0x1368a68` | 按新时长 0 调整动画后，把左片 transition 设空，再调整轨道 |

添加服务明确拒绝最后片段，并检查 `requestedDuration <= trunc(leftTargetDuration/2)`；不满足时记录“video too short”。该检查读取目标区间，没有在此读取源 handles。更新服务本体没有相同半时长检查，而是写入请求 duration；因此不能把添加分支的限制直接外推为所有 UI、更新请求或最终合法区间的完整规则。

这些服务调用 `VideoUtils::update_video_animations_with_trans`，再调用 `DraftUpdate::adjust_track_target_start_time` 和草稿时长更新。动画函数 `0x13539cc` 按 `(newDuration-oldDuration)/2` 移动特定入场/出场/组合动画 start，包含正负整数方向；它本身没有改写 source/target 区间。轨道调整会按各自规则重新对齐起止点，细节参见 `rea-curve-trim.md`。

关键 Evidence：添加 `ev_14bb5887ad97b415935257015227331905184627eaadeb980cde083623e2c604`；更新 `ev_a207e7f3edb5433eebea6b73da71b2d4050f56c2740b23ea74908641feebc582`；删除 `ev_9078598b82704e74b51c8c0e457cd8d1d0d5c5675286b8e352775f5f69719065`；动画处理 `ev_bb0386d691467d43fe9bc987c32da12c99cfd7d138f6b961871cbf3aa30b6f8c`。

## is_overlap 与 SDK 类型

`0x132a150` 把 MaterialTransition 的 path、duration、is_overlap、effect_id 转成内部信息。真正渲染适配 `0x156cf78` 再把 duration 和资源路径写入 SDK VideoTransition，并做明确数值映射：

- is_overlap=true → SDK VideoTransition type=1。
- is_overlap=false → SDK type=2。

随后显式设置左右 attach clip IDs，调用 NewVEWrapper::insertVideoTransition 或 rebuildVideoTransition。SDK 创建工厂 `0xc5da38` 只是保存资源、类型、时长与 attach IDs，不能把这个工厂当作渲染数学算法。

渲染适配 Evidence：`ev_b57562d941f0c3a65916d7a1483c432369aebf0684b5226038a73db8c9dbc897`；SDK 工厂 `ev_07505dc8e88ffd12490631f3b3aba35a2e93261ed19fee47641efa903104c5c8`。

## type1 的居中 handles 延展

只有 is_overlap=true 的适配分支调用 `0x156ef64`。此函数修改 SDK clip 的源范围和序列范围，并调用 updateAvClip / updateClipSequenceTime，没有在该段改写草稿中的原 source/target 字段。设转场时长 D，左右原序列接点为 C，原左源出点 SA、右源入点 SB：

- 左 SDK sequenceOut = `trunc(C + D*0.5)`。
- 右 SDK sequenceIn = `trunc(C - D*0.5)`。
- 左 SDK sourceOut = `trunc(SA + endSpeed*D*0.5)`。
- 右 SDK sourceIn = `trunc(SB - startSpeed*D*0.5)`。

源速度取内部模型速度点数组的末端/首端 y，没有速度点则取标量备用速度。函数还重新归一化速度点并补相同端部值，表明区间外的源扩展使用端部速度，不宜继续套曲线区间内非线性积分。本轮未独立恢复该内部模型全部 C++ 类型；精确变量布局保存在原 dossier，不能只凭字段偏移冒称完整类型系统。

上述 trunc 已核对 ARM64 FCVTZS：左源 `0x156f17c`、左序列 `0x156f1ec / 0x156f2bc`、右源 `0x156f7dc`、右序列 `0x156f838 / 0x156f8ec`。应先将带符号半时长加到原端点后截断，不能先把 D/2 截断一次再两边共用。例如 D=333333us、C=3000000us，左右序列端点为 3166666 / 2833333us；先截断半时长会让范围短 1us。

右片延展还检查其原 start 与左片原 end 的绝对差 <2us。本函数没有观察到按素材总时长限制上述 sourceIn/sourceOut。源入点为 0、源出点到素材末尾时，会不会重复首末帧、黑帧或采用其他填充，必须由原生导出或更底层解码规则核对。不能将“is_overlap”字段解释成直接把草稿总时间线缩短 D。

Evidence：`ev_b7cbd9e31e9bbb15c7a228de27909ead03aaaaf1551586f2d41ea2c3405163e8`。独立算例见 `independent-rule-replay.json`；这些算例不是目标 UI 或媒体执行。

## effectRange 到 progress

SDK 的 `+[IESVideoTransitionFilterBuilder addProgressForTransFilter:mediaInfo:atTime:]` 位于 `0x14d754`。先按目标对象/类型条件进入分支，读取 mediaInfo.effectRange；duration 用 CMTimeGetSeconds 转 double 再转 float32，atTime 减 effectRange.start 的差值也转 seconds 再 float32。duration 的 float32 值 >0 时：

1. 负差值先设为 0。
2. 做 float32 除法，得到 `p = deltaSeconds / durationSeconds`。
3. p>1 时设为 1，调用滤镜 `setProgress:`。

选择子名字并非根据反编译器猜测：getter 消息 stub `0xd36920` 读取 selref `0x10ad9d0`，初始化内存中的指针为 `0xec2a49`，字符串是 `effectRange`；setter stub `0xd532e0` 的 selref `0x10b7680` 指向 `0xee25d2`，字符串为 `setProgress:`。读取记录完整返回所请求字节。这些是 Ghidra 已初始化分析内存，不能当作运行时对象内容。

此函数没有加入 easing，但效果资源可以在 progress 之后再次映射进度或采用任意 shader。线性时钟既不能证明基础叠化就是 `mix(A,B,p)`，也不能证明混合发生于 gamma 编码空间或线性光空间。CMTimeRange 的实际 timescale、转场采样的首末帧包含方式和 type1/type2 effectRange 构造仍待后续证据。

Evidence：进度计算 `ev_b80709095b1d9bc7fcb15b7802d0071b5078fa76a9b27fcd4bd0056e059230d2`；getter/setter 原始字符串 `ev_23145cbfdf2a4bdce74fac9efe8665e9061ca0f364033b166143542c3f52d663` / `ev_1eead6bc9c539d2ad3144ead1998e26d3655e621e1d640646df358b11e0879ca`。

另定位 `IESEffectTransitionRenderer::initWithCanvasSize:`（`0x9e8c8`）及 `dissolveTransition:` 字符串。前者只能证明效果渲染器初始化和 `ve_edit` 环境创建，后者只是选择子线索；两者都不足以证明实际 shader、GPU 后端、进度像素公式或实时性能。

## 原生验证所需参数

主任务拟在专用草稿构造已知片段后，用原生 UI 应用转场并导出。下一轮可复用本轮证据，优先补齐：

- 保存无转场、默认基础叠化、改时长、删除后的 JSON，含 materials.transitions 完整项、左右 source/target、is_overlap、effect/resource ID 与实际资源路径。
- 30fps、1x，D=1s 与 D=.5s，覆盖偶数/奇数帧半分配；编号源确认进入了哪些 handles。
- 原生零余量片段与余量充足片段对照，确定首末帧延展策略。
- 黑/白或红/蓝纯色的完整转场逐帧，区分进度采样、blend 曲线及颜色空间。

当前没有上述本轮目标 UI / 导出证据，不将普通淡化的自定规则冒充剪映基础叠化。具体资源 shader、type2、非相邻片段、曲线及音频过渡、转场间冲突、GPU 像素与性能均保持未知或待验。

## 会话归档

27 条成功 Evidence 中有 20 条函数 dossier，另有 3 条字符串检索和 4 条静态内存读取；其中包含封装、候选排除与类型边界，不等于 20 个转场功能。所有会话先导出 bundle / snapshot 后关闭，索引为 `artifacts/rea/transitions/evidence-index.json`，两库 SHA 复核不变。未发生新的下载安装或目标程序执行。
