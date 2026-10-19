# REA：新增转场入口与资源调查（0.8）

2026-10-19；固定剪映专业版5.9.0。资源取证阶段只读，原生界面由主任务独占；随后按主任务授权实现候选修复及已获证转场。本轮未将闭源资源复制到产品、未按名字套用转场公式。私有响应、资源与REA原文位于ignored `artifacts/rea/transitions-v8/`；可共享观测在 `evidence/2026-10-19-rea-transitions-v8/`。

## 目前回答的问题

| 问题 | 证据与状态 |
| --- | --- |
| 本地effect缓存是否已经含更多可解析转场包 | 本轮基线7223文件、230份config、8份extra；成功JSON解析后仅322577/321493含transition声明。是有界本地盘点，非在线库结论 |
| 从哪里取得其他资源的准确身份 | 新找到本地`Cache/rp.db`的`http_cache`第1212行，一份转场分类成功响应，308项、`has_more=false`；仅该缓存分类，不是全部转场库 |
| 是否可凭普通effect数据库表为空判定无列表 | 不可。effect/loki/category表确实为空，但http_cache仍有87条响应；resourcePanel目录为空也不能替代检查 |
| 新增效果方程与alpha/时间语义 | 闪白已用不透明及半透明原生输出交叉验证；两种空间效果的false与true必须分开，见后续逐项证据 |

`~/Movies/.../Cache/effect`与Container别名仍指同一设备16777231、inode106629809，不能当两份独立资源库存。主任务下载期间缓存可能改变，数字仅代表本次读取时点。

## 新的准确资源入口

缓存分类响应SHA-256：`a095c14fdf07c8078a62f8309a97704236942674b5bfb4a3aeed16830cc87384`。服务器时间戳1792390396，读取时它是本机已有缓存；没有将它称实时在线列表。所有metadata解析使用只读SQLite连接和标准JSON解析器。保留最少字段的摘要见 `cached-category-summary.json`。

| 原生标题 | effect_id | resource_id | metadata时长／isOverlap |
| --- | --- | --- | --- |
| 闪白 | 322575 | 6724845376098013708 | 0.5／false |
| 向左擦除 | 2917283 | 6724849999336706573 | 0.5／true |
| 向右擦除 | 2917284 | 6724849898857959950 | 0.5／true |
| 圆形遮罩 | 2916676 | 6725767129519362573 | 0.5／true |
| 圆形遮罩 II | 2916675 | 6724850215364334083 | 1／true |
| 圆形扫描 | 813992 | 6851775006418932238 | 1／true |
| 滑动 | 4212349 | 6757982416649851399 | 1／true |

上述旧资源extra缺少`is_vip`字段，不能把缺字段说成明确免费。是否能够正常使用仍以原生UI为准。目录条目中的时长也不能替代原生保存后的微秒值、帧量化和实际像素。

优先验证闪白、向左擦除、圆形遮罩：名称仅用于定位。闪白需核峰值颜色、两半进度及上下层alpha；擦除需核方向、边缘位置、是否位移纹理以及边界软化；圆形需核径向坐标、中心、宽高比、软边与反向。都需同一原生导出的两端色彩校准，不能把媒体矩阵差当算法差。

## REA本轮调用

先检查`binary_session`，确认为无已打开目标；未重复反编译0.7已有函数。将本次新取得的缓存响应、解析摘要和库存归档为4文件ZIP，再调用`open_binary`与`inspect_artifact(integrity_policy=fail, detail=summary)`：

- ZIP SHA-256：`8bb72e8b90ed08156fb2dec87035c34528b9d2be33f8e1a769412c0889112b7d`。
- 完整inspect Evidence：`ev_83179963b26e136ee208c58f3739dfc9335d5d0d4289e0079b757225a3ecc502`。
- 摘要Evidence：`ev_6ad170802e3fa5add7030c9a28d91ceeec8ce757d2b9b47db2f22abbfe198f82`。
- inventory Evidence：`ev_1f5d17f7df2de0bb3d6f0afc28aceb7c68a1b055ff2148903f907b7915314a3b`。
- integrity contradictions=0，4个子文件及根节点共5个节点。

