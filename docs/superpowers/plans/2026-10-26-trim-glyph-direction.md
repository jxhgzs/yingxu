# Trim Glyph Direction Implementation Plan

> **For agentic workers:** Inline execution; no delegation.

**Goal:** 按用户图二纠正三个裁切图标。

**Architecture:** Icon.vue局部SVG调整，保留功能、标签及disabled。

**Tech Stack:** Vue3、SVG、Electron。

- [ ] 将[|]误绘改为][结构，左/右虚线使用对应整半括号，缩为18px、2单位细线。
- [ ] 类型构建并在真实界面放大截图核对，装包0.11.2，正常重开保留当前工程并留截图。
