# REA：温度与色调的完整数学候选

2026-10-19，固定本机剪映专业版 5.9.0。这是后续静态分析与独立数学实现，尚未连接产品的导入、UI、GPU 或导出。第一阶段为静态分析；随后完成了有限原生对照，见 [原生实验报告](2026-10-19-native-temperature.md)。没有下载素材、修改 REA 配置或安装依赖。

## 已回答与未回答

已完整恢复两个已安装资源的强度映射、31 行白点查表、插值、色调偏移、四个矩阵和乘序。独立 `temperature_tone_v3` 与 `combine_adjust` 的全部 124 个表格数值和 36 个矩阵数值相同。候选实现为 `packages/core/src/color-temperature.ts`，严格接受有限的归一强度 [-1,1] 与 RGB [0,1]，没有复制目标 Lua/shader 程序。

后续原生实验确认当前 UI 草稿使用 `combine_adjust`、温度 `type=temperature`、色调 **`type=tone`**、`version=v3`，UI ±50 对应 value ±1。独立 H264 编码链在18个色块的有限对照内最大灰阶4、彩色3 LSB，不能宣称全画面逐像素一致；原生实际运行精度与完整产品链仍有未知。没有把内部 `hue` getter 仅凭名称当作草稿字段。温度与色调仍不能列为已交付功能。

## 本轮实际 REA 调用

- 目标薄 arm64 库 SHA-256 为 `be0dd5c522e2b0511202cfa2bd27dc7075b3e5ab7cea820bef4c2664d80afe81`，复用既有固定目标、REA 6.7.0、Ghidra 12.1.4、Java 23，不重新扫描整 app。
- 新的原生问题是 `lvve::DraftQuery::get_material(shared_ptr<MaterialPictureAdjust> const&, LVVEMetaType)`，nm 原地址 `0x16e1fec`。`analyze_function` 耗时 11.886 秒，Evidence `ev_f244b391f3d1d755a6fd5c84144896be1e06533cd2e6ceb820e187c0fc766c04`，函数体完整范围 `0x16e1fec–0x16e20f7`，268 字节。种子名称 `get_adjust_material_by_type` 是调用者标签，不冒称原始符号恢复。
- 观察到 20 个枚举分支；其中 0x1b 调用 0x70d754，0x1c 调用 0x70d830。后两地址分别与同一库已保存 nm 表中的 `get_color_temperature()`、`get_hue()` 对齐。它们证明两个材料槽的选择，不能证明 event key、UI 标签或像素算法。20 个 callee 尚无 Ghidra containing procedure，因此关系覆盖按 REA 原结果保留 partial。
- `inspect_analysis_view` 对旧 app inventory 取两个包的 5 个精确资源，耗时 0.370 秒，Evidence `ev_b26edd6aafe7f4d23a5d913910bb3bcc831b16380e947bc802c9705b66daeca6`。保留原 inventory Evidence `ev_8ba3cab42fdf2a353252f24f47c6c0a8cb51360185c0995c501510b51bb8111e` 与内部 `ev_49b3f997a23308212e8af6b6c612aba80deaf51a110c7c718fd40615e69fe8c5`。当前 5 文件逐一重算 SHA-256，与 inventory 的 artifact digest 全部相同。
- 已导出 evidence bundle、成功 `close_binary` 生成 525,654 字节 snapshot，写 STOP 关闭本次 helper。没有重复已有 `get_adjust_materials` 分析。原始结果、numeric corroboration、oracle 与数学 probe 在 ignored `artifacts/rea/temperature-next/`。

| DefaultAdjustBundle 下的文件 | SHA-256 |
| --- | --- |
| temperature_tone_v3/AmazingFeature/lua/Lscript.lua | d4d3cabfbf84a7d541afbe59b6792ee4a933c156fca57d60f765bd1fd731f477 |
| temperature_tone_v3/AmazingFeature/xshader/quad.frag | 02bb3c8b6ef9a5fc5624e20949395aebace1c1fa6322c6d07a5ecfc385e732fd |
| temperature_tone_v3/config.json | 141264050c93c18bc540c07de0417e6d41d6e55e94b31bb793c549691a0501ac |
| combine_adjust/AmazingFeature/lua/SeekModeScript.lua | ed1a057851bd63405131ec5dfbeb9a21c750ae350ea4299d4e09f73da50b6be2 |
| combine_adjust/AmazingFeature/xshader/colorAdjust.frag | 4bcf0f7dfc88360f9273a778d41f5fe5cfd89c3253c6906878fe5591b6508ee7 |

## 独立数学说明

