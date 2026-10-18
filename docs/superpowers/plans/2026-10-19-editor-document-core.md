# Editor Document Core Implementation Plan

> 执行方式：用户已明确授权开始实现，在当前会话逐任务执行、验证并记录结果。原计划模板引用的superpowers执行技能未安装；执行本项目不以该插件为前提，不派发子代理。

**Goal:** 实现可独立运行的精确时间、六份剪映草稿只读导入、分割/恒速/历史与语义回归工具。

**Architecture:** 核心为不依赖UI的TypeScript包，目标草稿通过适配器进入内部工程；原始来源与未知内容独立保存。CLI回放同一操作序列，以区间投影对照真实草稿，不要求内部随机ID或冗余素材表一致。

**Tech Stack:** Node.js 24+、TypeScript可擦除类型、Node内置test/assert/crypto/fs；本实施包不安装Vue或UI依赖。最终界面为Vue 3＋TypeScript＋Ant Design Vue。

**Spec:** `docs/plans/2026-10-19-editor-design.md`；完整范围见 `docs/parity/功能与操作对照清单.md`。

## Global Constraints

- 本机剪映专业版5.9.0是固定行为对照版本，不升级目标程序。
- 当前仓库独立开发，不改映序旧时间线、数据库、.yg包、媒体和生产任务。
- 工程时间使用可序列化的有理数，不能固定24fps，也不能用浮点秒累计剪辑位置。
- 未知字段及效果必须保留原始副本，未解析的关键帧时钟不能猜成局部时间。
- 自行实现的时间映射规则与「已经证明与剪映一致」分开记录。
- 当前只有30fps、恒速与六份草稿证据，不宣称曲线、字体、画面或实时性能通过。
- 原始基线只读；其路径与SHA256以 `docs/parity/baseline.json` 为准。

---

## 文件职责与接口

所有路径相对本仓库。生产代码在执行本计划时创建，本计划本身不等于已实现。

| 文件 | 责任 |
| --- | --- |
| package.json | Node版本、test与replay命令；无运行依赖 |
| packages/core/src/time.ts | 有理数运算、十进制与微秒转换 |
| packages/core/src/document.ts | 文档类型、结构检查和区间投影 |
| packages/core/src/commands.ts | 纯分割与恒速变换 |
| packages/core/src/session.ts | 修订号与撤销重做事务 |
| packages/jianying/src/import.ts | 只读导入、原始副本与诊断 |
| scripts/replay-baseline.ts | 验证证据哈希、对照与退出码 |
| test/time.test.ts | NTSC、微秒与非法输入 |
| test/import.test.ts | 六份快照、保真与结构拒绝 |
| test/commands.test.ts | 跨倍速分割、不重叠与失败原子性 |
| test/session.test.ts | 版本冲突、撤销分支与不可变快照 |
| test/replay.test.ts | 实际CLI与篡改输入失败 |

数据契约：

```ts
export type Rational = {numerator: string; denominator: string};
export type Range = {start: Rational; duration: Rational};
export type Asset = {id: string; path: string; duration: Rational};
export type Clip = {
  id: string; materialId: string; source: Range; target: Range;
  speed: Rational; editableTiming: boolean;
};
export type Track = {id: string; kind: 'video'; clips: Clip[]};
export type Document = {
  schemaVersion: 1;
  canvas: {width: number; height: number};
  fps: Rational; assets: Asset[]; tracks: Track[];
};
export type Diagnostic = {code: string; trackId?: string; clipId?: string};
export type Imported = {
  document: Document;
  provenance: {raw: unknown; sha256: string};
  diagnostics: Diagnostic[];
};
```

首包只接受已验证的video核心结构；其他轨道结构以 `UNSUPPORTED_CORE_STRUCTURE` 拒绝整个导入，不生成丢轨的半工程。视频片段效果保持在provenance中；诊断不代表可以正确渲染效果。支持其他结构时新增适配与回归，不放宽断言来掩盖差异。

## Task 1: 精确时间运算与运行入口

**Files:** Create `package.json`, `packages/core/src/time.ts`, `test/time.test.ts`。

**Interfaces:** Produces `rational(n,d=1)`, `decimal(text)`, `micros(integer)`, `add/sub/mul/div(a,b)`, `compare(a,b)`；均返回规范化Rational，compare返回-1/0/1。JSON不含BigInt。