REA证明此冻结归档的字节身份与结构；JSON/SQLite字段解释由独立解析完成，未执行效果，也未自动恢复转场公式。原生新资源调查完成后将在下节追加；不能把本节结构完整视作完整1:1已完成。

## 后续可直接复用的验证载体

独立生成`artifacts/qa/transitions-v8/spatial-source.mp4`：1280×720、30fps、180帧、Rec.709标签，前后三秒各一张不同的四色象限图；两像素网格以160×120分格，角落标记非对称。源0—2秒和4—6秒组成四秒目标可留下同图handles，不把源内容变化误作转场。它是本项目生成测试素材，不是原生资源。仅生成和ffprobe检查，不是原生输出或画面一致性证明。SHA及空间定义见`spatial-source-definition.json`。

缓存panel第1211行列出15种转场分类；第1212行308项按metadata拆分为284项isOverlap=true、24项false；236明确VIP、1明确非VIP、71缺VIP字段。保留完整最小身份清单`cached-category-identities.json`，不能把71项自动标免费，也不能把15种分类都视为已取得全部条目。

另将308项准确effect_id与本地effect直属目录逐一连接，仅匹配叠化322577（14文件）和闪黑321493（24文件），其子目录MD5与响应相符。此检查补足仅搜索transition声明可能漏包的风险，仍局限于该分类和该缓存布局，见`catalog-cache-join.json`。

## 修复0.7的UI准入缺口

主任务授权后，提取`apps/editor/src/transition-candidate.ts`供Vue与测试共用。原组件先把max钳在source handles内，即使素材已实际证明CFR30、核心允许首末帧延展，也会因右片sourceIn=0先被挡住。新helper只生成建议时长，每个候选仍完整调用`validateDocument`，由其中的`transitionBoundaryPolicy`决定准入；没有拓宽核心策略。

充足handles仍首选半秒；已证CFR30的居中零handles窗口需要两半均落整帧，默认改试14/30秒（半秒对应每半7.5帧，不能用于此限定策略）。如延展未获准，则再尝试原有可用handles上限，仍不足就说明需调整采用区间。所有时间为有理数，不再先转浮点再四舍五入六位。

同一UI的时长框显示六位小数也会使14/30变为0.466667；现在未改变显示数值时保留原有理数，明确改值仍按新输入校验。临时候选ID也避免与已有其他转场ID碰撞。旧素材未知帧率/VFR、非30输出、2x、半帧切点没有被零handles例外放行。

新增6个共用helper测试；与核心、clone、导入、GPU规划一起27/27通过，typecheck退出0。初次红测是helper尚未创建的`ERR_MODULE_NOT_FOUND`。真实界面添加、显示舍入时长再应用、撤销重做、预览及保存重开交父任务实际检查，不能把这些单元结果称UI已验收。测试摘要`candidate-helper-verification.json`。

## 新缓存布局与六个实际资源包

原生操作取得的新包位于`Cache/artistEffect/<resource_id>/<hash>`，这与此前检查的`Cache/effect/<effect_id>/<hash>`是不同布局。旧双路径inode相同的结论仍只针对effect别名，不能扩大为artistEffect也已经被扫描。本轮分别冻结三个artist包以及原生重开后自动选择的三个legacy包，共112个文件；REA对六份ZIP逐一open/inspect，全部integrity=fail策略成功，最后逐文件再核来源SHA，112/112相同。

完整hash、REA inspect/inventory Evidence及所选配置/Lua/shader SHA在`rea-resource-evidence-index.json`，私有代码只留ignored目录。REA提供归档身份和结构，方程来自对精确资源的独立静态解析，运行结果来自实际MOV，三类证据不混同。

