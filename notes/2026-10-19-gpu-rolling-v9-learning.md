# 0.9 GPU测试新增经验

按 continuous-learning 整理，仅记录根AGENTS现有0.9条目尚未包含的两条，供父任务合并，避免并行覆盖共享AGENTS。

- **同一输出帧的重同步会造成EOF重锚循环。** 看到buffer集中在179/30等末帧时，先按目标time聚类state，再核HTTP、rAF和source drift。已呈现输出帧不应每个屏幕刷新都重新prepare/seek/anchor；保留每rAF音频与onTime即可。不要直接扩大source-boundary hold，因为合法末源帧区间仍须播放声音。纯测试需先证实旧实现13次prepare/anchor，而修复仅1次且独立目标clock正常到duration。来源：v2真实180帧尾部buffer10—128次，v3 clock修复。
- **缓存微任务收尾、pin与取消都要以执行时身份为准。** 异步前台图片迟到时用实时current pin集合；内部operation和外部signal在第一次warm之前合并，旧warm不能启动新seek的prepare；producer完成决策到外置finally之间可丢latest窗口，所有权须在producer自身finally同一微任务内释放。测试精确插入4个Promise微任务可稳定复现旧roll漏帧，不能只用setTimeout模拟。来源：text-frame-cache / text-preparation三组先失败后通过的纯回归。
