# Code Review — section-07-server-wiring

## HIGH

**H1: SIGINT handler bypasses `stop()` and missing try/catch**
The IIFE entry-point SIGINT handler re-implements shutdown instead of calling the returned `stop()` closure. This skips the idempotency guard (`stopped` flag). The plan also specifies wrapping `fastify.close()` in a try/catch to exit 0 regardless.

**H2: Watchers start before `setWss` — broadcasts silently dropped during startup window**
`startWatchers()` fires before `fastify.listen()` / `setWss()`. The broadcaster's null-guard saves correctness, but any broadcast triggered in that window is silently dropped. Low real-world risk (ignoreInitial:true on weights watcher) but fragile ordering.

## MEDIUM

**M1: Port-collision cleanup nukes running server's module-level watcher state**
When `fastify.listen()` fails, `stopWatchers()` in the catch block resets the singleton watcher module's state. In tests running in the same process, this affects the first server's watchers. Known limitation of the watcher module's singleton design.

## LOW

**L1: `import fs from 'node:fs'` but only `fs.promises` is used → should be `node:fs/promises`**

**L2: `version: ''` in emptyWeights → plan shows `'1.0'`**

**L3: SIGINT handler missing try/catch around `fastify.close()`**

## NOT IMPLEMENTED

SIGINT handler test (acceptable — handler calls `process.exit(0)`, untestable in vitest context; `stop()` test covers same shutdown behavior).