| 资源／布局 | ZIP SHA-256 | 完整inspect Evidence |
| --- | --- | --- |
| 闪白artist（26文件） | `6a7bc9dd9d2f02bdb931836a3802ca36bbd14ad2c7c18b852f0fcbe75200c08a` | `ev_45a888d4d900a7c96c6d8c3ed5aac7bf4d037cbd17f8a94264830601300b0329` |
| 向左擦除artist（16） | `fec6ca77fc67333f09017cfbd29aeffdfc65f4961da2c6cd6c7c68dcbbfb5b95` | `ev_1c88014d4523f5628aad1a12042260ced13f2486787352039b05aa11896fb827` |
| 圆形遮罩artist（16） | `2e2489e1f479c8babef0e3fb81496161b5e2877c7c8894677f0ac8c969bb474b` | `ev_6e5c1ea1673be2145a8dc21d297a130b84c044a7376820ca4c943b19f10f15d3` |
| 闪白legacy（26） | `e5009eeddfe1d23cc04a6c610d5139d849e690aaa08fe47135ab5cbb029d8c04` | `ev_6f15d2143ded1646199b2503148813bc98aeb5ca54efc21516682d1988a5f4af` |
| 圆形遮罩legacy（14） | `c5526d9cae94c6051861d80bf1691dd7b34c4db43ea6af9c6262c6788fc52abf` | 见Evidence索引 |
| 向左擦除legacy（14） | `ec70cdb017092c11d6d9fda653f5875521cb34b9977ba8984aed38cfc2253f3a` | 见Evidence索引 |

即使名称和resource_id相同，两种布局也不是同一个版本。白闪两份Lua后半输入不同；空间包的fragment字节相同，Lua视觉绑定部分相同但artist增添audio启动路径。不能因为shader相同就不记录包版本，或把包清单当完整在线库。

### 闪白：已确认的公式和输入绑定

取归一进度p，令`wa=max(1−2p,0)`、`wb=max(2p−1,0)`、`ws=1−wa−wb`。独立实现为预乘RGBA的`wa*A + wb*B + ws*(1,1,1,1)`，中点是覆盖下层的不透明白。

artist Lua两半都绑定TransitionInput0；legacy后半切到TransitionInput1，fragment同样向RGBA白混合。实际11原生MOV明确证明后半是B，不是继续淡入A：48个4×4内部色块，后半AB模型MAE1.042；错误持续A模型67.618。11原文件名带default，但保存duration实为1000000µs，本报告明确称1秒。

| 原生输出（均120帧/4秒/720p30） | 固定理想白255的MAE／最大码值误差 | 实际中点 |
| --- | --- | --- |
| 11不透明grid | 1.148557／5.75 | 全部采样[253,253,253] |
| 14c更正alpha=.5 grid＋绿底 | 1.196411／4.0 | 全部采样[253,253,253]，下层绿被覆盖 |

A/B采用同一导出首尾像素校准，白255是固定方程输入，没有拟合为实测253来缩小误差。此处是48个内部色块，不是全部像素、GPU浮点或编码字节1:1。`native-flash-white-analysis.json`和`native-alpha-white-corrected-analysis.json`保留全部120帧采样。

14/14b最初所谓半透明输入实际三个alpha均1；已保留快照及失败分析，不能作为透明度证据。更正版按素材path匹配两个非空grid片段并逐项断言.5，绿底1，才由原生重开/导出14c。原生保存14c时path还自动从artist改为legacy `effect/322575/9732e719...`，effect_id和resource_id仍都为6724845376098013708；白名单只列实际观测到的两组身份，不推断旧数字effect_id322575也已被本轮UI创建验证。

### 空间效果：正常UI false与受控true的差异

向左擦除的精确fragment是同UV选择：`x<=1−p`取A，否则B；没有启用旁边注释中的quint easing或0.01软边。圆形遮罩以**像素坐标**量距离，圆心画布中心，半径`p*sqrt(width²+height²)/2`，严格小于时取B；不能直接用normalized UV的圆而拉成椭圆。

首次UI替换得到12b/13均保存is_overlap=false，与extra声明true冲突；另外清掉转场和refs后重新在UI添加向左擦除得到15，全新transition.id，仍false。15实际输出与12b相同的硬切行为，排除“仅旧转场ID残留”的解释。

