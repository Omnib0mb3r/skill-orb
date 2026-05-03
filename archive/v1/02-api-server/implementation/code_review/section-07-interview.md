# Code Review Interview — section-07-server-wiring

## Auto-fixed

**L1: fs import** — Changed `import fs from 'node:fs'` to `import { promises as fs } from 'node:fs'` and updated call site.

**L2: emptyWeights version** — Changed `version: ''` to `version: '1.0'` to match canonical value.

**H1: SIGINT handler** — Changed entry-point guard to use returned `stop()` closure instead of re-implementing shutdown. `stop()` already has idempotency guard and try/catch for `fastify.close()`.

## User decisions

**H2: Watcher ordering** — User chose to keep watchers starting before `fastify.listen()` (spec order). The broadcaster's null-guard protects correctness during the startup window. No change needed.

**M1: Port-collision watcher leak** — Accepted as known limitation of singleton watcher module. Not fixable without refactoring the watcher module.

## Not implemented (accepted)

SIGINT handler test — handler calls `process.exit(0)`, untestable in vitest context. The `stop()` test covers identical shutdown behavior.
