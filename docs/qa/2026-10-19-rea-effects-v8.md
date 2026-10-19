# REA v8：效果路径选择与待验证的基础调节

固定对照：本机剪映专业版 5.9.0，2026-10-19。接续 [v7](2026-10-19-rea-effects-v7.md)，本轮没有重复推导已有黑白场、褪色和锐化方程；新问题是实际资源路径是否无条件选择、不同暗角代际是否可混同。本报告目前仅包含静态证据，原生 UI 与真实导出由父任务独立保存。

## 新 REA 调用与范围

沿用已安装 REA、Ghidra 12.1.4、Java 23 和已固定 arm64 库，SHA-256 `be0dd5c522e2b0511202cfa2bd27dc7075b3e5ab7cea820bef4c2664d80afe81`。实际调用与 Evidence：

| 操作 | 地址/范围 | Evidence | 耗时 |
| --- | --- | --- | --- |
| analyze_function | getMergeAdjustColor，0xc278 | `ev_8f3330ab9216672055cb6490d6955bbc1c1fbcbbb875f3b83fc466d8a7774f04` | 15.595 秒 |
| analyze_function | updateMergeAdjustColor，0xc294 | `ev_dd649609ad0cb475dbb8609d82e33dabf1744385e9cbf0fa2a6bfcc77b24fe40` | 0.264 秒 |
| analyze_function | CreatePresetAdjust，0x16827d4 | `ev_b72f97809d7d2264146fe662527848688a8ced5693082f026a4efd134ad182dc` | 0.062 秒 |
| inspect_analysis_view | 旧 vignetting 的 12 个明确资源路径 | `ev_2f13dded6eb82b43502b6979d19af2c6f42600ca1f8be63174a131e42e6069a2` | 0.436 秒 |

最后一项复用匹配的原 app inventory，不重扫整 app；12/12、exhausted=true，逐一读取当前文件后 SHA 与原 manifest 全匹配。纯观测索引位于 `evidence/2026-10-19-effects-v8/`。完整函数、私有资源与调用记录仅在 ignored `artifacts/rea/effects-v8/`。会话已 export 完整 bundle、close 保存本轮 snapshot、STOP，helper 正常退出 0。

本次定向 seed 不同，尝试复用 v7 snapshot 返回 `profile_mismatch`，未将失败解释为分析引擎崩溃。按返回修复建议创建新 profile，没有覆盖旧 snapshot。另一次把普通资源目录交给 open_binary 被明确拒绝；随后针对原 app inventory 选择 12 个路径取得正确结果。失败后产生的库 inspect_artifact 结果没有用于证明暗角库存。

## 合并路径是条件配置

getMergeAdjustColor 是共享配置对象 getter，不能凭名字解释成返回当前开关布尔值。updateMergeAdjustColor 静态可见：先检查 platform/region 条件，再通过配置客户端读取 `use_new_settings`，在返回值存在时更新配置对象。

由此只能推出合并调节路径受配置影响，**无法从本轮静态代码确定实际用户当前开关、服务配置值或此次渲染采用哪个路径**。CreatePresetAdjust 负责解析和反序列化预设 JSON，不是据名称选择 GPU 算子的工厂。其原生调用关系仍有未解析的目标，不能将 dossier 当作完整运行链恢复。

合并资源明确的局部阶段顺序仍是：高光 → 阴影 → 黑白场 → 色温/色调 → 褪色 → 光感，各阶段 clamp。这里“明确”是资源静态事实，实际启用须结合草稿 path/version 和真实输出。黑白场事件分别为 `black_intensity`、`white_intensity`，限制 [-1,1]；褪色事件为 `fade_intensity`，合并实现限制 [0,1]，不能照搬独立旧资源的 abs 行为。

## 两个暗角不是同一算法

| 本机包内资源 | 静态观察 | 尚未知 |
| --- | --- | --- |
| vignetting，config 6.6.0 | 使用 `anjiao.png` 纹理；事件 key 为 `intensity`。纹理 RGBA 乘强度后，以乘法混合回原 RGB，alpha 取原图。 | 当前 UI 是否选择此代，纹理 sampler/UV、host 强度语义 |
| vignetting_v1，config 10.1.0 | v7 已记录的无纹理 Bezier＋径向 smoothstep 算子，正负分支不同。 | 当前 UI 是否选择此代，实际处理 UV 与输出 |

两个目录同时存在且数学不同。旧代不能用 v1 的 Bezier 结果冒充，v1 也不能直接套通用径向渐变。原生草稿必须保留材料的 path/version；只写“vignetting”不足以判定执行代际。

## 下一步的最小原生对照

1. 黑色 ±50、白色 ±50，在既有灰阶和彩色色卡中心测量，另加 black−50/white+50/temperature+50，区分参数映射和组合顺序。
2. 褪色 50 与 100，沿用既有 17 节点标量候选，区分强度、纹理插值及颜色转换，不复制私有纹理进产品。
3. 暗角 ±50/100，用纯中灰 1280×720，同时保存实际 path/version，测量中心、轴线、四角及中间半径。先确定代际再选择独立实现。

锐化还需真实边缘图证明采样尺寸、边界和 host 是否覆盖材质默认值；光感有跨通道 LUT 耦合；颗粒 seed/时间状态未闭合。本轮未把这些未知效果开放成看似可用的近似控件，也未宣称剩余特效完成 1:1。
