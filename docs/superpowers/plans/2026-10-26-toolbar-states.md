# Toolbar States Implementation Plan

> **For agentic workers:** Inline execution; no delegation.

**Goal:** 用户指定的三个SVG图标及十项工具准确置灰。

**Architecture:** 共享纯命令预检、只读素材能力检查、Vue状态映射。

**Tech Stack:** Vue3/TypeScript、Node24、FFprobe、Electron。

- [ ] 重绘Icon.vue的split/cutLeft/cutRight实心轮廓；保持currentColor与禁用透明度。
- [ ] 新增core/tool-availability.ts，按实际命令校验时间工具、标记与变换；媒体结构校验提取共享，测试锁定/边界/类型/后续转场/未知时序/批次限制。
- [ ] 服务端增加只读媒体能力检查与有界签名缓存；UI等待时置灰，切换丢弃迟到结果，实际VFR/丢失文件检查。
- [ ] 类型构建、专项与全量回归、真实UI矩阵及功能检查；提交后打包0.11.1，保留当前工程重开、记录截图和差异。
