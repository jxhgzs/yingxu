# REA：下一组基础调节与本地转场库存

2026-10-19。本次是静态调查，优先恢复对比度，再界定温度、色调和锐化。原生 UI 与实际导出另由主任务核验。本次没有操作目标 UI、复制闭源 shader/纹理到产品、下载素材、安装依赖或修改应用；没有修改共享产品源码或提交 Git。

## 结论与实施顺序

对比度最适合接着实现：独立 `contrast_v3` 的实际 prefab shader/Lua 与 `combine_adjust` 的对比度阶段给出相同数学关系，无依赖纹理。可以独立写成标量函数，插入现有亮度之后、饱和度之前；GPU 与导出都要在该阶段后 clamp。其原生 UI 数值、草稿版本和画面仍须另验，不能只由资源名认定实际路径。

温度/色调是白点适应矩阵，不能用 CSS 的暖色覆盖近似。锐化是空间 3×3 算子，不能放入现有一维颜色 LUT。曝光没有在本次 `DefaultAdjustBundle` 的 `.lua/.frag/.json` 有界搜索中命中；这不证明应用没有曝光功能，也不证明它等同已有亮度。

## 证据身份与 REA 实际调用

- 原生目标为 `artifacts/rea/libvideoeditor.arm64.dylib`，SHA-256 `be0dd5c522e2b0511202cfa2bd27dc7075b3e5ab7cea820bef4c2664d80afe81`，来自固定剪映 5.9.0。
- 复用既有全 app 资源 inventory，原 Evidence `ev_8ba3cab42fdf2a353252f24f47c6c0a8cb51360185c0995c501510b51bb8111e`，内部 inventory `ev_49b3f997a23308212e8af6b6c612aba80deaf51a110c7c718fd40615e69fe8c5`。没有重跑 app 大扫描。
- 实际调用 REA `inspect_analysis_view` 读取上述 Evidence 中 12 个精确资源路径，0.292 秒，Evidence `ev_a17785b773b1ea5b1237fe0fc45e38a15d836e36985df0668f68adcae5d8d66a`。全部 12 个本轮来源文件重新 SHA-256 核对，与原 inventory 逐一相符。
- 新的精确 native 问题为 `lvve::DraftQuery::get_adjust_materials(MaterialPictureAdjust const&, bool)`，nm 地址 `0x16e224c`，REA/Ghidra `analyze_function` 13.791 秒，Evidence `ev_ddd00fbeb5c3bd8a0d579f4aaa2672d87b9b6ec1674daccbfff9cc562d8abc25`。观察到固定 17 项材料查询与非空筛选，最后按开关及非空路径选入 LUT。它是材料枚举，不是像素算法或执行顺序证明；4 个未解析调用令 callee coverage 为 partial。
- 沿用 REA 6.7.0、Ghidra 12.1.4、Java 23 与定向 seed/1G profile。首次 seed 漏写 `function` 列，REA 明确拒绝配置，随后修正输入成功；未把拒绝当成完成。一次对资源目录直接 `inspect-artifact` 也被明确拒绝：该 route 接受文件与 app bundle，不接受任意目录，故改用现有 inventory 的精确视图，没有重复重试。
- 已 `export_evidence_bundle`，随后 `close_binary` 成功生成 1,381,654 字节 snapshot（1 个 primitive binding、1 条 native Evidence），再写 STOP 关闭 helper。全部新原始结果、哈希、伪代码和数学 probe 留在 ignored `artifacts/rea/effects-next/`。未读巨型旧 snapshot 或宣称恢复全部媒体算法。

## 对比度的独立数学描述

输入通道为 x∈[0,1]，归一强度 i∈[-1,1]，pivot q=0.435。合并资源按 abs(i)>1e-5 启用。

先求 k：i≤0 时 k=1+0.4i，否则 k=1+0.6i。

k≤1 时，输出为 clamp(k(x−q)+q,0,1)。因此降低对比度会抬黑压白，并保留 q。

k>1 时：

1. a=exp(8.33k−12.16)+5.82k−1.72。
2. s(x)=1/(1+exp(−a(x−q)))；g(x)=s(x)+q−0.5；d(x)=a·s(x)·(1−s(x))；dp=a/4。
3. x≤q 选 e=0，其他选 e=1。
4. 输出 clamp(g(x)+((dp−d(x))/(dp−d(e)))²·(e−g(e)),0,1)。

正对比度固定两个端点与 pivot，不能换成简单乘法、普通 sigmoid 或只做末尾 clamp。当前 shader 没有在此阶段引入编码 RGB→线性 RGB 的转换。最终颜色空间仍须由解码/整条管线的证据决定。