| 实验 | 遮罩模型全图MAE | 硬切模型全图MAE |
| --- | ---: | ---: |
| 12b wipe UI false | 30.301847 | 0.180070 |
| 15 fresh wipe UI false | 30.301847 | 0.180070 |
| 13 circle UI false | 22.509830 | 0.180264 |
| 17b wipe受控true | 0.245029 | 30.323420 |
| 16 circle受控true | 0.288908 | 22.531766 |

true输入是**离线只改is_overlap后由原生重开接受**，不是UI正常添加的结果。重开还把资源path自动改为legacy：wipe实际`effect/322599/ea955d4c...`，circle实际`effect/325117/a7eb1d47...`。因此完整可观察状态包括模式和包路径两项变化，不能仅凭这些输出断言type2内部究竟如何给两纹理赋值。0.7静态type映射和本轮结果支持该方向，但底层因果仍留边界。

16/17b虽整体符合方程，原工程canvas640×360、实际导出1280×720；全图最大误差circle230、wipe229，不能隐藏。排除数学转场边3像素带后MAE分别0.203974/0.187629。较大局部误差与画布/导出栅格边界或缩放有关是待验证假设，不能直接归为H.264编码。主任务另做canvas1280×720对照，结果在后续追加。

产品false记录继续明确诊断，不把正常UI的硬切导入成看似完成的命名效果。空间新类型仅允许已核身份+true，并暂时限定1280×720、30fps、1x，输出尺寸一致；其他范围显式拒绝。正式CPU预览也保留画布尺寸，不悄悄降为640再改变遮罩。GPU共用同一时间窗和空间方程，真实GPU逐点测试仍交父任务，不以纯规划测试代替。

### 声音、注册与未验证项

三份初始白闪/wipe/circle原生MOV虽含AAC轨，解码354176浮点样本全部为0；没有据此宣称effect中的音效已复刻。artist circle含私有mp3及audio脚本，它们未复制进产品；其它音效开关或音量情形仍未验证。

新grid素材正常链接时还需原生真实local_material_id、canonical path与原生duration匹配；仅替换文件路径/分辨率并不足够。原生登记的grid duration为5966000µs，FFprobe容器为6秒；主任务将右片源改3.5—5.5秒后正常接受。没有更改系统权限。实验设置和归因都保留为有界事实，不把失败链接解释为OS拒绝。


## 本轮实现与当前验证状态

- 闪白：core类型/命令、严格原生身份、媒体预乘白色mix、GPU白色mix与Vue控件均接通；独立实现数学，没有加载目标资源代码。
- 端帧延展候选：修复UI提前按handles判否和六位小数覆写有理数的问题；原核心CFR30检查不变。
- 空间转场：true legacy身份、共用source-handle策略、像素空间遮罩已接入；画布、输出、fps、速度gate明确。低分辨率到高分辨率像素一致性尚在补验，不扩大准入。
- 新增测试：候选6、白闪4、空间4；白闪opaque与更正alpha均与实际原生采样比较，空间包含真实FFmpeg输出及尺寸拒绝。空间两次720p正式编码约30秒，不能称CPU实时预览。真实GPU性能和桌面UI验收由主任务完成后另行登记。

REA helper已export全部Evidence、close_binary、写自有STOP并正常退出（exit0），没有遗留REA后台进程。原生UI由主任务继续调查其他范围，本子任务从未直接操作或写入正在运行的原生草稿。


## 同画布补验、YUV色度相位与产品实际编码残差

主任务正常重开两份仅把canvas改为1280×720的true输入，保存18/19并真实导出720p30。原生已正常退出并恢复47395字节原草稿，恢复SHA由主任务`artifacts/qa/native-v8/restoration.json`记录。子任务没有写原生草稿。

新的同尺寸MOV仍出现同类RGB局部最大差：wipe229、circle230。因此“只因640画布放大到720p”的猜测不足以解释现象，已经撤回该归因；同尺寸结果也完整保留，不能只列整体MAE。

