# Code Review Interview: section-04-scaffold

## Review Items Triaged

### Three.js import in webview/main.ts (Ask user)
**Finding:** Reviewer flagged the `import { WebGLRenderer }` + `window['DevNeuralRendererClass'] = WebGLRenderer` as a spec deviation — the plan stub has no imports, and Three.js bundling is a section-06 concern.

**Decision:** Keep the import and keep the test (user confirmed). The import is harmless and validates a real requirement. The stub is replaced in section-06 anyway.

### @types/three version mismatch (Ask user)
**Finding:** `@types/three@0.183.1` was 21 minor versions ahead of `three@0.162.0`. Reviewer flagged false typecheck confidence.

**User response:** "thoughts?" — discussed options: pin `@types/three` to `^0.162.0` (safe, minimal) vs upgrade `three` to `^0.183.0` to align.

**Decision:** Upgrade `three` to `^0.183.0` (user confirmed). Three.js 0.183.2 was installed. Both `three@0.183.2` and `@types/three@0.183.1` are now aligned at the same minor version.

### Auto-fix: production build test without try/finally
**Finding:** Restoration build not wrapped in try/finally — failure would leave dist/ in production state.

**Fix applied:** Wrapped `expect(prodTotal).toBeLessThan(devTotal)` in `try { } finally { execSync restore }` block.

### Auto-fix: vitest.config.ts missing for vscode mock alias
**Finding:** `src/__mocks__/vscode.ts` exists but vitest does not auto-use Jest-style `__mocks__` directories. Without a config alias, section-05 unit tests would attempt to import the real `vscode` module (throws in Node context).

**Fix applied:** Created `vitest.config.ts` with `alias: { vscode: 'src/__mocks__/vscode.ts' }`.

### Let go: getVsixEntries Windows-only PowerShell
Project runs on Windows; platform restriction is acceptable for now.

### Let go: no test for typecheck
Manual verification is sufficient; adding a test that shells out to tsc would be fragile.

### Let go: command injection risk in getVsixEntries
Test-only utility; path contains no user input at runtime.

## Final State
- 19/19 tests pass
- `npm run typecheck` clean
- `three@0.183.2` + `@types/three@0.183.1` aligned
- `vitest.config.ts` wires vscode mock for all future extension host tests
