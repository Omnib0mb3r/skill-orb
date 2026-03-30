# Section 09: Web Foundation (03-web-app)

## Purpose

Bootstrap `03-web-app`: create the directory structure, wire up the Vite + Vitest build toolchain, define the core types that flow through the entire orb renderer, and implement the two pure-function modules that sections 10 and 11 depend on: `src/graph/types.ts` (OrbNode, OrbEdge, SceneState) and `src/orb/visuals.ts` (material config factory, edge opacity mapping). No Three.js scene construction is done here — that is section 10.

## Dependencies

- **section-01-api-extensions** must be complete. The three `voice:*` WebSocket event types (`voice:focus`, `voice:highlight`, `voice:clear`) must be defined in `02-api-server` before the orb handlers reference their payload shapes.
- `node_modules` for `03-web-app` is already installed — `npm install` has been run and the directory exists at `C:/dev/tools/DevNeural/03-web-app/node_modules`. Do not run `npm install` again; the packages are present.

## Files to Create

All files live under `C:/dev/tools/DevNeural/03-web-app/`. Source files go in `src/`; test files go in `tests/`.

```
03-web-app/
  package.json
  tsconfig.json
  vite.config.ts
  vitest.config.ts
  src/
    graph/
      types.ts
    orb/
      visuals.ts
  tests/
    orb/
      visuals.test.ts
```

The following directories and files will be created in later sections; do not create them now:

```
src/graph/builder.ts         ← section 10
src/orb/renderer.ts          ← section 10
src/orb/physics.ts           ← section 10
src/orb/interaction.ts       ← section 12
src/ws/client.ts             ← section 11
src/ws/handlers.ts           ← section 11
src/ui/hud.ts                ← section 12
src/main.ts                  ← section 12
public/index.html            ← section 12
```

---

## Tests First

Tests live in `C:/dev/tools/DevNeural/03-web-app/tests/orb/visuals.test.ts`. Three.js is mocked at the module level using `vi.mock('three')` — this is the standard approach for all 03-web-app tests since Three.js requires a WebGL context not available in Node.js. The `visuals.ts` module must not use any Three.js constructors that touch WebGL; it should return plain configuration objects (color values, opacity numbers) that can be verified in tests without a browser.

```typescript
// tests/orb/visuals.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('three');

import { getMaterialForNodeType, getEdgeOpacity, highlightMaterialConfig, dimmedMaterialConfig, defaultMaterialConfig } from '../../src/orb/visuals';

describe('getMaterialForNodeType', () => {
  it('returns a config with a blue hue for project nodes');
  it('returns a config with a green hue for skill nodes');
  it('returns a config with an orange hue for tool nodes');
  it('returns a config for unknown node type without throwing');
});

describe('getEdgeOpacity', () => {
  it('is monotonic — getEdgeOpacity(5) > getEdgeOpacity(3)');
  it('returns at least 0.05 for weight 0 (minimum visibility)');
  it('returns at most 1.0 for weight 10 (max opacity capped)');
  it('returns a value in 0.0–1.0 for any weight in the valid range');
});

describe('material config variants', () => {
  it('highlightMaterialConfig differs from defaultMaterialConfig');
  it('dimmedMaterialConfig has lower opacity than defaultMaterialConfig');
});
```

Run tests from `C:/dev/tools/DevNeural/03-web-app/` with `npm test`. All tests in `visuals.test.ts` must pass before proceeding to section 10.

---

## package.json

The 03-web-app uses Vite and Vitest. It is a browser application (ESM target) entirely separate from the Node.js CommonJS splits.

```json
{
  "name": "devneural-web-app",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port 3748",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "three": "^0.183.0"
  },
  "devDependencies": {
    "@types/three": "^0.160.0",
    "@vitejs/plugin-react": "^4.2.0",
    "typescript": "^5.4.0",
    "vite": "^5.2.0",
    "vitest": "^1.6.0"
  }
}
```

Use the installed version (`three@0.183.2`) — do not re-run `npm install`. The `package.json` range should be `"three": "^0.183.0"` to match what is actually installed.

---

## tsconfig.json

The browser target uses ESNext modules, which is different from the CommonJS target used by the Node.js splits.

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["ESNext", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "noEmit": true
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

`"noEmit": true` because Vite handles the build output — `tsc` is used for type-checking only, not for producing JavaScript.

---

## vite.config.ts

Serves on port 3748 in dev mode. No special plugins are needed for this section.

```typescript
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3748,
  },
  build: {
    target: 'esnext',
  },
});
```

---

## vitest.config.ts

Vitest needs `environment: 'node'` for all 03-web-app tests. Three.js is mocked at the test level (`vi.mock('three')`), not via a global configuration. Do not use `jsdom` or `happy-dom` — Three.js tests work without a DOM since the constructors are fully mocked.

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    testTimeout: 10000,
  },
});
```

---

## src/graph/types.ts

Define all types that flow through the orb renderer. Nothing in `03-web-app` should redefine these; import from this file.

```typescript
// src/graph/types.ts

/** Node types that correspond to DevNeural graph node types. */
export type NodeType = 'project' | 'skill' | 'tool';

/**
 * A node as represented in the orb scene.
 * Tracks position and velocity for the force simulation.
 */
export interface OrbNode {
  id: string;
  label: string;
  type: NodeType;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
}

/**
 * An edge between two OrbNodes with a weight that drives
 * both spring force strength and visual opacity.
 */
