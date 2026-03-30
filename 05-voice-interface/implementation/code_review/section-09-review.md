# Code Review: section-09-web-foundation

## CRITICAL

**`getMaterialForNodeType` returns `transparent: false` with `opacity: 0.9`** — Three.js ignores `opacity` when `transparent: false`. Node materials will render fully opaque at runtime. Fix: set `transparent: true`.

## HIGH

1. **`vi.mock('three')` in visuals.test.ts masks constraint violations** — The architecture mandates NO top-level `three` import in visuals.ts. If someone adds one later, tests still pass silently. The mock is dead code if the constraint holds. Let go — visuals.ts has no three import; the mock is harmless precaution.

2. **`tsc --noEmit` silently dropped from `npm test`** — Previous script was `tsc --noEmit && vitest run`. CI will no longer catch type errors. Fix: restore tsc check.

## MEDIUM

1. **`getEdgeOpacity` range test lower bound is 0.0 instead of spec-required 0.05** — An implementation returning 0.0 would pass. Fix: change `toBeGreaterThanOrEqual(0.0)` to `toBeGreaterThanOrEqual(0.05)`.

2. **Webview tests depend on environmentMatchGlobs with no safety net** — If files move outside `webview/`, they lose jsdom environment silently. Acceptable for now.

3. **`defaultMaterialConfig` missing `emissive` field, no test coverage** — Low risk, letting go.

## Decisions

- **Auto-fix**: CRITICAL (transparent: true), HIGH-2 (restore tsc in test script), MEDIUM-1 (fix test bound)
- **Let go**: HIGH-1, MEDIUM-2, MEDIUM-3, LOW items
