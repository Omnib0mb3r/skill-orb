# Section 01: Package and TypeScript Setup

## Overview

This section establishes the build tooling for `04-session-intelligence`. It produces `package.json`, `tsconfig.json`, and `vitest.config.ts`. No source modules are created here — the purpose is to make `npm run build`, `npm test`, and `npm run install-hook` all work correctly before any implementation begins.

All subsequent sections (02 through 06) depend on this section being complete.

## Dependencies

None. This is the root section with no upstream dependencies.

## Files to Create

```
04-session-intelligence/
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

The `src/` and `tests/` directories and their contents are created in later sections.

## Tests (Write These First)

The "tests" for this section are build validation checks. Write a minimal placeholder source file (`src/index.ts` with a single export or even an empty file) to give the TypeScript compiler something to compile. Then confirm:

1. `tsc --noEmit` exits 0 with no errors (TypeScript configuration is valid)
2. `npm run build` exits 0 and produces a `dist/` directory
3. `node dist/session-start.js` with empty/piped stdin exits 0 without throwing (requires `src/session-start.ts` stub from section 05, but the build infrastructure must be proven valid here)

These checks will fail until the config files are correct — particularly the `tsconfig.json` `rootDir` absence and the module resolution settings.

## `package.json`

The module name should be `devneural-session-intelligence`. It is `private: true`.

**Scripts:**
- `build` — `tsc`
- `dev` — `tsx src/session-start.ts`
- `install-hook` — `tsx src/install-hook.ts`
- `test` — `vitest run`
- `test:watch` — `vitest`

**Runtime dependencies:** none. The module uses only Node.js built-ins (`fs`, `path`, `http`, `https`, `os`, `child_process`). The `01-data-layer` compiled output is accessed via relative path import at runtime, not declared as an npm dependency.

**Dev dependencies** (match the `01-data-layer` version pins for consistency):
- `typescript` — `^5.4.0`
- `tsx` — `^4.7.0`
- `vitest` — `^1.6.0`
- `@types/node` — `^20.0.0`

## `tsconfig.json`

The critical difference from `01-data-layer`'s tsconfig is the **absence of `rootDir`**. The `01-data-layer` tsconfig has `"rootDir": "./src"`, which works because all its sources live under `src/`. However, `04-session-intelligence` imports from `../01-data-layer/dist/` — a path outside the project root. Setting `rootDir` to `./src` would cause TypeScript to error when it sees the cross-package relative import. Omitting `rootDir` entirely tells the compiler to infer it from the files it finds, which allows cross-directory imports while still writing output to `outDir`.

**Required settings:**
- `target`: `ES2022`
- `lib`: `["ES2022"]`
- `module`: `CommonJS`
- `moduleResolution`: `node`
- `outDir`: `./dist`
- `strict`: `true`
- `esModuleInterop`: `true`
- `skipLibCheck`: `true`
- `declaration`: `true`
- `declarationMap`: `true`
- `sourceMap`: `true`
- **No `rootDir` field**

**Include/exclude:**
```json
{
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

Excluding `tests/` from the main compilation is important — tests are run by Vitest directly, not compiled by `tsc`. Including them would require `@types/...` for test utilities and would generate unwanted `.js` files in `dist/`.

## `vitest.config.ts`

Vitest's default test timeout is 5 seconds. The API timeout test (section 03) uses a mock server with a 6-second delay to verify that `fetchSubgraph` correctly times out at 5 seconds. The integration test (section 05/07) has a similar case. A 5-second Vitest timeout would cause these tests to be killed before they can assert that the module under test correctly returned `null`.

Set `testTimeout: 15000` to give all tests up to 15 seconds, preventing false failures on the slow timeout tests.

Match the `01-data-layer` pattern exactly:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    testTimeout: 15000,
  },
});
```

## Implementation Notes

**Why no `rootDir` in tsconfig?**

When TypeScript sees `"rootDir": "./src"` and encounters an import like `import { ... } from '../01-data-layer/dist/identity/index.js'`, it emits an error: "File '...' is not under 'rootDir'". Removing `rootDir` entirely allows TypeScript to infer the root from all included files, avoiding this constraint. The output structure in `dist/` is slightly different (TypeScript mirrors the full relative path structure), but this is acceptable for a private build tool.

**Node.js version requirement:**

The module uses `fetch` (built-in since Node 18) and `AbortSignal.timeout()` (Node 17.3+). Claude Code requires Node 18+, so no polyfills are needed. Do not add `node-fetch` or any HTTP library as a dependency.

**`01-data-layer` build prerequisite:**

Before `04-session-intelligence` can compile, `01-data-layer` must have been built (its `dist/` directory must exist). Section 02 imports from `../01-data-layer/dist/`. If `01-data-layer/dist/` is absent, `tsc` will fail with "Cannot find module" errors. The README or install notes for this module should make this prerequisite explicit.

To verify `01-data-layer` is built:
```
ls C:/dev/tools/DevNeural/01-data-layer/dist/
```
If the directory is missing, run `npm run build` in `01-data-layer/` first.

## Checklist

- [x] Create `04-session-intelligence/package.json` with scripts and dev dependencies listed above
- [x] Create `04-session-intelligence/tsconfig.json` without `rootDir`, with `outDir: ./dist`
- [x] Create `04-session-intelligence/vitest.config.ts` with `testTimeout: 15000`
- [x] Run `npm install` in `04-session-intelligence/` to create `node_modules/`
- [x] Confirm `01-data-layer/dist/` exists (build it if not)
- [x] Create a minimal `src/index.ts` stub (empty export is sufficient) to validate the TypeScript config compiles without errors
- [x] Run `tsc --noEmit` and confirm it exits 0
- [x] Run `npm run build` and confirm `dist/` is created

## Implementation Notes (Actual)

### Files Created
- `04-session-intelligence/package.json` — version `0.1.0` (aligned with sibling packages)
- `04-session-intelligence/tsconfig.json` — no `rootDir`, `outDir: ./dist`
- `04-session-intelligence/vitest.config.ts` — `testTimeout: 15000`
- `04-session-intelligence/src/index.ts` — `export {}` stub for build validation
- `04-session-intelligence/.gitignore` — `node_modules/`, `dist/` (added in code review)
- `04-session-intelligence/package-lock.json` — committed for reproducible installs

### Deviations from Plan
- Version set to `0.1.0` (not `1.0.0`) to match `01-data-layer/package.json`
- Added `.gitignore` (not in plan) for defensive packaging
