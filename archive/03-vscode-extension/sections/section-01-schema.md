# section-01-schema

## Overview

This section is the foundation for the rest of the 03-vscode-extension work. It has no dependencies on other sections and can be executed immediately. It blocks sections 02 (data-layer) and 03 (api-server), so it should be completed first.

The work has three parts:

1. Reconcile a pre-existing `WeightsFile` type mismatch between the data layer and the API server
2. Define, document, and create the `devneural.json` per-project config standard
3. Create `devneural.json` and `devneural.md` files for every existing DevNeural project

---

## Tests First

These tests live in the data layer and API server, not in the extension. They validate the reconciliation and schema work done in this section.

### 1.0 WeightsFile schema alignment tests

These run against the existing test suites in `01-data-layer` and `02-api-server`. Add or update tests to cover the reconciled field names.

```
// Data layer writer + API server reader alignment
// Test: GraphBuilder reads a weights.json written by the data layer without field-name errors
//       (i.e., the fields the builder looks for are the same ones the writer emits)
// Test: WeightsFile type has aligned field names between:
//       01-data-layer/src/types.ts  and  02-api-server/src/graph/types.ts
// Test: Reading a weights.json with the old divergent field names produces a recoverable error
//       or explicit fallback, not a silent wrong value
```

### 1.1 devneural.json schema validation tests

Write these as pure unit tests (no file I/O required — pass plain objects to the validator). Place them in `01-data-layer/src/__tests__/devneural-schema.test.ts` or a shared `schema/` module that both components can import.

```
// Test: Valid devneural.json with all required fields passes validation
// Test: Missing required field (e.g., stage absent) fails validation with a clear error message
// Test: Invalid stage value — anything not in alpha|beta|deployed|archived — fails validation
// Test: tags array containing an unrecognized tag value fails validation
// Test: localPath supplied as a relative path fails validation (must be absolute)
// Test: Extra unknown fields are tolerated (validation is not strict on additional properties)
```

---

## Part 1.0 — Reconcile the WeightsFile Type Mismatch

### Problem

The data layer (`01-data-layer/src/types.ts`) and the API server (`02-api-server/src/graph/types.ts`) both define a `WeightsFile` type, but their field names have diverged:

| Concept | Data layer field | API server field |
|---|---|---|
| Schema version | `schema_version: 1` | `version: string` |
| Timestamp | `updated_at: string` | `last_updated: string` |

The data layer's `hook-runner.ts` writes `weights.json` using `schema_version` and `updated_at`. The API server's watcher reads `weights.json` and constructs an empty fallback using `last_updated` and `version`. These files currently coexist because the existing code in `02-api-server/src/watcher/index.ts` only reads `connections` from the parsed object and never actually reads `version` or `last_updated` — but the type mismatch is a latent bug that will cause cross-component confusion when extended.

### What to Change

Choose one canonical set of field names and update both sides. The recommended resolution is to adopt the data layer's names (`schema_version` and `updated_at`) since those are the names being actively written to disk. Update:

- `02-api-server/src/graph/types.ts`: change `WeightsFile` to use `schema_version: number` and `updated_at: string` (drop `version` and `last_updated`)
- `02-api-server/src/watcher/index.ts`: update the empty fallback object on line 52 to use the reconciled field names
- Any tests in `02-api-server` that construct `WeightsFile` fixtures must be updated to use the new field names

The data layer side does not need to change — it is already the authoritative source.

Do NOT change `WeightsFileEntry` (the per-edge record type) — that type is already aligned between components.

### ConnectionType Note

The data layer defines 3 `ConnectionType` variants; the API server defines 4 (adding `tool->skill`). This divergence is noted as cross-component tech debt but is NOT fixed in this section. The extension depends only on the API server's 4-variant type. Leave both files as-is regarding `ConnectionType`.

---

## Part 1.1 — Define the devneural.json Standard

### Schema Definition

Every project tracked by DevNeural must have a `devneural.json` at its root. This is the canonical node-level metadata source. The fields are:

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Human-readable display name shown as the node label in the orb |
| `localPath` | string (absolute) | yes | Absolute local filesystem path to the project root. Must begin with `/` (Unix) or a drive letter `X:/` (Windows). Relative paths are invalid. |
| `githubUrl` | string | yes | Canonical GitHub URL, e.g. `https://github.com/user/DevNeural` |
| `stage` | enum string | yes | One of: `alpha`, `beta`, `deployed`, `archived` |
| `tags` | string[] | yes | Array, zero or more of: `revision-needed`, `sandbox` |
| `description` | string | yes | Short human-readable description of the project |

All six fields are required. An empty `tags` array (`[]`) is valid. No extra fields are forbidden — the validator should tolerate additional properties to allow forward-compatible extension.

### Stage Semantics

- `alpha` — early development, actively changing, incomplete
- `beta` — feature-complete but not production-hardened
- `deployed` — running in production or actively used
- `archived` — no longer developed; historical record only