本轮独立数学 probe 使用 201 档强度 × 4097 个通道样本，全部有限且单调，pivot 最大误差 5.55e-17，正对比度端点误差 0。该结果只验证候选函数自身，不是目标渲染验收。probe 同时留下 i=-1/-0.5/-0.01/0/0.00002/0.5/1 的 12 档灰阶值，位于 `contrast-candidate.json`。

相关来源：

| 文件（DefaultAdjustBundle 下） | SHA-256 |
| --- | --- |
| contrast_v3/AmazingFeature/lua/SeekModeScript.lua | 4da9a3585a34ffba0201269a5eeafe89796732b0b51aa3aefea5e12c9b7867a6 |
| contrast_v3/AmazingFeature/prefabs/FliterEntity-2FFE6ABD/fshader.frag | 15e60b5f5c782eb8cce86f1c20c4fdc82de5cd7fef5e0c9fb0853fb762e9b30e |
| combine_adjust/AmazingFeature/lua/SeekModeScript.lua | ed1a057851bd63405131ec5dfbeb9a21c750ae350ea4299d4e09f73da50b6be2 |
| combine_adjust/AmazingFeature/xshader/colorAdjust.frag | 4bcf0f7dfc88360f9273a778d41f5fe5cfd89c3253c6906878fe5591b6508ee7 |

## 温度、色调与锐化边界

温度强度 t 对应候选开尔文 T=6500−1970t+876t²−2630t³，t=-1/0/1 为11976/6500/2776K。色调强度 j 先乘100。Lua 以倒色温和色调偏移查黑体色度表，得到白点，使用 Bradford 类型的适应矩阵及 RGB/XYZ 矩阵生成 3×3 变换，最终逐 RGB dot 并 clamp，alpha 保留。基准6500K/零色调显式走单位矩阵。

独立 `temperature_tone_v3` 的事件 key 是 `temperature_intensity` 与 **tone_intensity**；合并 `combine_adjust` 则是 `temperature_intensity` 与 **tint_intensity**。这是实际桥接差异，不能用字符串相似度自动归并草稿 subtype。独立包 config 声明 type=AmazingFeature、zorder=8011；contrast_v3 和 sharpen_v1 都声明 zorder=999。声明不能据此推断合并栈的全局执行顺序。

锐化 v1 的归一强度映射 sharpness=1.6i。每个像素以 3×3 邻域计算亮度（0.299/0.587/0.114），构造水平、垂直、两条对角线的二阶差分；按最大绝对差分及 0.01 容差，按固定优先顺序选一个方向，以亮度增量锐化后转回 RGB，clamp 并保留中心 alpha。正负差分另乘 white_gam/black_gam。材质是序列化容器，本轮未完成完整字段解码，因此不能仅由可打印字段名就认定这两个运行 uniform 的默认值。纹理边界采样、缩放前后、源分辨率与 u_ScreenParams 的运行关联也待验。

## 本机转场缓存的有界库存

只读扫描 `/Users/tal/Movies/JianyingPro/User Data/Cache/effect`，当时返回7,211个文件、227个 config.json、8个 extra.json。检查配置文本和全部 extra.json 后，仅以下两条具有 `transition` 声明：

| 效果ID / 缓存子路径 | defaultDura | isOverlap |
| --- | --- | --- |
| 322577 / 2d641adc4bb63e37e3a0067d8c8cc3c3 | 0.5 | true |
| 321493 / 3bca53e9f3dfa2c184fbee96438ea097 | 0.5 | false |

两者与此前叠化/闪黑原生草稿实际路径相符。缓存中现有 Lua/shader 可读，但本次没有执行它们或复制入产品。此前库存为7,025个文件；缓存会随原生操作变化，本轮统计是时间点观察，未声称获得整个缓存的原子快照或素材商店完整目录。其余命名转场尚无本地声明证据；不能把“本轮未找到”写为“应用不存在”。更不能用同一叠化公式冒充全部商店转场。

## 原生实验建议与剩余问题

建议由固定2秒色卡分别取对比度0、±25、±50，保存每一步原草稿和 native 导出；确认 subtype、version、effect path、value 与 slider 的关系。另做 brightness+contrast+saturation 组合，验证 clamp 和顺序，保留灰阶黑白端点及彩色色块。CPU 浮点公式/LUT误差、GPU buffer、native最终编码误差分开统计。

温度/色调分别0、±50，再做一组非零组合，优先核对 tone/tint 的桥接与 RGB 矩阵。锐化必须改用带边缘、细线和透明边界的编号素材，确认边界、采样半径、运行增益及与缩放的顺序。单一平色色卡无法验证锐化。

当前对比度方程、温度参数候选、空间锐化的静态结构已回答；当前资源代际选择、温度完整独立数学实现、锐化材质及运行采样、完整转场目录与画面一致性仍待原生证据。完整1:1未完成。
