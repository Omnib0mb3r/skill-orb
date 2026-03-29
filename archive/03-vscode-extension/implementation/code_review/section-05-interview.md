# Code Review Interview: section-05 extension-host

## Triage Decision

No items required user input. All actionable findings were auto-fixed or dismissed.

---

## Auto-fixes Applied

### Fix 1: Path prefix false-positive in `detectActiveProjects`
**Finding**: `activeFilePath.startsWith(n.localPath)` is a string prefix check, not a path prefix check. `/home/dev/project/file.ts` would incorrectly match localPath `/home/dev/proj`.
**Action**: Changed to `activeFilePath.startsWith(n.localPath + '/')`.
**Test added**: "does not match a localPath that is a string prefix but not a path prefix".

### Fix 2: tsconfig.json include/exclude contradiction
**Finding**: `tests/**/*` appeared in both `include` and `exclude`. TypeScript's `exclude` wins, making the `include` entry a no-op leftover.
**Action**: Removed `tests/**/*` from `include`. Now `include` has only `src/**/*` and `webview/**/*`, and `exclude` has `src/__tests__/**/*` and `src/__mocks__/**/*`.

### Fix 3: Remove dead `onClose` from `WsClientOptions`
**Finding**: `onClose: () => {}` was passed to `createWsClient` but never acted on. `wsClient.ts` called `options.onClose()` before each reconnect but the callback was always a no-op. Reconnect is handled internally by the client.
**Action**: Removed `onClose` from `WsClientOptions` interface, removed the call from the `close` handler in `wsClient.ts`, and removed the empty callback from `startWs` in `extension.ts`.

---

## Dismissed (Let Go)

- **Issue 3 (deactivate lifecycle)**: Reviewer's concern was a misread. `deactivate()` directly cleans all state; if `onDidDispose` fires later it's all no-ops. Current code is correct.
- **Issue 5 (Math.random nonce)**: Locally-run developer tool; nonce is for CSP enforcement not cryptographic secrecy. Acceptable.
- **Issue 6 (500KB size cap)**: Wide but appropriate given `ws` bundled + expected future growth.
- **Issues 7-9**: Test coverage nitpicks; existing tests are correct and sufficient.

---

## Result

57/57 tests pass. Typecheck clean.