- [x] Step 1: 创建入口与失败用例，运行 `node --test test/time.test.ts`，确认因模块缺失失败。

```json
{
  "name": "@yingxu/editor-core",
  "private": true,
  "type": "module",
  "engines": {"node": ">=24"},
  "scripts": {
    "test": "node --test test/*.test.ts",
    "replay": "node scripts/replay-baseline.ts"
  }
}
```

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {rational, decimal, micros, add, mul, div} from '../packages/core/src/time.ts';

test('NTSC frame duration survives an exact round trip', () => {
  const fps = rational(30000, 1001);
  assert.deepEqual(mul(div(rational(1), fps), rational(30000)), rational(1001));
  assert.deepEqual(add(micros(33333), micros(1)), rational(16667, 500000));
});
test('decimal speed is exact and invalid values fail', () => {
  assert.deepEqual(decimal('1.3'), rational(13, 10));
  assert.deepEqual(decimal('1e-3'), rational(1, 1000));
  assert.throws(() => rational(1, 0));
  assert.throws(() => decimal('Infinity'));
  assert.throws(() => micros(0.5));
  assert.throws(() => micros(Number.MAX_SAFE_INTEGER + 1));
});
```

- [x] Step 2: 实现精确运算；对number入参先检查安全整数，禁止在丢失精度后才转BigInt。

```ts
export type Rational = {numerator: string; denominator: string};
type Integer = string | bigint | number;
function integer(v: Integer): bigint {
  if (typeof v === 'number' && !Number.isSafeInteger(v)) throw Error('INVALID_INTEGER');
  return BigInt(v);
}
export function rational(n: Integer, d: Integer = 1): Rational {
  let a = integer(n), b = integer(d);
  if (b === 0n) throw Error('ZERO_DENOMINATOR');
  if (b < 0n) { a = -a; b = -b; }
  let x = a < 0n ? -a : a, y = b;
  while (y) { const next = x % y; x = y; y = next; }
  return {numerator: String(a / x), denominator: String(b / x)};
}
export function decimal(text: string): Rational {
  const m = /^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!m) throw Error('INVALID_DECIMAL');
  const exp = Number(m[4] || 0) - (m[3]?.length || 0);
  if (!Number.isSafeInteger(exp) || Math.abs(exp) > 1000) throw Error('DECIMAL_LIMIT');
  const n = BigInt((m[1] === '-' ? '-' : '') + m[2] + (m[3] || ''));
  return exp >= 0 ? rational(n * 10n ** BigInt(exp)) : rational(n, 10n ** BigInt(-exp));
}
export const micros = (v: number) => rational(integer(v), 1000000n);
export function add(a: Rational, b: Rational): Rational {
  return rational(BigInt(a.numerator) * BigInt(b.denominator) +
    BigInt(b.numerator) * BigInt(a.denominator), BigInt(a.denominator) * BigInt(b.denominator));
}
export const sub = (a: Rational, b: Rational) => add(a, rational(-BigInt(b.numerator), b.denominator));
export const mul = (a: Rational, b: Rational) =>
  rational(BigInt(a.numerator) * BigInt(b.numerator), BigInt(a.denominator) * BigInt(b.denominator));
export const div = (a: Rational, b: Rational) =>
  rational(BigInt(a.numerator) * BigInt(b.denominator), BigInt(a.denominator) * BigInt(b.numerator));
