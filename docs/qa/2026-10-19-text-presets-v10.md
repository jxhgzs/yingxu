# 文字预设与复杂组合 v10

固定本机剪映专业版5.9.0，沿用批准的Vue/Electron和独立媒体引擎。原生UI由父任务操作。本轮按照REA技能broader第6条独立分工，新增三个有实际原生导出对照的预设：入场「打字机 II」、出场「缩小」、循环「轻微跳动」。普通文字三阶段与caption/group模板分别记账；本报告不宣称全部剪映或字形像素1:1。

## REA工作范围

复用v9已核验的主arm64哈希/profile及三个文字桥接入口证据，没有重复冷分析大型原生库。独立主会话 `artifacts/rea/text-presets-v10` 执行11次新调用：import原应用库存与桥接Evidence，open应用，定向view已留存模板路径，分析三个精确模板JS文件，对三个新资源目录分别建立库存，读取一次有界JS事实，export、close。纯观测收据为 `evidence/2026-10-19-text-presets-v10/rea-session.json`；私有切片、profile、完整bundle均留在ignored目录。主会话export成功；附带snapshot的close在.app元数据目标上因缺具体provider analysis profile被拒，原始integrity_mismatch收据保留，不能计作close成功。主helper经STOP退出码0；随后独立metadata收尾会话执行open/export/无snapshot的close成功，再STOP并退出0。共14次新调用，含一次明确失败，不将失败隐藏或当作资源算法问题。

三个新资源的REA调用只建立目录/JSON库存，**REA没有解析Lua数学**；公式来自人工只读资源核对，并经独立原生MOV检验。不能把零JavaScript节点/semantic unknown说成Lua反编译成功。初始有界Cache/effect库存59个InfoSticker目录，49个仅preview、10个含Lua；之后原生UI新增下载的缩小和轻微跳动另记，不用初始库存冒充最终库存。未执行私有bundle、发布动作或网络请求。

模板结构切片限定为应用内 `aigc_text_template/js/template/template.js` 与两个模板发布chunk，共3文件82,711字节、21,563 AST节点、184个静态finding、12个module、0 parse failure。部分依赖没有纳入切片，导入关系不等于运行证明。

## 实际原生样本与恢复公式

| 预设 | 实际ID / resource | 已取得对照 |
|---|---|---|
| 打字机 II | 1644276 / 6724920636403094028 | 六汉字、ASCII/汉字/空格/LF混合单项，以及两种时长的三阶段组合 |
| 缩小（出场） | 1644602 / 6724921351385125387 | 单项及三阶段组合 |
| 轻微跳动（循环） | 1644525 / 6884155832838132231 | 单项、两种组合、混合组合、横屏/竖屏/方屏、scale2/rotation30 |

全部MOV由正常原生UI导出，接受后的实际JSON在 `artifacts/qa/native-v10`。入场.3/循环.7/出场.4与入场.5/循环1/出场.4由已正常取得资源构造受控输入，正常重开原生、接受并导出，明确区别于全部数值都由控件输入。完整MOV路径/SHA/纯证据索引见 `evidence/2026-10-19-text-presets-v10/native-manifest.json`。六汉字为「文字动画对照」，混合文字为 `AB C中文\nD EFG`（存储为实际LF）。会员资源12453543仍只有静态候选，没有绕过登录或会员限制。

### 打字机 II

N是原文字entry数，包含ASCII空格和LF；i从1起。每字相对alpha为 `min((t / (D*i/(N+1)))^4, 1)`，负时间夹到0。它不是打字机I的Floor揭字阈值。原生richText资源另有SDK条件；实际5.9导出确认本机走该quartic分支。

- 六汉字完整120帧、6个独立实心字形mask：最大alpha误差.0180722，RMSE .00291942；错误Floor假设最大误差.769827，保留失败候选。
- 混合单项完整120帧：按原12 entry最大误差.0197348、RMSE .00255256。删LF、只算可见字或删空格分别最大误差.234826/.358818/.347443，全部保留。
- 混合三阶段组合的入场.3：按原12 entry最大alpha误差.0187409；没有因为多行而压缩时钟。

`textAnimationLetterOpacities`只返回连续相对alpha。ASS与service identity先乘未量化的源opacity/阶段opacity，再逐字量化为8bit；不能先量化公共opacity再乘每字，否则缓存可能合并不同输出。仍保留完整原行推进，不把可见前缀重新居中。当前常用汉字、ASCII、空格/LF字形边界沿用既定保守规则，复杂shaping不因此宣称恢复。

