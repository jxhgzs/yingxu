# REA文字动画与原生时钟对照

固定目标为本机剪映专业版5.9.0。2026-10-19继续使用实际REA MCP、Ghidra12.1.4/Java23进行定点调查，没有安装依赖、修改注册或执行目标库。原生UI及导出由主任务操作；本报告负责只读分析其导出以及独立核心数学。静态事实、真实导出和产品验证分别记录，不能从三项动画宣称完整动画库1:1。

## 身份、工具与范围

- 主库arm64 SHA256：`be0dd5c522e2b0511202cfa2bd27dc7075b3e5ab7cea820bef4c2664d80afe81`，复用既有薄片和精简profile。
- 本次新增薄片libeffect arm64 SHA256：`22050e1de66524c56de0b4152c57502e532cba48105e1888dd214ee1145d0c3b`。原fat文件只读提取，原文件、薄片和嵌入字符串范围记录在 `evidence/2026-10-19-text-animation/embedded-easing.json`。
- 会话、原始伪代码/汇编、Lua副本仅在ignored `artifacts/rea/text-animation-v7/`，产品没有复制闭源资源或调用目标库。
- 已有模块只按明确问题扩种子。4次函数地址未被当前精简profile导入，保存拒绝后补充种子并以不同profile重开，未重复同一失败分析。fat原库Ghidra明确拒绝架构选择，改为可核验arm64薄片。REA JS分析只提供资源目录身份与JSON/库存，**不提供Lua语义**；Lua数学另以固定哈希的原字节阅读，基础ease还与REA初始化内存及文件映射交叉核对。
- 起初对`~/Movies/.../Cache/effect`的227份旧config做有限搜索，没有发现动画配置。原生UI后下载三项资源；沙盒路径最终规范化到同一实际目录。旧搜索结果不是动画不存在或完整在线商店库存的证明。

## 原生材料字段

普通文本的动画是 `SegmentText.animations → MaterialAnimations.animations[]`，持久材料出现在 `materials.material_animations`，片段通过`extra_material_refs`关联。它与`common_keyframes`不是同一个数据结构。序列化包括`type/start/duration/path/platform/resource_id/name/category_id/category_name/panel/material_type/anim_adjust_params/request_id`。

新Evidence：创建 `ev_50dcdde00f92f129e9b08d7ba31a6cd0f695373a7fd89dad47e14c8e38191307`，材料序列化 `ev_03ec5b5f0ad8aa5ff055459c783bbff172fe5cbec70f7419ebdc4b50be2a21d9`，单动画序列化 `ev_8ace5677b497d90f03889cf7d2d55c5037066c7b96d8530c0e26c5d92c20a195`。

本轮原生实际字段：

| UI项 | id | resource_id | type | start | duration |
|---|---|---|---|---:|---:|
| 渐显 | 1644304 | 6724916044072227332 | in | 0 | 500000 |
| 渐隐 | 1644600 | 6724919382104871427 | out | 0 | 500000 |
| 打字机I | 1644275 | 6724920249654710791 | in | 0 | 500000 |

三项`material_type`都是`sticker`，不能因此断言片段不是文本。`anim_adjust_params`均为null。入场和出场共存快照实际保留两项，duration均500000、start均0。静态更新参数路径还可写`direction/anim_mode`，但这三项未使用，未知取值不擅自映射。

## 枚举和时间规则

初始化函数`0x16d93fc`明确写入：0=`none`、1=`in`、2=`out`、3=`loop`、4=`caption`、5=`group`。Evidence `ev_b718e11faa65db1242e425fa3190455c3f088585c311f23b03c7c91953c362e7`，函数体汇编及`ev_07c17d14b83ccef59c72e774adfc86271d36eb47df24d8004bafd915c4253606`512字节完整读取交叉核验。不能将4凭经验改叫“combo”；UI“组合动画”与caption/group对应关系本轮仍未确证。

- `update_text_anim`替换相同类型，保留不同类型；caption(4)有独占分支，不能误读为所有组合动画。Evidence `ev_3eb82d880d2e17aaf2ff35613d7c6f20abcd9661d9a0c8bd82a25d66803e5c8b`。
- 通用duration修正读取普通Segment的**target range duration**：vtable +0x78。SegmentText vtable完整读取 `ev_01b820f23adfc86f1b9fbd61daaa9573933805c02e993290e8a70af3b36592bb` 指向 `Segment::get_target_time_range`0x7c3470；调用方 `ev_803a63adc57340339ea833d3129623abc5e6673e14cc2522d5589e7c2cfe6f3f`。
- 通用修正存在100000微秒下限；入/出总长超max duration时按原比例缩短并平衡整数余量，loop限于剩余区间并有下限，caption duration设为max。比例转换已看到FCVTZS，而非伪代码cast猜测。Evidence `ev_76eeae95a19f24508d3602aa933e56a313b8bb118c4609ea9a3a0bcf3f2c94f3`。该内部修正规则不等于所有UI拖动限制；小于100ms片段及动画冲突仍未原生验证。
- `update_link_animations`按new target duration/旧duration比例改动画duration，loop另有5000000us上限。Evidence `ev_138a22815aa788df92db987f3f272628702e5ebc8282af566d7cd26e6491fa9e`。
- 参数转换将微秒除1000000输出double秒。反编译把某存储误显示为long cast；ARM64实际`scvtf → fdiv → str d0`没有整数截断。Evidence `ev_c40b6d34dc56e185160be8901b3ee38d19628ccd0463bcdbb5e5e94d88b6e233`。
- 与视频转场联动的旧静态证据见`rea-transitions.md`：按新旧转场半时长移动某些动画start。它针对video动画，**未证明普通text也使用同一规则**。本轮不以视频转场修改文字动画start。

