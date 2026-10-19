# REA v7：尚未开放的基础效果数学与库存

2026-10-19，固定本机剪映5.9.0。本轮只读静态资源与精确原生入口，未操作UI、改原程序、下载或安装软件；没有修改产品源码。以下黑白场、褪色、锐化、暗角与颗粒仍为候选，必须经原生草稿与真实输出验收后才开放控件。本报告不重复已完成的温度/对比度调查，也不把静态结果称作完整1:1。

## 实际REA证据与身份

- 原生库SHA-256固定为 `be0dd5c522e2b0511202cfa2bd27dc7075b3e5ab7cea820bef4c2664d80afe81`，分析地址经既有nm符号表核对。
- 复用已有app inventory `ev_8ba3cab42fdf2a353252f24f47c6c0a8cb51360185c0995c501510b51bb8111e`，实际新调用 `inspect_analysis_view` 选择70条资源路径，0.315秒，Evidence `ev_5cb0bfd23860a161de7c1ab809f6b2271cf3900dd7e204df42de77c5cd614432`；视图70/70、exhausted=true。重新读取这70个文件并逐一SHA-256核对，全部符合原manifest。未重跑全app扫描。
- 实际新 `analyze_function`：`lvve::DraftQuery::get_material(MaterialPictureAdjust const&, LVVEMetaType)`，地址 `0x16e1fec`，18.068秒，Evidence `ev_99ecf532aaa80737106ff8bfb4ffda20a2fef4704973d19efa5bc0622bfa4055`。恢复有限枚举分派，并用nm把目标地址核对为 getter：0x15→sharpening、0x18→white、0x19→black、0x1a→clear、0x1d→fade、0x1e→light_sensation、0x1f→vignetting、0x20→particle。这只证明材料字段分派，不证明效果执行顺序；callee coverage仍partial（20个调用目标未被Ghidra完整解析）。
- 沿用REA6.7.0/Ghidra12.1.4/Java23与定向seed，未安装软件。会话已export完整Evidence bundle，再close_binary保存snapshot，随后STOP结束helper。新证据、来源哈希与可重复执行的独立解析脚本位于ignored `artifacts/rea/effects-v7/`；没有复制闭源shader、纹理或伪代码进产品。

## 可以独立实现的候选

| 效果 | 数学完整度 | 原生运行缺口 |
| --- | --- | --- |
| 黑白场 | 已有无纹理的控制点→仿射→clamp完整数学 | 实际type/version、UI范围、组合顺序与输出未验 |
| 褪色fade | 包内17³ LUT全点严格可分离，可重建17节点标量分段线性曲线 | 实际使用资源、sampler filtering/颜色标志、原生强度与输出未验 |
| 锐化v1 | 空间3×3算子、增益映射及材质内储存默认值已读 | host是否覆盖默认值、纹理边界、实际采样尺寸/缩放顺序未验 |
| 暗角v1 | 实际scene→material→xshader绑定与完整Bezier/空间公式已读 | 当前资源代际、UI参数/实际UV与输出未验 |
| 颗粒v2 | 单像素hash和幅度方程已读 | 随机种子、时间更新和稳定重现未闭合 |
| 光感 | 17³查表/正负选择/混合明确；数据有明显跨通道耦合 | 不能简化为一维曲线；完整独立重建与原生输出未验 |

## 黑白场

归一black=b、white=w，候选范围[-1,1]。先建白控制点：w≥0时(xw,yw)=(1−0.5w,1)，否则(1,1+0.5w)。黑控制点：b≥0时(xb,yb)=(0,0.5b)，否则(−0.5b,0)。然后依次修正 xw=max(xw,.005)、yw=max(yw,.005)、xb=min(xb,xw−.005)、yb=min(yb,yw−.005)。

斜率m=(yw−yb)/(xw−xb)，偏置k=yb−m·xb，逐RGB输出clamp(m·c+k,0,1)。不是去饱和的“黑白滤镜”。独立资源 `black_white` 与合并资源给出相同数学；事件key为black_intensity/white_intensity，合并栈在高光/阴影之后、温度之前应用。

独立数学probe检查201×201强度组合×257通道样本，全部有限、单调；斜率范围约.005至200。极端b=-1/w=1的两控制点最小横距.005使曲线很陡，不能删除该保护或随意换成曝光。该网格只是数学自洽检查，不是原生验收。

## fade的新格式结果

`fade/amazingfeature/texture/fade_max.texture` 为753字节，PNG在偏移413；合并版为1038字节，PNG在偏移698。两者封套不同，但内含完整340字节PNG相同，SHA-256为 `d737e0c779de935892b065f52a8b9e997bf675e6bcd4dd0f7bdea25728054274`。PNG为289×17、RGB8、无隔行，仅IHDR/IDAT/IEND，所有chunk CRC通过、zlib完整且无多余尾数据。

按资源声明的17×17×17布局（像素坐标blueIndex×17+redIndex、greenIndex），独立解析全部4913点后，输出RGB各自只依赖输入同一通道，跨通道可分离误差严格为0。输入j/16对应17个输出字节：

`69,72,75,80,86,94,104,115,128,141,156,170,182,193,203,211,218`。

在线性纹理采样成立时，静态查表可数学等价为各通道的17节点分段线性函数F，再按fade强度i混合 `(1−i)c+iF(c)`；合并Lua将i限制在[0,1]，独立旧资源使用abs(i)。输出clamp、alpha保持。因此无需把封装纹理复制进产品即可独立重建候选标量行为。仍未证明实际目标使用此资源，也没有由PNG无gAMA/sRGB chunk推断引擎一定不做采样颜色转换。

## 锐化v1