### Tag Semantics

- `revision-needed` — known areas requiring rework; signals caution in the orb view
- `sandbox` — experimental or throwaway work; lower trust signal

Tags can be combined (`["revision-needed", "sandbox"]` is valid). An empty array `[]` means no special status.

### Validation Module Location

Create a shared validation module at `01-data-layer/src/schema/devneural-config.ts` that exports:

- A `DevNeuralConfig` TypeScript interface matching the schema above
- A `validateDevNeuralConfig(raw: unknown): DevNeuralConfig` function that throws a descriptive error on invalid input

Both the data layer hook runner (section 02) and the API server graph builder (section 03) will import from this module (or a copy of it). If sharing across packages is awkward, duplicate the small validation module rather than introducing a monorepo dependency. Keep it under 60 lines.

Stub:

```typescript
// 01-data-layer/src/schema/devneural-config.ts

export type StageValue = 'alpha' | 'beta' | 'deployed' | 'archived';
export type TagValue = 'revision-needed' | 'sandbox';

export interface DevNeuralConfig {
  name: string;
  localPath: string;       // must be absolute
  githubUrl: string;
  stage: StageValue;
  tags: TagValue[];
  description: string;
}

/**
 * Validates and returns a typed DevNeuralConfig from an unknown parsed JSON value.
 * Throws a descriptive Error on any missing or invalid field.
 * Tolerates unknown extra fields.
 */
export function validateDevNeuralConfig(raw: unknown): DevNeuralConfig { ... }
```

---

## Part 1.2 — Create devneural.md

Create `devneural.md` at the root of the `DevNeural` repository (`c:/dev/tools/DevNeural/devneural.md`). This file serves as living documentation for the `devneural.json` format, written for both human developers and Claude.

The file must cover:

- What `devneural.json` is and why it exists
- All six fields with their types, allowed values, and semantics
- What changes to `devneural.json` trigger downstream effects (API server re-scan, orb node badge update)
- How `localPath` is used for local folder opening from the orb
- How `githubUrl` is used as the fallback when `localPath` is absent or the path doesn't exist on disk
- A complete example `devneural.json`
- A note that validation is enforced at read time — malformed files are skipped with a warning, not silently ignored

---

## Part 1.3 — Create devneural.json for All Existing Projects

Create `devneural.json` files for all existing DevNeural projects. The main repository:

### Project: DevNeural

- File path: `c:/dev/tools/DevNeural/devneural.json`

```json
{
  "name": "DevNeural",
  "localPath": "c:/dev/tools/DevNeural",
  "githubUrl": "https://github.com/mcollins-f6i/DevNeural",
  "stage": "alpha",
  "tags": [],
  "description": "Living neural network of project interconnections — data layer, API server, and VS Code extension"
}
```

### Notes on Other Tracked Nodes

The current `weights.json` may show project node IDs like `project:c:/dev/bridger-tests` — these are CWD-fallback identifiers (no git remote found), not GitHub-URL identifiers. These nodes cannot have `devneural.json` files created for them that the API server's registry scanner will match, since the scanner matches against `project:github.com/...` prefixes. They will appear in the orb without stage badges — this is expected behavior per the plan.

If `c:/dev/bridger-tests` is a real project with a GitHub remote, check for the remote and create a `devneural.json` there with appropriate values.

---

## File Locations Summary

| File | Action |
|---|---|
| `c:/dev/tools/DevNeural/devneural.json` | Create |
| `c:/dev/tools/DevNeural/devneural.md` | Create |
| `c:/dev/tools/DevNeural/01-data-layer/src/schema/devneural-config.ts` | Create |
| `c:/dev/tools/DevNeural/01-data-layer/src/__tests__/devneural-schema.test.ts` | Create |
| `c:/dev/tools/DevNeural/02-api-server/src/graph/types.ts` | Modify (`WeightsFile` field names) |
| `c:/dev/tools/DevNeural/02-api-server/src/watcher/index.ts` | Modify (fallback object) |

---

## Dependencies

This section has no dependencies on other sections. It must complete before sections 02 and 03 begin.

## Checklist

- [ ] `WeightsFile` field names aligned in `02-api-server/src/graph/types.ts` (adopt `schema_version` + `updated_at`)
- [ ] Empty fallback in `02-api-server/src/watcher/index.ts` uses reconciled field names
- [ ] Existing API server tests updated to use reconciled `WeightsFile` fixtures
- [ ] `01-data-layer/src/schema/devneural-config.ts` created with `DevNeuralConfig` interface and `validateDevNeuralConfig` function
- [ ] Unit tests for `validateDevNeuralConfig` pass (valid input, missing fields, invalid stage, invalid tag, relative localPath)
- [ ] `c:/dev/tools/DevNeural/devneural.json` created
- [ ] `c:/dev/tools/DevNeural/devneural.md` created with full field documentation and an example
- [ ] Any other confirmed projects have `devneural.json` created at their root
