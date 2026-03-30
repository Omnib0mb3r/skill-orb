# Code Review Interview: section-09-web-foundation

## Auto-fixes Applied

1. **CRITICAL — transparent: false with opacity: 0.9**: Changed `transparent: false` to `transparent: true` in `getMaterialForNodeType` return value. Three.js requires `transparent: true` to respect the `opacity` property.

2. **HIGH-2 — tsc --noEmit dropped from test script**: Restored `"test": "tsc --noEmit && vitest run"` in package.json.

3. **MEDIUM-1 — getEdgeOpacity test lower bound**: Changed `toBeGreaterThanOrEqual(0.0)` to `toBeGreaterThanOrEqual(0.05)` in the general range test to match the plan spec.

## Let Go

- **HIGH-1**: `vi.mock('three')` as dead precaution — harmless and defensive.
- **MEDIUM-2**: webview tests depend on environmentMatchGlobs — acceptable; files won't move.
- **MEDIUM-3, LOW items**: emissive field coverage, globals flip rationale — low risk.