export function compare(a: Rational, b: Rational): -1 | 0 | 1 {
  const n = BigInt(sub(a, b).numerator);
  return n < 0n ? -1 : n > 0n ? 1 : 0;
}
```

- [x] Step 3: 运行本文件测试，检查约分、零和负分母；成功后提交 `feat: add exact editor time arithmetic`。

## Task 2: 文档、只读导入与诊断

**Files:** Create `packages/core/src/document.ts`, `packages/jianying/src/import.ts`, `test/import.test.ts`。

**Interfaces:** Consumes Task 1；produces `importJianying(raw): Imported`, `validateDocument(doc): void`, `projectTiming(doc): unknown[]`。

- [x] Step 1: 为六份快照建立只读集成用例。读取路径从 `docs/parity/baseline.json` 获取，不从用户草稿目录扫描。

```ts
test('two-times speed keeps source range while shortening target', () => {
  const result = importJianying(readSnapshot('03-second-clip-2x.json'));
  const clips = result.document.tracks[0].clips;
  assert.deepEqual(clips[1].source, {start: rational(3), duration: rational(3)});
  assert.deepEqual(clips[1].target, {start: rational(3), duration: rational(3, 2)});
  assert.deepEqual(clips[1].speed, rational(2));
});
test('unknown keyframe clocks stay raw and cannot be edited as known timing', () => {
  const raw = readSnapshot('05-scale-keyframes.json');
  const result = importJianying(raw);
  assert.deepEqual(result.provenance.raw, raw);
  assert(result.diagnostics.some(d => d.code === 'KEYFRAME_CLOCK_UNRESOLVED'));
  assert.equal(result.document.tracks[0].clips[1].editableTiming, false);
});
```

`readSnapshot(name)`在test/import.test.ts中定义：读取baseline.json的 `snapshotDirectory`，用仓库根解析后再读取指定basename；只允许登记的六个文件名。测试前后对实际文件做SHA256比对，确认导入没有写回。

- [x] Step 2: 在document.ts定义上面的数据契约与校验。严格检查：schemaVersion为1；画布为正安全整数；fps大于0；资产/轨道/片段ID全局各自唯一；轨道kind为video；素材引用存在；时间有理数规范化；起点非负、时长正；speed正；恒速片段满足 `target.duration * speed === source.duration`；源结束不超过素材时长。空工程允许零轨零素材。

区间投影实现如下，用轨道顺序和片段顺序比较；刻意去掉随机ID和目标冗余素材表，但不省略速度、源时间或目标时间：

```ts
export function projectTiming(doc: Document): unknown[] {
  validateDocument(doc);
  return doc.tracks.map(t => ({kind: t.kind, clips: t.clips.map(c => ({
    source: c.source, target: c.target, speed: c.speed
  }))}));
}
```

- [x] Step 3: 在import.ts将JSON按如下精确映射读取。数字检查使用 `typeof value === 'number' && Number.isFinite(value)`；微秒另要求安全整数。对象和数组均先检查类型，不通过强制类型断言跳过运行时检查。

```ts
const mapping = {
  canvas: 'canvas_config.width / canvas_config.height',
  fps: 'decimal(String(raw.fps))',
  assetId: 'materials.videos[].id',
  assetPath: 'materials.videos[].path',
  assetDuration: 'micros(material.duration)',
  clipId: 'tracks[].segments[].id',
  materialId: 'segment.material_id',
  source: 'micros(source_timerange.start / duration)',
  target: 'micros(target_timerange.start / duration)',
  speed: 'decimal(String(segment.speed))'
};
```

创建provenance时执行 `structuredClone(raw)` 并对原始输入JSON文本计算SHA256。接口增加可选 `sourceText?: string` 参数；文件导入传入原始文本，内存导入用 `JSON.stringify(raw)`。函数不得打开素材文件或写草稿。

恒速与关键帧以外的视觉字段只保留原始值，产生 `VISUAL_SEMANTICS_NOT_INTERPRETED` 诊断；即使轨道投影通过也不宣称渲染兼容。片段有非空common_keyframes则设editableTiming=false并产生 `KEYFRAME_CLOCK_UNRESOLVED`。关联speed材料存在非空curve_speed时设editableTiming=false并产生 `CURVE_SPEED_UNSUPPORTED`。不能证明恒速关系时拒绝规范化，保留调用方原始文件；不伪造目标时长使校验通过。

稳定拒绝码：`INVALID_JSON_STRUCTURE`、`INVALID_TIME`、`DUPLICATE_ID`、`MISSING_MATERIAL`、`SOURCE_RANGE_EXCEEDED`、`UNSUPPORTED_CORE_STRUCTURE`。错误包含对象ID或字段路径，不输出完整用户草稿。

- [x] Step 4: 增加负时长、重复ID、缺素材、0速度、非有限fps、未知轨道拒绝用例；增加原始未知字段和两组关键帧深比较。运行import/time测试，通过后提交 `feat: import verified draft timing without losing provenance`。

## Task 3: 分割与恒速纯命令

**Files:** Create `packages/core/src/commands.ts`, `test/commands.test.ts`。

**Interfaces:** Consumes Document、精确时间与validateDocument；produces `applyCommand(doc, command): Document`。

```ts
export type Command =
  | {type: 'split'; clipId: string; at: Rational; rightId: string}
  | {type: 'speed'; clipId: string; value: Rational; shiftFollowing: boolean};