### 出场缩小

令 `p=clamp((t-(L-D))/D,0,1)`：alpha=`1-p²`，scale=`1-.5*p²`。单项D=.5、4秒/30fps，在105帧开始。原生实心mask最大alpha误差.00732026，原生bbox相对同片baseline最大1.28px。错误沿用渐隐的`(1-p)²`会产生最大alpha误差.499869，已单独保留，未用名称类比替代确认。

### 轻微跳动与复杂组合状态

它是整行位移阶梯，不是逐字正弦或晃动。循环局部时钟从入场结束计算，period独立于入出时长。周期r的六段闭右区间对应阶梯 `0,1,2,3,2,1`；单独loop的整周期回到0。包含入场时，已关闭的入场端点仍归入场，之后精确整周期边界保留上一段状态。所有判断使用rational，不通过epsilon改动属性时钟。

向下偏移为 `step * .0025 * max(canvas.width,canvas.height)`，再受源scale与rotation变换：`dx=-sin(rotation)*sourceScale*offset`、`dy=cos(rotation)*sourceScale*offset`。

- 初始height/2假设被横屏实测否定，width/2推广被竖屏实测否定，均保留调查过程。1280×720和720×1280实际均为0/3.2/6.4/9.6px；720×720实际0/1.8/3.6/5.4px，排除了固定内部1280画布假设。
- scale2/rotation30的实际质心位移支持上述父变换，两个坐标残差均小于.1px。
- 资源退出清理存在大小写不一致，实际MOV确认出场**保留最后loop输出帧位置**。`.3/.7/.4`中107帧最后loop为9.6px，108进入缩小后仍保持，直到末帧；`.5/1/.4`最后loop为0，出场保持0。按出场起点连续重算会得到6.4，直接清零也不符合第一样本。
- `textAnimationOffsetY(..., fps, targetStart)`显式用绝对输出网格确定最后loop帧。位移受源scale/rotation，但不乘出场preset.scale。源属性仍在原输出时间求值，不用时间偏移模拟状态。
- 六汉字单项120帧、两个组合111/105个完整显示/出场帧的独立位移fit均匹配；混合组合与六汉字位移fit最大差.1px。fit与编码残差另列，不称像素相同。

## 产品接入与验收

更新core严格kind/phase校验、文字ASS、graph字形校验及Ant Design Vue的入场/出场/循环选择。新预设继续走完整ASS逐帧纹理；没有通过近似shader替代文字权威。旧fade/typewriterI/flash/zoom-in/sway分支保持原数学与相位；三个阶段可共存，循环周期不计入入出总时长。

service使用相同helper，soft加入最终letterAlphas，bounce加入最终x/y身份。GPUworker保留旧kind身份格式，并以旧实现失败/新实现通过的反例验证soft帧与bounce位姿不误合并。缓存单批32、RGBA128MiB、GPU32纹理128MiB、磁盘512纹理256MiB和每窗300的边界由其独立测试负责，没有因新预设放宽。

实际产品 `render()` 导出4个4秒MP4，观察分别与同产品静态基线和独立原生动作比较：

| 产品观察 | 结果 |
|---|---|
| 打字机II六汉字alpha最大残差 | .0219087 |
| 缩小alpha / bbox最大残差 | .0125491 / 1px |
| 单项轻微跳动、三阶段组合对原生位移fit最大差 | 均.15px |

产品字体baseline为[515,341,764,379]，原生为约[531,343,748,376]，明显不同；这些结果证明动画时钟/alpha/位移的限定对照，不能遮盖字形/字宽/抗锯齿差异。v9 AA52、紧密kerning和复杂shaping边界继续保留。

六组41个真实scalar/batch帧PNG逐字节相同，包括实心/outline/shadow、alpha.713、混合LF、scale1.3/rotation30，以及107/108/111/119的loop→out冻结边界。完整GPU authority在 `artifacts/qa/text-presets-v10/authority/cases.json`，纯SHA与帧列表在 `evidence/2026-10-19-text-presets-v10/scalar-batch-identity.json`。GPU实际像素/性能由独立GPU报告记录，CPU PNG字节一致不冒充GPU通过。

