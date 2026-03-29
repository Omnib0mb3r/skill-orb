# Section 02: Config

## Overview

This section implements the config module: `src/config/index.ts` and its test suite `tests/config.test.ts`.

The config module is the simplest module in the data layer. It has no dependencies on other sections (beyond the types defined in section-01-foundation) and can be implemented and tested in complete isolation.

**Dependency:** section-01-foundation must be complete (project scaffold and `Config` type defined).
**Blocks:** section-06-hook-runner (which calls `loadConfig` at startup).
**Parallelizable with:** section-03-identity, section-04-logger, section-05-weights.

---

## What This Section Produces

- `src/config/index.ts` — exports `loadConfig(dataRoot: string): Config`
- `tests/config.test.ts` — 5 tests covering all specified behaviors

---

## Background and Context

### The data root

All DevNeural data files live under a single directory called the "data root". The default is `C:/dev/data/skill-connections` — intentionally Windows-specific for the author's machine. A `DEVNEURAL_DATA_ROOT` environment variable is the portability escape hatch for other users and platforms.

The config module itself does not create this directory. It only reads from it.

### config.json location

The user-editable config file lives at `<dataRoot>/config.json`. This file is optional — the module works with defaults if the file is absent.

### The Config type

Defined in section-01-foundation. Reference only:

```typescript
interface Config {
  allowlist: string[];    // default: ["Bash", "Write", "Edit", "Agent"]
  data_root: string;      // default: "C:/dev/data/skill-connections"
}
```

### Why a configurable allowlist?

Read-only tools (Read, Glob, Grep, WebSearch) fire constantly and represent noise rather than meaningful work. The allowlist defaults to `["Bash", "Write", "Edit", "Agent"]` — tools that meaningfully transform state or invoke sub-workflows. Users can tune this without redeploying by editing `config.json`.

---

## Tests First

File: `tests/config.test.ts`

Write these 5 tests before implementing. Use a temp directory as `dataRoot` (created in `beforeEach`, removed in `afterEach`). The temp directory pattern is established by the shared fixture helper from section-01-foundation.

1. **Returns defaults when `config.json` does not exist**
   - Call `loadConfig(tempDir)` with no `config.json` present
   - Expect `allowlist` to equal `["Bash", "Write", "Edit", "Agent"]`
   - Expect `data_root` to equal `"C:/dev/data/skill-connections"`

2. **Reads and merges custom allowlist from `config.json`**
   - Write `{ "allowlist": ["Bash", "Edit"] }` to `<tempDir>/config.json`
   - Call `loadConfig(tempDir)`
   - Expect `allowlist` to equal `["Bash", "Edit"]`
   - Expect `data_root` to still equal the default (merge, not replace)

3. **Returns defaults and logs to stderr when `config.json` contains invalid JSON**
   - Write `"this is not json"` to `<tempDir>/config.json`
   - Spy on `console.error` (or `process.stderr.write`)
   - Call `loadConfig(tempDir)`
   - Expect returned config to equal the defaults
   - Expect stderr to contain `[DevNeural] config parse error:`

4. **Reads `data_root` field from `config.json` when present**
   - Write `{ "data_root": "/custom/path" }` to `<tempDir>/config.json`
   - Call `loadConfig(tempDir)`
   - Expect `data_root` to equal `"/custom/path"`

5. **`DEVNEURAL_DATA_ROOT` env var overrides the compiled-in default**
   - Set `process.env.DEVNEURAL_DATA_ROOT = "/env/override"`
   - Call `loadConfig` without a `config.json`
   - Expect `data_root` to equal `"/env/override"`
   - Restore the env var in `afterEach`

---

## Implementation

File: `src/config/index.ts`

### Constants

```typescript
const DEFAULT_DATA_ROOT = 'C:/dev/data/skill-connections';
const DEFAULT_ALLOWLIST = ['Bash', 'Write', 'Edit', 'Agent'];
```

`DEFAULT_DATA_ROOT` is intentionally hardcoded for the author's machine. The `DEVNEURAL_DATA_ROOT` env var is the override mechanism for portability.

### Function signature

```typescript
function loadConfig(dataRoot: string): Config
```

### Behavior

1. Determine the effective `data_root`:
   - If `process.env.DEVNEURAL_DATA_ROOT` is set and non-empty, use it
   - Otherwise use `DEFAULT_DATA_ROOT`

2. Attempt to read `<dataRoot>/config.json` synchronously using `fs.readFileSync`.

3. If the file does not exist (`ENOENT`), return defaults silently.

4. If the file exists but JSON parsing fails, log to stderr:
   ```
   [DevNeural] config parse error: <error.message>
   ```
   Then return defaults. Never throw.

5. If parsing succeeds, merge the parsed object over the defaults:
   - `allowlist`: use parsed value if present, otherwise default
   - `data_root`: use the env var override if set, else use parsed value if present, else default

6. Return the merged `Config` object.

### Error handling invariant

`loadConfig` must never throw. Any unexpected error should be caught and defaults returned. This is consistent with the whole data layer's "never interrupt Claude" contract.

---

## Notes for Implementer

- Use `fs.readFileSync` (synchronous) — this module is called at hook startup and the synchronous read keeps the code simple. The file is small (under 1 KB) and the sync penalty is negligible.
- Use `path.join(dataRoot, 'config.json')` — never string concatenation — for cross-platform path construction.
- The `data_root` field in `config.json` allows a user to relocate the data directory by editing the config. The env var takes precedence over the file field, allowing CI/test overrides without editing the file.
- Do not validate the contents of `allowlist` entries — accept any array of strings. Validation belongs in the consumer (hook-runner).