```

- [x] Step 1: 添加目标快照对照测试，先确认缺模块失败。

```ts
const one = importJianying(readSnapshot('01-single-video.json')).document;
const split = applyCommand(one, {
  type: 'split', clipId: one.tracks[0].clips[0].id,
  at: rational(3), rightId: 'replay-right'
});
assert.deepEqual(projectTiming(split), projectTiming(
  importJianying(readSnapshot('02-split-at-3s.json')).document));
const fast = applyCommand(split, {
  type: 'speed', clipId: 'replay-right', value: rational(2), shiftFollowing: false
});
assert.deepEqual(projectTiming(fast), projectTiming(
  importJianying(readSnapshot('03-second-clip-2x.json')).document));
assert.deepEqual(one, importJianying(readSnapshot('01-single-video.json')).document);
```

- [x] Step 2: 输入先validate，structuredClone后修改，最后再validate再返回。找不到片段拒绝 `CLIP_NOT_FOUND`；editableTiming=false拒绝 `TIMING_NOT_INTERPRETED`；右ID已存在拒绝 `DUPLICATE_ID`；边界分割拒绝 `SPLIT_OUTSIDE_CLIP`。所有失败不改变调用方对象。

分割计算必须使用以下精确等式：

```ts
const leftTargetDuration = sub(command.at, clip.target.start);
const leftSourceDuration = mul(leftTargetDuration, clip.speed);
const rightSourceStart = add(clip.source.start, leftSourceDuration);
const rightSourceDuration = sub(clip.source.duration, leftSourceDuration);
const rightTargetDuration = sub(clip.target.duration, leftTargetDuration);
// 左段保留clip.id与素材引用；右段用rightId，target.start=at。
// 四个duration都必须大于0，左右源/目标区间必须精确相接。
```

恒速计算如下；shiftFollowing显式给出，不给默认值。仅移动同轨中起点大于等于原片段结束的片段；若影响未解释时钟的片段则整次拒绝。

```ts
const oldEnd = add(clip.target.start, clip.target.duration);
const newDuration = div(clip.source.duration, command.value);
const delta = sub(newDuration, clip.target.duration);
clip.speed = command.value;
clip.target.duration = newDuration;
if (command.shiftFollowing) {
  for (const next of track.clips) {
    if (next.id !== clip.id && compare(next.target.start, oldEnd) >= 0) {
      if (!next.editableTiming) throw Error('TIMING_NOT_INTERPRETED');
      next.target.start = add(next.target.start, delta);
    }
  }
}
```

shiftFollowing是内核显式策略，尚未证明哪一种对应剪映默认。发生交叠时不猜测删除/覆盖行为；首包拒绝 `OVERLAP_POLICY_UNRESOLVED`，保持输入不变。

- [x] Step 3: 增加源入点10秒、源长6秒、二倍速片段的中点分割测试，预期源左10—13秒、右13—16秒；增加1.3倍精确时长、三段显式涟漪与不联动、边界分割和ID重复失败测试。通过后提交 `feat: add exact split and constant-speed commands`。

## Task 4: 修订号、撤销与重做

**Files:** Create `packages/core/src/session.ts`, `test/session.test.ts`。

**Interfaces:** Produces `createSession(doc): Session`；session提供 `snapshot()`, `execute(expectedRevision, command)`, `undo(expectedRevision)`, `redo(expectedRevision)`。snapshot返回 `{revision, document, canUndo, canRedo}` 的深副本。

- [x] Step 1: 编写历史测试：从分割快照开始，变速、撤销、重做，分别与02/04/03快照的projectTiming对照；撤销后Document必须深等于变速前。旧revision、修改snapshot对象及失败命令不得改变当前状态。

```ts
const session = createSession(split);
session.execute(0, {type: 'speed', clipId: 'replay-right', value: rational(2), shiftFollowing: false});
session.undo(1);
assert.deepEqual(session.snapshot().document, split);
assert.equal(session.snapshot().revision, 2);
assert.throws(() => session.redo(1), /REVISION_CONFLICT/);
session.redo(2);
assert.deepEqual(projectTiming(session.snapshot().document), projectTiming(fast));
```

- [x] Step 2: 实现事务：先核对revision再计算候选；候选validate通过后，才将旧文档入past、清future并递增revision。undo/redo先检查栈非空，成功后也递增revision；不回退revision。snapshot每次structuredClone，不能暴露栈引用。

```ts
function requireRevision(expected: number, actual: number): void {
  if (expected !== actual) throw Error('REVISION_CONFLICT');
}
// execute的提交顺序：
// requireRevision → applyCommand → validateDocument → push past →
// replace current → clear future → increment revision → return snapshot。
// undo无past抛NO_UNDO；redo无future抛NO_REDO；失败时所有栈保持不变。
```

首包只实现内存会话，不承诺自动保存或崩溃恢复；持久日志由后续工程任务实现并单独验证。历史容量不沿用映序旧实现的30次上限；首包测试有界输入，不虚报无限历史的性能。

- [x] Step 3: 增加撤销后新分支清空redo、连续两次undo、空历史拒绝和失败后的栈完整性。运行core/import测试，通过后提交 `feat: add revision-checked editing history`。

## Task 5: 真实基线回放与机器报告

**Files:** Create `scripts/replay-baseline.ts`, `test/replay.test.ts`；Modify `README.md`。

**Interfaces:** 消费上述全部模块，读取baseline.json；输出JSON `{baselineVersion, checks, diagnostics, limitations}`。默认写stdout；`--output <path>`仅写调用方指定的新报告文件，已存在则拒绝。退出0表示本包测试通过，2表示输入/参数拒绝，3表示对照失败。

- [x] Step 1: 进程集成测试使用 `spawnSync(process.execPath, ['scripts/replay-baseline.ts'])`。检查stdout为JSON，且包含以下真实比较项；篡改一份临时快照后使用 `--baseline-root <temporaryDirectory>`，必须因哈希不匹配退出2。默认路径从脚本URL定位仓库根，不依赖shell当前目录。

```ts
const requiredChecks = [
  'baseline-hashes', 'empty-draft', 'single-six-seconds', 'split-at-three',
  'second-clip-two-times', 'undo-equals-split', 'redo-equals-speed',
  'keyframes-preserved-uninterpreted', 'input-files-unchanged'
];
```

- [x] Step 2: 按下列顺序实现回放。使用 `createHash('sha256').update(bytes).digest('hex')` 校验，不在脚本中更新期望哈希。

```ts
// 1. 校验baseline.json登记的六份快照哈希，读取为原始bytes+JSON。
// 2. 导入00—05；确认00空轨、01源目标均为6秒。
// 3. 从01执行三秒分割，与02的projectTiming深比较。
// 4. 再改右段二倍速，与03深比较；undo与04、02深比较；redo与03比较。
// 5. 05只检查provenance深等、关键帧诊断存在和editableTiming=false。
// 6. 重新读取六个文件校验哈希；汇总checks。
// 7. 报告明确不包含视觉、声音、实时性能、曲线或关键帧渲染的通过结论。
```

- [x] Step 3: 运行 `node --test test/*.test.ts` 与 `node scripts/replay-baseline.ts --output artifacts/core-baseline.json`。README记录实际Node命令、通过范围和仍未实现项。提交 `test: replay verified Jianying timing baseline`。

## 自审与首包交付

- [ ] 数据契约与任务中函数名、Rational字段名保持一致；Time从Task 1统一导入。
- [ ] 上述全部文件都已创建，且无未定义helper；测试readSnapshot按Task 2说明实际定义。
- [ ] 所有错误码在对应实现与负用例一致，原始来源与工程内容分开保存。
- [ ] 任何曲线/关键帧测试都不把保留原文写成渲染通过。
- [ ] 基线文件哈希不变；`git -C ../../视频生产平台 status --short`确认没有本次产品改动。
- [ ] 全部首包检查通过后更新功能登记册中对应行的实现证据，其余行保留未开始。

2026-10-19：上述五个任务已实现并实际运行。核心回放九项通过；界面、持久化与媒体引擎在独立后续包中继续扩展，具体测试范围以QA记录为准。