进一步直接解码原生YUV420平面，用同一输出首尾平面作A/B；亮度按全分辨率像素中心`(x+.5,y+.5)`，色度候选按半分辨率像素对应的全分辨率坐标`(2x+phaseX,2y+phaseY)`计算相同遮罩。候选相位比较完整保存，不把RGBA结果先拟合gamma：

| 720p原生／平面 | 候选模型MAE／最大码值差 | 坐标观察 |
| --- | --- | --- |
| wipe Y | 0.054323／8 | 普通像素中心.5 |
| wipe U／V | 0.112359／11；0.110826／15 | x相位.5；此横向遮罩无法辨认y相位 |
| circle Y | 0.058377／18 | 普通像素中心(.5,.5) |
| circle U／V | 0.124723／18；0.119724／23 | 本组最佳候选为(.5,.5) |

这组直接平面证据解释了为什么RGB边缘可能混合两侧不同的亮度／色度，而不要求错置转场时间。例如wipe frame61 x597的RGB[255,112,123]既不是A也不是B；Y选择B而同组UV保留A时会有这样的彩色边。**证据只描述输出平面观察，不证明native在渲染、颜色转换还是编码的哪个内部阶段完成该取样。** 不能据此说所有编码误差已经复刻。详见`native-yuv-plane-analysis.json`、`wipe-boundary-inspection.json`。

### 产品实际MP4对同尺寸原生MOV

按18/19真实快照导入本产品，诊断为空，分别真实导出120帧H.264 MP4；未使用简化单色输入来替代本组空间grid。两路原生仍为H.264 MOV，均YUV420p/1280×720/30fps。保留工程SHA、产物SHA、完整31帧窗口误差和端点误差；比较的是解码媒体，不是容器字节。

| 实际产品→原生 | 全窗口RGB MAE／最大差 | 距数学边缘>3px的MAE／最大差 | 首／末基线RGB MAE |
| --- | --- | --- | --- |
| 向左擦除 | 1.180261／150 | 1.121658／67 | 1.288693／0.923969 |
| 圆形遮罩 | 1.192664／239 | 1.079676／67 | 1.288693／0.900749 |

这些结果**不是逐像素等同**。产品最终颜色／色度转换和编码与目标仍有差异，不能用GPU对理想RGB数学正确来消除该事实。数据在`product-native-encoded-comparison.json`；本次两个产品实际导出在ignored `artifacts/qa/transitions-v8/product-{circle,wipe}/render.mp4`。

独立检查端点亮度差>32的像素，以各自输出的A/B端点判别遮罩侧：native两个形状均0误分／20802581样本；产品wipe0／20799016；产品circle293／20793994。该计数只表示**编码后端点亮度分类**，不是直接观测前编码shader。circle的293处中275处在数学边缘半像素内、290处在1像素内；另3处最远24.347px，原因没有最终逐点核实，不擅自归因于grid量化或编码。计数分母和逐帧结果都保留，见`product-circle-encoded-boundary-residual.json`。

受限实现按主任务明确决定保留：准确资源与true模式、1280×720画布和输出、30fps、1x、完整核心校验；false实际UI记录继续诊断，其他范围继续拒绝。当前支持表示数学与已列行为可用，**不表示目标的所有边缘像素、音效、素材库或UI都已1:1完成**。

### 回归冻结

本子任务47项聚焦回归全部通过、typecheck通过；补入18/19真实同尺寸快照后，原生身份、gate和新增内部采样3项静态测试又通过，实际渲染实现没有再修改。内部采样检查保留边缘带独立计数：wipe1488个patch／最大1.5，circle1460个patch／最大1.5，circle另28个跨边patch不混称内部通过；其完整全图max229/230在测试中继续明确保留。

主任务随后运行全量、构建与桌面验证，最终结果以主报告为准。GPUworker第三轮开始前，本子任务已结束所有FFmpeg、测试、REA计算并明确回报空闲；此后只写文本，没有影响其连续播放测量。
