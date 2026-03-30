# Section 02: Voice Foundation

## Purpose

Bootstrap the `05-voice-interface` project: create the directory structure, wire up the build toolchain, define the core types that flow through the entire system, and add the identity re-export. No parsing logic is implemented here — this section creates the skeleton that sections 03–08 fill in.

## Dependencies

- **section-01-api-extensions** must be complete: the `02-api-server` `POST /voice/command` endpoint and the three new `voice:*` WebSocket event types are assumed to exist before voice-interface code runs.
- **01-data-layer** must be built (`npm run build` in `C:/dev/tools/DevNeural/01-data-layer`) so that `dist/identity/index.js` and `dist/types.js` exist for the re-export.

## Files to Create

All files live under `C:/dev/tools/DevNeural/05-voice-interface/`.

```
05-voice-interface/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    intent/
      types.ts
    identity/
      index.ts
  tests/
    intent/
      types.test.ts
    identity/
      identity.test.ts
```

---

## Tests First

Tests live in `05-voice-interface/tests/intent/types.test.ts`. These are compile-time / import-level tests — they confirm the types are exported correctly and that TypeScript is satisfied with the project configuration.

```typescript
// 05-voice-interface/tests/intent/types.test.ts
import { describe, it, expect } from 'vitest';
import type { IntentResult, VoiceResponse } from '../../src/intent/types';

describe('IntentResult type', () => {
  it('accepts a valid IntentResult with all required fields', () => {
    const result: IntentResult = {
      intent: 'get_top_skills',
      confidence: 0.95,
      entities: {},
      source: 'local',
    };
    expect(result.intent).toBe('get_top_skills');
    expect(typeof result.confidence).toBe('number');
  });

  it('allows entities with optional fields omitted', () => {
    const result: IntentResult = {
      intent: 'unknown',
      confidence: 0,
      entities: {},
      source: 'haiku',
    };
    expect(result.entities.nodeName).toBeUndefined();
  });

  it('accepts VoiceResponse with orbEvent undefined', () => {
    const response: VoiceResponse = { text: 'Hello' };
    expect(response.orbEvent).toBeUndefined();
  });

  it('accepts VoiceResponse with a voice:highlight orbEvent', () => {
    const response: VoiceResponse = {
      text: 'You use these skills most.',
      orbEvent: {
        type: 'voice:highlight',
        payload: { nodeIds: ['skill:typescript', 'skill:node'] },
      },
    };
    expect(response.orbEvent?.type).toBe('voice:highlight');
  });
});
```

A separate smoke test confirms the identity re-export resolves:

```typescript
// 05-voice-interface/tests/identity/identity.test.ts
import { describe, it, expect } from 'vitest';
import { resolveProjectIdentity } from '../../src/identity/index';

describe('identity re-export', () => {
  it('resolveProjectIdentity is a function', () => {
    expect(typeof resolveProjectIdentity).toBe('function');
  });

  it('resolves a project identity for the current directory', async () => {
    const identity = await resolveProjectIdentity(process.cwd());
    expect(typeof identity.id).toBe('string');
    expect(['git-remote', 'git-root', 'cwd']).toContain(identity.source);
  });
});
```

Run tests from `C:/dev/tools/DevNeural/05-voice-interface/` with `npm test`. Both test files must pass before proceeding to section 03.

---

## package.json

Follows the same shape as `04-session-intelligence/package.json`. The `natural` library is added here as a runtime dependency (it is used by section 03, but declared in the project root now). Note the compatibility caveat for `natural` documented in the Local Parser section — if the installed version does not support CommonJS `require()`, pin to `natural@6.x`.

```json
{
  "name": "devneural-voice-interface",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "natural": "^6.12.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@anthropic-ai/sdk": "^0.24.0",
    "@types/natural": "^5.1.6",
    "@types/node": "^20.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

Placement of `@anthropic-ai/sdk` in devDependencies is intentional: the Haiku parser only runs at runtime but the SDK should be listed so it is available in the subprocess environment. If you intend to ship a self-contained dist, move it to `dependencies`.

---

## tsconfig.json

Mirrors `04-session-intelligence/tsconfig.json` exactly — CommonJS module, ES2022 target, strict mode, output to `dist/`.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "./dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

---

## vitest.config.ts

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

---

## src/intent/types.ts

Define all shared types here. Nothing in `05-voice-interface` should redefine these — import from this file.

```typescript
// src/intent/types.ts

export type IntentName =
  | 'get_context'
  | 'get_top_skills'
  | 'get_connections'
  | 'get_node'
  | 'get_stages'
  | 'unknown';

export interface IntentResult {
  intent: IntentName;
  /** Normalized confidence in the range 0.0–1.0. */
  confidence: number;
  entities: {
    /** Project or skill name mentioned in the query, as typed by the user. */
    nodeName?: string;
    /** Stage filter string: 'alpha' | 'beta' | 'deployed' | 'archived'. */
    stageFilter?: string;
    /** Requested result count for top-N queries. */
    limit?: number;
  };
  /** Which parser resolved the intent. */
  source: 'local' | 'haiku';
}

export interface VoiceResponse {
  /** Formatted natural-language text for the Claude chat output. */
  text: string;
  /**
   * Optional WebSocket event to send to the orb.
   * Undefined if no visual action is needed (e.g., clarification responses).
   */
  orbEvent?: {
    type: 'voice:focus' | 'voice:highlight' | 'voice:clear';
    payload: unknown;
  };
}
```

---

## src/identity/index.ts

Thin re-export from `01-data-layer`. The relative path assumes `05-voice-interface` is a sibling of `01-data-layer` under `C:/dev/tools/DevNeural/`.

```typescript
// src/identity/index.ts

export type { ProjectIdentity } from '../../01-data-layer/dist/types';
export { resolveProjectIdentity } from '../../01-data-layer/dist/identity/index';
```

This follows the same pattern as `04-session-intelligence/src/identity.ts`. The function name used throughout this split is `resolveProjectIdentity` (matching the 01-data-layer export). Use the actual export name when calling it in later sections.

---

## Verification Checklist

Before marking this section complete:

1. `npm install` runs without errors in `C:/dev/tools/DevNeural/05-voice-interface/`.
2. `npm run build` (`tsc`) produces a `dist/` directory with `dist/intent/types.js`, `dist/intent/types.d.ts`, `dist/identity/index.js`, `dist/identity/index.d.ts`.
3. `npm test` passes both test files (`types.test.ts`, `identity.test.ts`).
4. The `natural` package version installed is CommonJS-compatible (`require('natural')` works in a quick Node REPL check). If it is not, pin to `natural@6.12.0` in `package.json` and reinstall.

## Implementation Notes (Actual)

**Files created:**
- `package.json` — `@types/natural` updated to `^6.0.1` (spec listed `^5.1.6` which does not exist on npm)
- `tsconfig.json`, `vitest.config.ts` — match spec exactly
- `src/intent/types.ts` — matches spec exactly
- `src/identity/index.ts` — uses `../../../01-data-layer/...` (3 levels up, not 2 as in spec) because file is at `src/identity/index.ts` not `src/identity.ts`; also exports `ProjectSource` to match `04-session-intelligence` pattern

**Deviations:**
- Identity import path depth corrected: spec assumed flat `src/identity.ts` but file is `src/identity/index.ts`
- `@types/natural@^6.0.1` used (only available version)

**Test count:** 6 tests, all passing. Build: clean.