Lua有效事件仅将sharpness写成1.6i，white_gam/black_gam的setter在该文件中已注释。材质三个唯一字段有相同有界记录结构（u16名称长度、名称、固定4字节tag、uint32值5、8字节数值）；以IEEE-754 little-endian float64解读：

| 字段 | 名称偏移 | 数值偏移/原字节 | 储存值 |
| --- | --- | --- | --- |
| white_gam | 299 | 316 / 000000000000e03f | 0.5 |
| sharpness | 326 | 343 / 0000000000000000 | 0 |
| black_gam | 353 | 370 / 000000000000e03f | 0.5 |

这是三个精确字段的有界格式解释，未称完整SerializedFormat解析器，更未把储存默认值等同运行时uniform。

中心与8邻点先按.299R+.587G+.114B得到Y，再算水平、垂直、右上左下、左上右下四组 `2Ycenter−Yneighbor1−Yneighbor2`。求四者绝对值最大值；按上述顺序找首个与最大值之差≤.01的方向，保留其有符号差分。正差分乘white_gam，负差分乘black_gam，再乘sharpness，加入中心Y；按资源YCbCr逆矩阵返回RGB、clamp，alpha取中心。不能直接拿最大绝对值本身相加，容差内的方向优先级会影响正负与结果。

若host不覆盖材质默认值，有效亮度差分增益为0.8i。资源Utils覆盖renderChain声明的720×1280为BuiltinObject实际输入宽高，RT采用RGBA8Unorm；不能硬编码720×1280。u_ScreenParams与实际处理分辨率、纹理边界和缩放顺序仍须边缘图核验。

## 暗角、颗粒和光感

暗角scene的EntityVignetting实际指向vignetting.material→vignetting.xshader→vignetting.frag。强度i先将x=(i+1)/2输入三次Bezier，i>0的控制点(.2,.45,.63,.81)，其他为(.65,.2,.81,.63)；按x二分反解t直到间隔<.0001，取p=2BezierY(t)−1。令d=length(2uv−1)，S=1.415。i≥.0001时，a=(1−.9|p|)S、b=(1.4−.55|p|)S，v=smoothstep(a,b,d)，输出c(1−vp)。其余分支a=(1−.8|i|)S、b=(1.5−.6|p|)S，输出(1−v)c+v。白角分支没有额外乘|p|，半径也不应强行统一；UV公式不带屏幕宽高比校正。保存了独立probe，但实际路径与输出仍未验。

颗粒v2将强度乘.25；hash输入为(uv.x,uv.y,seed)乘9331.99，经fract(.1031×坐标)、与旋转分量+33.33的dot扰动，输出归一noise−.5，再乘强度；同一noise加到RGB后clamp，alpha保持。Lua用math.random，curTime变化时换seed；本地seekToTime为空，时间注入与随机状态未闭合。只能说可独立重写候选视觉算子，不能承诺逐帧重现同一随机纹理。

光感正负PNG均289×17，完整CRC/解码通过。按同通道轴向曲线尝试可分离重建时，全4913点最大偏差为负向169、正向144个字节值，明确不是一维独立通道曲线。已知规则为负值选min LUT、正值选max LUT，再按|i|混合；不能用fade曲线、任意曝光或普通调色矩阵冒充完整光感。

## 关键来源哈希

| DefaultAdjustBundle下文件 | SHA-256 |
| --- | --- |
| sharpen_v1/AmazingFeature/prefabs/sharp/material.material | 5bc6691646288cbd0882bd176173c84b32c6c69e6448a18093a9b76d14aa7a2e |
| sharpen_v1/AmazingFeature/prefabs/sharp/fshader.frag | 54d868459400f6f7ef5df5d0b10b59586eb507ba070a768ff9369f51a1477a1b |
| black_white/AmazingFeature/lua/Lscript.lua | 8a497bb0f5ced6fcc0c3bb0f0b44f5df61edbc33d42273756b5c341f9e4f0a8f |
| black_white/AmazingFeature/xshader/quad.frag | a3125391dcc73e6e7462cae93872d97694bc2dadadb215f54474818585b507be |
| combine_adjust/AmazingFeature/image/fade_max.texture | 648fde49b34f96e49c7ff2558e5fd0c695969ac135ee4b76d2fad3ead2a53ef3 |
| combine_adjust/AmazingFeature/image/lightSensation_min.png | 78301ba10f536d05575db598044a642842f43549352cd80b577b8d3854d865c4 |
| combine_adjust/AmazingFeature/image/lightSensation_max.png | 229205389beae841f133e2cc9e524ed7949c3a5ab29240ecadb234238a87138a |
| vignetting_v1/AmazingFeature/xshader/vignetting.frag | a5e6391c2da90f48f39d9b3d0fa267a69d8c5d6308888982a67fa84ff39e8c75 |
| particle_v2/AmazingFeature/xshader/noise.frag | 14d41a7144f9269b027f504e6fdc7cb616e3e96fafbcf101fe893f20c7545f05 |

## 活动cache库存边界

同时有界核对普通Movies路径及 `Library/Containers/com.lemon.lvpro/Data/Movies/.../Cache/effect`。沙盒路径realpath解析为普通Movies路径，两者device/inode都为16777231/106629809，是同一目录，计数不得累加。各自当时扫描返回7,215文件，236个config/extra元数据、228个资源ID；仅叠化322577与闪黑321493有transition声明。仅解析config.json/extra.json并保存各元数据SHA，未执行资源脚本或查询在线商店。

目录在父任务UI下载/实验期间变化，记录为非原子时间点库存。资源ID数不是命名特效数，未缓存不等于不存在。原生运行验收与完整在线目录仍是独立缺口；本轮静态报告完成不代表全部效果补齐。