export interface OrbEdge {
  /** Source node ID. */
  sourceId: string;
  /** Target node ID. */
  targetId: string;
  /** Connection weight in range 0.0–10.0. */
  weight: number;
}

/**
 * The full state of the Three.js scene, kept outside Three.js
 * objects so it is accessible to the force simulation and event handlers
 * without requiring a WebGL context.
 */
export interface SceneState {
  nodes: Map<string, OrbNode>;
  edges: OrbEdge[];
  /** Node IDs currently highlighted by a voice:highlight event. Empty = none highlighted. */
  highlightedNodeIds: Set<string>;
  /** Single node ID focused by a voice:focus event. Null = none focused. */
  focusedNodeId: string | null;
  /** Whether the force simulation has cooled down (all velocities below threshold). */
  simulationCooled: boolean;
}
```

The `SceneState` is a plain JavaScript object — no Three.js types. Three.js `Mesh` and `Line` objects are managed by the renderer in section 10 and are referenced by node ID lookups against this state, not stored here.

---

## src/orb/visuals.ts

Implement the pure configuration functions used by the graph builder (section 10) and the WebSocket handlers (section 11) to create and switch node/edge materials. These functions return plain config objects, not live Three.js material instances — the caller in section 10 converts these configs into actual `MeshStandardMaterial` and `LineBasicMaterial` instances.

The design principle: `visuals.ts` has no `import * as THREE from 'three'` at the top level. This keeps it testable without mocking.

### Types for material configs

```typescript
export interface MaterialConfig {
  color: number;      // hex color as integer, e.g., 0x4488ff
  opacity: number;    // 0.0–1.0
  transparent: boolean;
  emissive?: number;  // optional emissive glow color
  emissiveIntensity?: number;
}
```

### Functions to implement

`getMaterialForNodeType(type: NodeType): MaterialConfig`
- Returns a `MaterialConfig` for the given node type.
- Project nodes: blue-tinted (`color` in the 0x0000ff–0x8888ff range).
- Skill nodes: green-tinted (`color` in the 0x00bb00–0x88ff88 range).
- Tool nodes: orange-tinted (`color` in the 0xcc6600–0xffaa44 range).
- For any unrecognized type, return the project color as a safe default.

`getEdgeOpacity(weight: number): number`
- Maps a weight in 0.0–10.0 to an opacity in 0.05–1.0.
- The mapping must be monotonically increasing: higher weight always produces higher or equal opacity.
- A weight of 0 must return at least 0.05 (edges remain faintly visible even at zero weight).
- A weight of 10 must return exactly 1.0 or be capped at 1.0.
- Linear interpolation is the simplest correct implementation: `Math.min(1.0, Math.max(0.05, weight / 10))`.

`defaultMaterialConfig`: a `MaterialConfig` constant representing an unselected, non-highlighted node. Normal opacity (e.g., 0.8).

`highlightMaterialConfig`: a `MaterialConfig` constant for a highlighted node. Distinctly brighter — higher `emissiveIntensity` or a lighter `color` than the default. The test verifies this differs from `defaultMaterialConfig`.

`dimmedMaterialConfig`: a `MaterialConfig` constant for a node that is neither focused nor highlighted when other nodes are highlighted. Lower opacity than `defaultMaterialConfig`. The test verifies `dimmedMaterialConfig.opacity < defaultMaterialConfig.opacity`.

Note: the highlight and dimmed configs are type-agnostic — they apply uniformly to any node type when a voice event is active. The per-type colors from `getMaterialForNodeType` are blended in by the caller in section 11.

---

## Implementation Notes

**Files created/updated:**
- `03-web-app/src/graph/types.ts` — OrbNode, OrbEdge, SceneState, NodeType
- `03-web-app/src/orb/visuals.ts` — getMaterialForNodeType, getEdgeOpacity, config constants
- `03-web-app/tests/orb/visuals.test.ts` — 10 tests
- `03-web-app/package.json` — name updated, test script kept `tsc --noEmit && vitest run`
- `03-web-app/tsconfig.json` — added `tests` to include
- `03-web-app/vite.config.ts` — port changed from 5173 to 3748
- `03-web-app/vitest.config.ts` — changed to `environmentMatchGlobs` to preserve existing jsdom tests

**Deviations from plan:**
- `vitest.config.ts` uses `environmentMatchGlobs` instead of flat `environment: 'node'` — required to preserve 100 existing webview tests that use jsdom.
- `getMaterialForNodeType` returns `transparent: true` (review fix — Three.js requires this for opacity to apply).
- `getEdgeOpacity` range test lower bound is `0.05` not `0.0` (review fix).

**Final test count:** 110 (10 new visuals + 100 existing webview); tsc clean.

## Verification Checklist

Before marking this section complete:

1. `package.json`, `tsconfig.json`, `vite.config.ts`, and `vitest.config.ts` exist at `C:/dev/tools/DevNeural/03-web-app/`.
2. `src/graph/types.ts` exports `NodeType`, `OrbNode`, `OrbEdge`, and `SceneState`.
3. `src/orb/visuals.ts` exports `getMaterialForNodeType`, `getEdgeOpacity`, `defaultMaterialConfig`, `highlightMaterialConfig`, and `dimmedMaterialConfig`.
4. `npm test` runs from `C:/dev/tools/DevNeural/03-web-app/` and all tests in `tests/orb/visuals.test.ts` pass.
5. `npx tsc --noEmit` from `C:/dev/tools/DevNeural/03-web-app/` completes without errors.
6. Confirm `visuals.ts` has no top-level `import` from `'three'` — the tests must pass without WebGL.