归一温度 t 对应 K=6500−1970t+876t²−2630t³。t=-1、0、1 分别为 11976、6500、2776K，倒色温 r=10⁶/K 的范围为 83.500334–360.230548。归一色调 j 对应色度平面偏移 j/100。独立包接收 `temperature_intensity` 与 `tone_intensity`；合并包接收 `temperature_intensity` 与 **tint_intensity**。两处色调内部先乘100，再乘0.0001，最终都是 j/100。

资源表每行是倒色温 m、CIE 1960 u/v 与等温线斜率 s。选择相邻行 m₀≤r<m₁，令 w=(r−m₀)/(m₁−m₀)，线性插值 u/v。每行的单位方向是 (1,s)/√(1+s²)；先插值两个单位方向，再将插值结果归一化，乘 j/100 加到 u/v。不能直接插值斜率或只沿 v 方向加偏移。

令 d=2+u−4v，x=1.5u/d，y=v/d，分别 clamp 到 [10⁻⁶,0.999999]。白点 XYZ 为 (x/y,1,(1−x−y)/y)。原资源在 x+y>0.999999 时还有除以 `0.999999/(x+y)` 的分支；候选如实保留，没有擅自修成常见归一化。201×201 强度采样中 x+y 范围为 0.546131–0.912338，该分支没有触发；采样不能替代连续域证明。

用 A 为 XYZ→cone、B 为观察到的截断 cone→XYZ、P 为 RGB→XYZ、Q 为 XYZ→RGB。记目标/6500K零色调白点经 A 变换后的分量比构成对角矩阵 D，则结果矩阵为 **Q·B·D·A·P**。每行与原 RGB 点乘，整体完成后 clamp，输入 alpha 保留。此阶段没有自动 RGB 线性化或 gamma 转换。

必须保留 B 的四位左右截断常数，不能自行计算 A 的精确逆矩阵。因为 B·A 并非精确单位矩阵，非零分支即使接近中性也有小偏差：50% 灰在 t=10⁻⁷、j=0 的数学结果约为 (0.4999651190,0.5000431235,0.4999936722)。精确中性则显式返回单位矩阵。合并包由 caller 以 abs(t)>10⁻⁵ 或 abs(j)>10⁻⁵ 启用；候选纯函数不隐藏这个 caller 策略，也不把小偏差平滑掉。

合并 shader 的实际 main 顺序是亮度→对比度→饱和度→高光→阴影→黑白→温度/色调→褪色→光感，并在各阶段 clamp。Lua 参数计算的排列顺序不能当作图像执行顺序。独立包 zorder=8011 的配置声明也不能覆盖当前运行栈的实测证据。

## 验证与实际限制

`node --test test/color-temperature.test.ts` 的 5 项通过：非法值与边界拒绝、精确中性与独立返回对象、白点/矩阵/8 组 RGB anchors、截断逆矩阵及 gamut clamp、201×201 全强度网格有限性。另使用 Python Decimal 80 位直接计算 RGB→XYZ→cone→gain→XYZ→RGB，避开候选的已组装矩阵乘法，留存 9 组独立数值 oracle。这是数学核对，不是原生输出或 GPU 验收。

数学 probe 另用每档 7 个 RGB 样本与模拟 float32 dot 比较，最大差为 1.262×10⁻⁷，即约 0.0000322 个 8 位 LSB；这不是实际 WebGL、纹理读回或 native 精度证明。当前矩阵系数采样范围约 [-0.215655,1.530351]，不能将矩阵元素自身 clamp 到 [0,1]。

候选文件通过单独 TypeScript 检查。共享项目 typecheck 曾在父任务并行加入有声曲线接口时报告 Preview.vue 的 `curveAudio` 选项尚未进入 GpuPreviewOptions；没有据此修改其他任务文件，最终整体验证由主任务合并后重跑。

## 静态阶段提出的原生实验

以下是静态阶段的实验建议，随后完成的有限范围与实际结果见 [原生实验报告](2026-10-19-native-temperature.md)；没有因此把产品集成或全部运行情况标为完成。

用已固定两秒色卡，仅操作专用草稿，逐步保存未修改、温度±50、色调±50、温度+25/色调−25组合的原生草稿与实际导出。每一步核对 effect path、subtype、version、value、adjust_params 和 UI 值；不能把 name 相似当作 bridge。中性重置后应另存一次，确认单位矩阵分支。

还需一组亮度+温度或阴影+色调组合验证实际栈顺序；对照必须比较“原始导出→候选矩阵”与原生导出的同一色块，区分矩阵误差、RGB/YUV 编解码量化与颜色标签影响。near-zero 要在实际能输入的小数档位上测试，不能假定 UI 支持任意强度。完成上述证据前，不启用产品控件、导入草稿自动映射或对外声明 1:1。