## 可独立重写的三项数学

渐显资源Appear.lua SHA `ef2d2d102315061748756dad60645f1f64fb4b23796ca01f1f200874605c23aa`。脚本实际使用SDFText.alpha或Sprite2DRenderer._alpha，0→1，ease=quadOut；默认创建0.1秒会被setDuration覆盖。`self.ease=quadOutIn`字段没有传给实际tween，不能使用该字段推测ease。

渐隐同样使用quadOut，alpha从1→0。设目标局部时间t、片段目标长度T、动画长D，`clip(x)=max(0,min(1,x))`：

- 渐显：`p=clip(t/D)`，alpha=`2p−p²`。
- 渐隐：`p=clip((t−(T−D))/D)`，alpha=`(1−p)²`。

出场JSON的start=0并不意味从片段开头淡出。本轮真实T=2s、D=.5s导出在帧45(t=1.5)保持满字、帧46开始下降，直接证明尾部窗口。caller仍负责clip左闭右开可见区间，数学模块不另改片段长度。

libeffect内嵌Ease的quadOut精确公式与Floor阈值已恢复。arm64中quadOut位于`0x1e566d2`，REA `address_to_file_offset`证据 `ev_59d05813f70468192a94e9f99f426c423c3a3c187e34e56dc0dbf051a005f336`；`read_bytes`证据 `ev_753a2f9385f373dd818b5b4fda31f26010255de18321d93147e96e2d471be4b5`完整返回130字节。两个fat切片包含同SHA的封闭Lua串；这里只提交数值结论、偏移及哈希，没有提交私有Lua。

打字机I资源PrinterOne.lua SHA `17fa3dcec8efd6ebcc421d5fc14d9e4385832fddbf6b69e62ec70215cfaabaae`。对引擎`SDFText.chars`中的N个条目，第i个(1-based)的独立tween时长为`D*i/(N+1)`，颜色alpha以Floor从0切到1；Floor归一化后小于0.99999返回0，否则1。因此第i个可见阈值：

`time >= D*i/(N+1)*99999/100000`。

最后一个字在约`N/(N+1)*D`已经出现，不能用`floor(N*t/D)`替代。保持原整句布局，只隐藏字形后缀；重新居中显示前缀会产生明显位移。字形列表未证明等于任意Unicode码点、UTF16长度或grapheme。

## 实际导出观察

本轮真实导出均1280×720、30fps、60帧、2秒，媒体SHA与逐帧观察见 `evidence/2026-10-19-text-animation/`。无动画导出为独立基线，渐显/渐隐/两者共存各单独导出，打字机由原生UI操作后再导出。

- 混合两行文本“A B中文\nC”：A/B/中/文/C首次出现帧实测`[2,6,8,10,14]`，精确匹配N=7、i=`[1,3,4,5,7]`，证明普通空格和LF换行都计入本样例的chars时钟。对应两份MOV和字形mask记录见`native-mixed-text-measurements.json`。
- 六汉字“文字动画对照”，D=.5秒：首次出现帧实测`[3,5,7,9,11,13]`，与上述有理数阈值、`time=n/30`逐项吻合。前一帧各字实心像素median=0，首次帧约253–255。
- 渐显相对于独立无动画字形mask，估计alpha和公式最大差0.01505；字形mask像素MAE约2.7–4.45码值。
- 渐隐以前部满字作参考，尾部估计alpha和公式最大差约0.0125。
- 共存导出60帧同时匹配前入后出趋势；相对于其中满字参考的最大alpha差0.01458。

这些是最终有损H264灰度解码观察，支持类型、事件帧和二次ease，**没有证明最终像素1:1**。编码链、SDF字形栅格、背景、边框/阴影及复杂文字均需另验。没有把误差归因全部武断判为编码，也没有修改公式来拟合该误差。

## 独立核心实现及待验项

`packages/core/src/text-animation.ts`只实现已确定的in/out渐变和in打字机I。严格拒绝未知字段、phase、kind、重复phase和超长/重叠duration，不猜裁切/分割时钟。`textAnimationVisibleCount`以BigInt精确比较99999/100000，不把临界事件用浮点秒取整。

结构验证与文字字形策略分开：`canRenderTextAnimationText`目前接纳可见ASCII、普通空格、LF换行及BMP基本汉字，拒绝CR/tab/组合符/emoji等未确证字形计数。ASCII范围属于保守产品子集，当前原生逐帧样本覆盖六个汉字和A/B/C混合空格换行，不能宣称ASCII全部已原生验证。淡变不受该逐字限制。

6项独立核心回归通过：真实六字/混合空白首次出现帧、入/出二次曲线共存、NTSC时刻上的精确Floor阈值、Unicode拒绝和严格结构/时长验证。NTSC用例是独立数学测试，**不是原生NTSC导出对照**。schema、ASS/GPU、UI保存重开及导出一致性由主任务集成后另记。

未完成：循环/组合/路径移动/弹跳、完整在线动画库；字形计数复杂Unicode与其他空白；非零target入点的原生素材对照；文字片段变速；转场作用于文字；trim/split原生语义；100ms下限全边界；最终SDF/ASS像素及完整性能对齐。完整1:1仍有这些实质缺口。

## 会话结束

本轮22条新Evidence（包括14份函数dossier、3份资源目录视图、1份Mach-O视图、1份文件映射及3份内存读取）及6次有界拒绝均保留在收据目录。完整bundle分别为native-evidence.json、effect-evidence.json、final-evidence.json；每次切换前export并close，最后close保存expanded-native-snapshot.json。STOP已触发，本地helper退出码0；没有留下自有REA后台进程。索引提交为`evidence/2026-10-19-text-animation/rea-evidence-index.json`，伪代码与目标字节仍ignored。
