# Code Review: section-05 extension-host

## Overall Assessment

Implementation covers all files in the plan and all 37 tests pass. Core architecture is sound. Three MUST FIX issues identified.

---

## MUST FIX

### 1. Path prefix false-positive in `detectActiveProjects` (activeProject.ts:14)

`activeFilePath.startsWith(n.localPath)` matches `/home/dev/project-b/file.ts` against localPath `/home/dev/proj` because it is a string prefix, not a path prefix. The fix is `activeFilePath.startsWith(n.localPath + '/')`. The test suite misses this case — all test fixtures use distinct enough path names that the bug never triggers.

### 2. `tsconfig.json` include/exclude contradiction (tsconfig.json:11-12)

`tests/**/*` appears in both `include` and `exclude`. TypeScript's exclude wins, so `tests/build-smoke.test.ts` is silently dropped from type-checking. The `include` entry is a leftover from before exclude was added. Remove `tests/**/*` from `include`.

### 3. `deactivate()` / `onDidDispose` double-lifecycle review

`deactivate()` correctly cleans up all state directly (disconnects wsClient, disposes panel, nulls everything). The `onDidDispose` listener that also calls `disposePanel()` is safe — if it fires after `deactivate()` all the nullish checks make it a no-op. Current implementation is **correct**. Marking as reviewed and no fix needed.

---

## CONSIDER

### 4. `onClose` callback is vestigial dead code (wsClient.ts:45-46, extension.ts:84-86)

`startWs` passes `onClose: () => {}` — a no-op. `wsClient` calls `options.onClose()` before scheduling reconnect but the only consumer ignores it. The interface advertises `onClose` as a meaningful hook but it is never used. Remove it from `WsClientOptions` to simplify the interface; reconnect is handled internally anyway.

### 5. Nonce uses `Math.random()` instead of `crypto` (panelManager.ts:47-52)

`generateNonce()` uses non-cryptographic randomness. For a developer tool running locally, this is acceptable — the nonce's purpose is CSP enforcement, not cryptographic secrecy. Leave as-is.

### 6. Build smoke size cap 500KB is wide (tests/build-smoke.test.ts:38)

Actual extension.js size is ~150KB. 500KB cap gives 3x headroom. A regression bundling 300KB extra would still pass. Acceptable given ws is legitimately bundled and future growth is expected. Leave as-is.

### 7. `reconnectWs` config-change test doesn't verify old timer cancellation

The test fires config change and asserts new WS is created, but doesn't advance fake timers to verify no double-reconnect. The test is functionally correct for the current behavior. Leave as-is.

---

## NITPICK

### 8. Near-duplicate reconnect timer tests

"reconnect loop does not fire after panel is disposed" and "panel.onDidDispose cancels any pending reconnect timer" test nearly identical scenarios. Acceptable given they live in different describe blocks. Leave as-is.

### 9. MockWebSocket.close() is synchronous

Real WebSocket close is async. Synchronous mock causes double `ws = undefined` in disconnect() — harmless no-op. Intentional for test simplicity. Leave as-is.
