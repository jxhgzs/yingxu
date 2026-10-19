# Curve Speed Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. Those skills are unavailable in this workspace; execute inline under the already authorized architecture. Git commits belong to the coordinating parent agent.

**Goal:** Implement independently written pure curve-time functions from fixed 剪映 5.9.0 evidence, preserving raw media time separately from frame-quantized split time.

**Architecture:** A framework-free `curve-speed.ts` owns validation, point-clock conversion, piecewise linear velocity integration and its inverse. Existing Rational values enter and leave the native microsecond boundary explicitly. Document, commands, UI and render integration remain with the coordinating agent.

**Tech Stack:** TypeScript, existing Rational helpers, Node 24 `node:test`; no new dependency.

**Spec:** `docs/qa/rea-curve-followup.md`, parent-approved pure-function contract, and `evidence/2026-10-19-curve/` native operation records.

## Global Constraints

- Fixed target is local 剪映专业版 5.9.0; original app and previous evidence stay unchanged.
- Input has 2–100 points, normalized x from 0 to 1 strictly increasing after float32 conversion, finite y from 0.1 to 10.
- No proprietary pseudocode in source: express recovered facts as clear independent mathematical operations.
- Existing target duration is an explicit mapping argument; do not silently recompute it from source duration or metadata average.
- Media delta is rounded to integer microseconds; frame quantization is a separate operation and native fields truncate frame time to microseconds.
- REA static facts, independent mathematical replay and native media observations have separate evidence labels.

---

### Task 1: Curve mathematics and raw media-clock mapping

**Files:**
- Create: `packages/core/src/curve-speed.ts`
- Create: `test/curve-speed.test.ts`

**Interfaces:**

```ts
type SpeedCurve = {points: {x:number;y:number}[]};
curveAverageSpeed(curve:SpeedCurve):number;
curveDuration(curve:SpeedCurve,sourceDuration:Rational,fps:Rational):Rational;
curveSourceDelta(curve:SpeedCurve,sourceDuration:Rational,targetDuration:Rational,targetDelta:Rational):Rational;
curveTargetDelta(curve:SpeedCurve,sourceDuration:Rational,targetDuration:Rational,sourceDelta:Rational):Rational;
```

- [x] Add native fixture assertions: the custom peak curve has average `1.5223880801349878`; source `3s`, target `1966666us`, target delta `833333us` maps to `876935us`; a constant curve maps without a quadratic singularity.
- [x] Run `node --test test/curve-speed.test.ts`, confirming missing module failure before implementation.
- [x] Validate the input domain and float32 distinct x. Convert source x into sequence x using float32 cumulative `dx / ((y0+y1)/2)` followed by float32 normalization; compute average from float32 endpoint sums/differences accumulated as double.
- [x] Build the three linear velocity spans between each sequence anchor pair using constants `a=0.800000011920929`, `b=0.29510000348091125`, time controls `.5±b` and velocity controls `.5±a/2`.
- [x] Integrate each span as a quadratic area; invert via the stable root `2*area/(v0+sqrt(v0*v0+2*slope*area))`, falling back to `area/v0` for zero slope. Round returned native times to microseconds and bound query deltas without rescaling the mapping.
- [x] Run fixture tests plus sampled rising/falling/flat inverse round trips with a 2-microsecond tolerance; run `npm run typecheck`.

### Task 2: Split clocks and evidence-backed frame quantization

**Files:**
- Modify: `packages/core/src/curve-speed.ts`
- Modify: `test/curve-speed.test.ts`
- Update: `docs/qa/rea-curve-followup.md`

**Interfaces:**

```ts
splitSpeedCurve(curve:SpeedCurve,sourceDuration:Rational,targetDuration:Rational,targetDelta:Rational,fps:Rational):{
  left:SpeedCurve;right:SpeedCurve;
  sourceDelta:Rational;rawSourceDelta:Rational;targetDelta:Rational;
};
```

- [x] Verify floor versus nearest source-frame behavior. The second native split maps to 32.72079 source frames and returns 33; preserve this evidence and avoid inferring the rule from `26.308` alone.
- [x] Add the native non-node split assertions: raw `876935us`, float32 ratio `0.2923116683959961`, left inner x `.8552515244151108`, boundary y `1.3335384130477905`, and the observed frame-quantized source delta.
- [x] Generate left/right points from the raw ratio, insert the float32 cubic smoothstep boundary y, and only then quantize the returned source split time to the nearest frame. Preserve target duration explicitly in subsequent mapping calls.
- [x] Record the 59-frame native export replay and its microsecond boundary-resolution limitation in the QA report; do not claim broad media parity from this one curve.
- [x] Run `node --test test/curve-speed.test.ts` and `npm run typecheck`; send the exact interfaces, tests and remaining limits to the coordinating agent without committing Git.

Execution result: 5 focused tests and repository typecheck passed. Added `curveNearestFrame` and `curveVelocitySpans`; the latter exposes the same float32 model to media code with microsecond span boundaries. No Document/commands/render/app files changed by this worker and no Git commit created. The 800us alignment and non-30fps target behavior remain explicitly outside the verified evidence.