新增9项独立测试读取冻结原生观测、错误假设、产品残差、ASS逐字alpha与位移；另与旧文字/字形/实际ASS渲染回归合跑25项通过（当时新专项7项，收尾追加2项后单独9项通过）。最终typecheck通过。源码冻结后停止全部自有FFmpeg/REA/测试进程，为父统一全量及真实性能留空闲。

## caption / group模板边界

定向REA切片确认独立模板层接口：rootWidget、setTimeRange、createLayer传递layerName/params、start/end及screen dimensions，并依赖content.json/js/main.js。发布chunk出现SubtitleTemplate、TextTemplate collection、目录和鉴权元数据，但其groups可表示分类；没有把它当渲染组合或证明内部动画数学。

普通文字三页的新复杂组合已按实际MOV恢复上述明确部分；多元素模板仍需正常UI免费实例的text_templates/combo_info/group_container、实际资源和导出对照。未知模板不加入支持enum，不复制私有Lua/JS到产品，不把普通in/out/loop共存说成已恢复所有caption/group。

### 新取得的真实多元素模板：雨过是天晴

收尾时正常UI完成下载并用“+”实际加入，移除了旧基线后成功导出；此前双击/拖动未添加发生在资源未下载完成期间，失败记录保留。实际fixture `artifacts/qa/native-v10/11-template-rain-ui.json`，MOV `/Users/tal/Downloads/yingxu-native-template-rain-v10.mov`（605,540字节，纯证据记SHA）。它是**真实模板结构且有效导出**：GPU性能结束后获准轻量解码，实际1280×720/30fps、恰90帧，仅frame0黑，frame1开始可见，其余89帧均有可见像素；已亲自查看17张关键帧联系表，76/89帧显示完整「雨过」「是天晴」「Rain」与绿色曲线贴纸。父此前观察预览0帧黑，现证实是初始透明，不能按首帧将模板当全黑失败。动画/gradient数值尚未逐层验证，不能据有效MOV宣称产品已支持。

纯证据 `evidence/2026-10-19-text-presets-v10/template-rain-static.json` 保存11号JSON/各资源SHA、4层声明、静态候选数学、明确未知及具体后续矩阵。只读9个明确资源、82个文件；未启动新REA/helper、未执行私有脚本、未改变冻结源码。后续只对真实MOV作两次有界解码用于全90帧可见性统计与17帧联系表，没有产品渲染或新原生导出。本模板调查是在已完成REA结构路径调查后的定向人工静态核对，不能将人工Lua阅读改称REA已恢复算法。

实际文本轨只有一个clip，material指向template7349464671453269299；`group_container=null`、`combo_info`为空不代表没有组合。真实父子关系由`text_templates.text_info_resources`和模板`content.json.children`共同给出：

| order（从后向前） | 子层 | 初始局部position | 原始尺寸 | 入场resource / 时长 |
|---|---|---|---|---|
| 1 | 静态PNG贴纸517×232 | (-2.3840,-25.3526) | (517,232)，scaleX1.1156379 | 6763469998330483213 / 2.5s |
| 2 | 雨过 | (-118.9742,92.2342) | (302.4073,241.9258) | 6897084405781631496 / 1.5s |
| 3 | 是天晴 | (83.4114,-73.4117) | (414.7300,241.9258) | 同上 / content1.8s，draft1,799,999μs |
| 4 | Rain | (119.4724,63.7644) | (221.5,97.625) | 7089261793406620197 / 2s |

四层start=0、duration=3s，父root preview_time=2.533333333s（约76帧）。**贴纸入场只存在于content资源树，draft的3个material_animations都属于文字**；只读取draft的refs会漏第4个动画。Rain与是天晴的bottom/right锚定到雨过；贴纸bottom/left/right也引用雨过，且fix_width=false。锚定不能简单解释为边缘必须零间距，需要实测保留初始offset及改字后的reflow。

#### 静态数学候选，不计已支持

