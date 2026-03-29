# devneural.json — Project Configuration Standard

Every project tracked by DevNeural must have a `devneural.json` at its root. This file is the canonical source of node-level metadata for the DevNeural orb visualization.

---

## What devneural.json Is

`devneural.json` is a small JSON file placed at the root of each tracked project. It tells the DevNeural API server how to identify, label, and stage the project in the connection graph. The API server scans `localReposRoot` for these files at startup and re-scans when they change.

---

## Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Human-readable display name shown as the node label in the orb |
| `localPath` | string (absolute) | yes | Absolute local filesystem path to the project root. Must begin with `/` (Unix) or a drive letter `X:/` or `X:\` (Windows). Relative paths are invalid. |
| `githubUrl` | string | yes | Canonical GitHub URL, e.g. `https://github.com/user/DevNeural` |
| `stage` | enum string | yes | One of: `alpha`, `beta`, `deployed`, `archived` |
| `tags` | string[] | yes | Array of zero or more tag values (see below). An empty array `[]` is valid. |
| `description` | string | yes | Short human-readable description of the project |

All six fields are required. Unknown extra fields are tolerated — the validator allows forward-compatible extension.

---

## Stage Values

| Value | Meaning |
|---|---|
| `alpha` | Early development, actively changing, incomplete |
| `beta` | Feature-complete but not production-hardened |
| `deployed` | Running in production or actively used |
| `archived` | No longer developed; historical record only |

The orb displays stage as a badge on the project node (TorusGeometry rendered by the rendering layer).

---

## Tag Values

| Value | Meaning |
|---|---|
| `revision-needed` | Known areas requiring rework; signals caution in the orb view |
| `sandbox` | Experimental or throwaway work; lower trust signal |

Tags can be combined: `["revision-needed", "sandbox"]` is valid. An empty array `[]` means no special status.

---

## Downstream Effects of Changes

When a `devneural.json` file is created, modified, or deleted:

1. The API server's file watcher detects the change and triggers a full `localReposRoot` re-scan.
2. The project registry is rebuilt: `GraphNode` objects are updated with new `stage`, `tags`, and `localPath` values.
3. The updated graph is broadcast via WebSocket to all connected extension clients.
4. The orb redraws the affected node with updated stage badge colors.

---

## How localPath Is Used

`localPath` enables the orb to open a project's local folder directly when a project node is clicked. The extension host receives the click event, reads `GraphNode.localPath`, and opens the folder using VS Code's `vscode.openFolder` command.

If `localPath` is absent from the `GraphNode` (e.g., the project was discovered by git remote only, not by a `devneural.json` scan), the extension falls back to opening the `githubUrl` in the browser.

---

## How githubUrl Is Used

`githubUrl` serves two purposes:

1. **Primary identifier**: The API server derives the canonical `GraphNode.id` (`project:github.com/user/repo`) from the GitHub URL. This links `devneural.json` metadata to the node that the data layer creates via git-remote discovery.
2. **Fallback navigation**: When `localPath` does not exist on disk or is absent, the orb opens this URL in the browser on node click.

---

## Validation

Validation is enforced at read time by `validateDevNeuralConfig` in `01-data-layer/src/schema/devneural-config.ts`. Malformed files are skipped with a warning logged to stderr — they are not silently ignored, and they do not crash the scan. A file is considered malformed if:

- Any required field is missing
- `stage` is not one of the four allowed values
- Any entry in `tags` is not a known tag value
- `localPath` is a relative path

---

## Example devneural.json

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
