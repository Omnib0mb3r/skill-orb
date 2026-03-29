# Code Review: section-04-scaffold

## Correctness Against Spec

All required files are present and match the spec: package.json, tsconfig.json, esbuild.mjs, .vscodeignore, src/extension.ts, all webview stubs, src/__mocks__/vscode.ts, tests/manifest.test.ts, tests/build-smoke.test.ts. Manifest properties, activationEvents, commands, and scripts match the plan.

**Documented deviation — `import * as vscode` vs `import type * as vscode`:** The plan specifies `import type`. The implementation uses a value import. However esbuild still tree-shakes it since `vscode` is only used in type positions. The test was adapted to check for `module.exports|require\s*\(` which is trivially true for any CJS output and no longer verifies the vscode-external contract.

**Missing: no vitest.config.ts for vscode mock wiring.** `src/__mocks__/vscode.ts` exists but vitest does not honor Jest-style `__mocks__` directories by default. Without a `vitest.config.ts` with an alias mapping `vscode` → mock, the mock is dead code. Section-05 unit tests will silently import the real `vscode` module (which throws in Node context) instead of the mock.

## Security Concerns

**Command injection in `getVsixEntries`.** The vsix path is string-interpolated directly into a PowerShell command with only backslash escaping. If `ROOT` contains a single quote the command will break or execute unintended code. Test-only, low severity in practice. A safer approach uses `spawnSync` with an argument array.

**Silent failure in `getVsixEntries` catch block.** `catch { return []; }` makes the `some(e => ...)` "not contains" assertions pass vacuously on non-Windows platforms (all return false against empty array), and gives opaque failures for the "contains" assertions.

## Code Quality Issues

**`webview/main.ts` deviates from spec stub.** The plan specifies only the `window.addEventListener('message', ...)` handler with no imports. The implementation adds `import { WebGLRenderer }` and assigns to `window['DevNeuralRendererClass']`. This is a section-06 concern, not a scaffold concern. More critically, the test was then written to check for `WebGLRenderer|BufferGeometry` — it is validating the hack, not the spec requirement (which says "contains 'THREE' or 'three'").

**`@types/three` version mismatch.** `three: ^0.162.0` runtime dependency vs `@types/three: ^0.183.1` devDependency — 21 minor versions apart. The justification that "three v0.162.0 ships no d.ts files" is incorrect; three.js has shipped bundled TypeScript declarations since v0.133.0. The version mismatch means APIs available at typecheck time (added in v0.163-0.183) are absent at runtime, providing false confidence from `npm run typecheck`.

**`production build smaller than dev build` test mutates dist/ without try/finally.** If the restoration build fails, subsequent tests that check dist/ contents will read minified production artifacts (no source maps), silently breaking the source-map presence tests.

**`ExtensionContext` mock exported as a class.** The real `@types/vscode` defines `ExtensionContext` as an interface, not a constructable class. This will cause type errors when extension host code typed `context: vscode.ExtensionContext` is compared against the mock type.

## Test Quality Gaps

- 19 tests total (7 manifest + 8 build smoke + 4 vsix) — matches plan count
- No test exercises `npm run typecheck` (plan completion criterion #2 is manual-only)
- vscode-external heuristic (no VS Code internals + size < 50KB) is weaker than checking `require("vscode")`
- `getVsixEntries` is Windows-only via PowerShell; tests pass vacuously on other platforms

## Deviation Assessment Summary

| Deviation | Risk | Verdict |
|-----------|------|---------|
| `import * as vscode` vs `import type *` | Low (stub replaced in s05) | Acceptable |
| `@types/three` version mismatch | Medium (false typecheck confidence) | Fix: pin to `^0.162.0` |
| `webview/main.ts` Three.js import hack | Medium (spec violation, retrofitted test) | Fix: revert to spec stub; defer to s06 |
| Missing vitest.config.ts vscode alias | High (breaks all future extension unit tests) | Fix: add vitest.config.ts before s05 |
| No try/finally in prod build test | Low (test isolation) | Auto-fix |
| getVsixEntries silent catch | Low (test-only, Windows project) | Let go |