- 汉字入场6897084405781631496是整张文字RT的横向柔边揭示。静态候选令p为quadOut(t/D)，alpha mask为 `1-smoothstep(1.2p-.2,1.2p,u)`，过渡宽.2。实际UV方向、文字RT额外padding、leave后状态及运行分支均待MOV验证；逐字几何通道默认恒等，不能将其当逐字移动。
- Rain入场7089261793406620197按行分组，排除LF后在行内依序延迟，alpha和.95→1 scale使用Bezier控制点(.22,.6,.52,.93)，并有额外噪声、wave和blur纹理pass。资源覆盖参数blurSize=2、blur_live_time≈.781、noiseInfo.z≈.1。字体连字、空格entry、EditorSDK/autoplay分支、UV/padding和各pass复合方式尚未确认，不能套用打字机II或仅淡入代替。
- 贴纸入场静态候选alpha在总D前20%使用quadOut，scale .9→1及位移在整个D使用quadOut；初始localY与textureHeight/outputHeight相关。是否使用原始232px还是拉伸后尺寸、父子坐标转换均需对照，不能复用轻微跳动max-side公式。

#### 字形样式缺口

Rain使用Signeton，字号15、绿字、boldValue.008、italicDegree10；汉字使用凌丝体，rich span字号41.473、字距-.05，并非外层font_size15。两个汉字层均为**逐字符**90°渐变和渐变柔影，不能用整行单色或普通ASS shadow替代。

| 字层 | fill梯度范围/颜色 | shadow |
|---|---|---|
| 是天晴 | stops[0,.47123894]，绿→白 | stops[0,.64380533]，绿→近白，alpha.45 |
| 雨过 | stops[.49336284,1]，白→绿 | stops[.43141592,1]，白→绿，alpha.5 |

两个shadow均distance0、feather≈.0666667；梯度角度方向/坐标空间和feather单位尚待实测。缓存字体/PNG目前只作本机研究资源，没有作为原创产品素材复制。原生字形、bold/italic和渐变阴影需要分别建立基线，不能用动画时钟通过覆盖字体差异。

#### 明确后续实施与取证矩阵

1. **有效帧基线已完成**：实际90帧/3s，完整扫描非全黑，0/1/15/30/44/45/46/53/54/55/59/60/61/74/75/76/89联系表已查看；0黑允许、76/89四层最终可见。全帧记录在 `template-rain-visibility.json`，联系表 `artifacts/qa/text-presets-v10/template-rain/contact-sheet.png`。原11号MOV/SHA保持不变；此项通过只解决样本有效性，未替代后续逐层数学矩阵。
2. **逐层时钟**：分别只保留Rain、是天晴、雨过、贴纸，各保持3秒原位置/样式。重点44/45/46、53/54/55、59/60/61、74/75/76及末89帧。content1.8与实际draft1,799,999μs都保留，比较原UI加入与持久草稿重开的边界，不擅自归一。
3. **渐变与柔影**：每个汉字层依次取白色无影、原fill无影、原fill+原shadow、原完整样式。测逐字UV相对行UV、90°正方向、两梯度stop夹取、alpha.45/.5、零distance和feather单位。采用两底色还原alpha，区分字形覆盖、渐变颜色、柔影和编码残差。
4. **锚点与父变换**：分别将雨过改4汉字、是天晴改1汉字、Rain改更长ASCII，再测parent scale1.5/rotation30；比较三条子层约束与贴纸拉伸、初始anchor offset、父子坐标和order。保留原始rect，不能仅按质心对齐。
5. **时长与帧边界**：在3秒基线之后，分别改root为6秒、1.5秒，验证子层start/duration及入场是否同比缩放、裁切或保留绝对时长。静态JS显示有segment比例映射接口，但它不证明动画窗口跟着同一规则变化。30fps确认后再取60fps/30000/1001，不将普通loop修复规则套到模板。
6. **独立实现顺序**：先受限group IR，保存parent range/design geometry、子层非等比仿射、relative ranges、富样式runs、资源provenance及锚点图；从template parent和content资源树完整解析4层，未知保留diagnostic。再用独立layout依赖排序、字形覆盖/逐字gradient/shadow、揭示mask及已实测的noise/wave/blur算子构造确定输出。由同一authority供export/scalar/batch纹理，GPU只合成确认过的像素；新scene/style/clock身份纳入缓存键，继续验证revision/cancel/现有预算。

当前模型只有flat clips、uniform scale和单色TextStyle，native importer只接受video轨，**本轮并未实现或开放此模板**。上述方案已具体到可分工实现与验证的层/时钟/样式/约束，不再将复杂组合仅笼统归因于“ASS不支持”；但尚未完成的字形梯度和多pass不能先占一个通用enum冒充完成。
