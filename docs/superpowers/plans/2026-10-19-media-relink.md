# Media relink Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户明确选择已注册素材，将工程中某个媒体素材的全部引用原子地重新链接。

**Architecture:** 核心helper只操作文档，不读取文件；服务负责将客户端replacement强制替换为可信注册数据。Vue弹窗列出原素材、已上传候选和影响范围，预检成功后提交一次asset.relink命令。

**Tech Stack:** TypeScript、Vue 3、Ant Design Vue、Node 24。

**Spec:** `docs/plans/2026-10-19-editor-design.md` PR04、PR05、素材身份与注册媒体约束；固定目标5.9.0，尚无目标重链接操作证据。

## Global Constraints

- 不读取或执行导入工程的asset.path，不自动从旧路径寻找文件。
- 全部修改必须通过无diagnostics工程的单次原子命令；只读草稿不能绕过。
- 内核使用精确Rational时间；保留所有片段源/目标区间、速度、属性及动画。
- video/image为兼容画面素材组；audio独立，text不得重链接；短于任一源区间或动画点的素材拒绝。
- 受影响片段所在轨锁定或editableTiming=false时拒绝；失败时原工程不变。
- 本独立任务只新增relink模块、测试、弹窗、计划与QA，不修改已有共享文件，不提交Git。

### Task 1: 原子重新链接

**Files:** Create `packages/core/src/relink.ts`; Test `test/relink.test.ts`。

**Interfaces:**
```ts
applyAssetRelink(doc:Document,{assetId,replacement}:{assetId:string;replacement:Asset}):Document;
```

- [x] 写入多轨多引用、精确源区间与动画保持、旧asset删除、newid已存在复用、失败回滚测试。
- [x] 校验输入doc和replacement；替换ID已经存在时核对path/sha和媒体元数据，name标签允许不同。
- [x] 一次clone并改写全部materialId，不改区间/属性/关键帧；最后validateDocument后返回。
- [x] 拒绝不存在/文字/类型不兼容、锁定或未知映射、任一源区间/动画点超长、重复ID元数据冲突；无需读取任何path。

### Task 2: 显式选择与影响提示

**Files:** Create `apps/editor/src/components/RelinkDialog.vue`。

**Interfaces:** props `{c:EditorController;open:boolean}`，emit `update:open(boolean)`。

- [x] 列出工程非文字素材与已注册兼容候选，显示原/新素材名称、类型、时长、尺寸和哈希状态。
- [x] 上传通过c.upload并刷新c.assets；不自动确认替换。原哈希缺失或新哈希不同均允许用户明确提交，但提示会更新全部引用。
- [x] 根据helper预检禁用不合法提交；按钮受busy/readOnly保护，异步失败保留弹窗并显示错误。
- [x] 调用 `c.edit({type:'asset.relink',assetId,replacement})`，保存成功后关闭；App入口和服务sanitization由主执行者接入。

### Task 3: 验证与交付

**Files:** Create `docs/qa/2026-10-19-media-relink.md`。

- [x] 运行 `node --test test/relink.test.ts` 和 `npm run typecheck`，记录实际结果。
- [x] 说明核心测试与真实UI/原生导出边界；主执行者继续完成实际界面和持久撤销/重做验证。

## Execution

父任务授权独立并行模块；按已批准架构直接执行，不再请求启动确认。
# 同路径重复素材恢复

- [x] 真实曲线草稿因分割/复制产生6个素材ID但指向同一文件；增加显式“同时链接同一路径”选项，默认关闭。
- [x] 勾选后对全部同路径素材逐项预检，用一个batch修订提交；任一锁定/区间失败则全部拒绝，保留一次撤销粒度。
- [x] 实际UI导入曲线原始快照，勾选、预检、恢复并导出；不能直接信任草稿路径。
