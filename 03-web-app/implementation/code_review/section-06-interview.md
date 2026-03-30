# Code Review Interview: section-06-integration

## User Decisions

**voice.ts types:** Add a minimal local `SpeechRecognitionLike` interface instead of `as any`.

**build:check CI:** Wire `tsc --noEmit` into `npm test` so it runs automatically.

## Auto-fixes to apply

1. Fix nodeActions.ts: replace dead-code guard with type assertion `hit.instanceId as number`
2. Add `onFinishUpdate` to ThreeForceGraph mock in integration.test.ts
3. Add edge-cap coverage test to gap-coverage.test.ts (GRAPH_EDGE_CAP=300 path)
4. Fix resetNodeColors null assertion — use safer check
5. Add `mockScene.remove` assertion to graph:snapshot animation test
6. Add minimal `SpeechRecognitionLike` interface in voice.ts
7. Wire `build:check` into `npm test` script in package.json
