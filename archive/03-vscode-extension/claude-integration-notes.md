# Integration Notes — Opus Review Feedback

## What I'm Integrating (and Why)

### 1. Acknowledge WeightsFile schema divergence (Sections 1.1, 1.2)
**Integrating as a prerequisite note in Part 1.**
The review correctly identifies that `WeightsFile` has diverged between the data layer (`schema_version`, `updated_at`) and API server (`version`, `last_updated`). This is pre-existing tech debt that is out of scope to fix here, but adding more fields on top of a mismatched schema is a footgun. I'm adding a reconciliation step in Part 1 that directs the implementer to align field names before adding `stage`/`tags`.

### 2. Move stage tags to a node-level source (Section 2)
**Integrating the architectural fix in Parts 1.2 and 1.3.**
Stage/tags belong to nodes (projects), not edges. Storing them in every edge record that touches a node is semantically wrong and creates the "which edge was last?" fragility. The fix: the API server's graph builder reads `devneural.json` directly from `localReposRoot` when building node objects, rather than reading tags from edge records. This means the data layer hook runner does NOT need to write stage/tags into `weights.json` at all — only the log entries get the enrichment.

### 3. Fix CSP `connect-src` directive (Section 3)
**Integrating the fix in Part 3.4.**
The `connect-src ws://` directive is wrong because the webview never opens a WebSocket. Replacing it with `connect-src https:` to allow the Hugging Face model download, consistent with the architecture where the extension host owns the WebSocket.

### 4. Flag voice as spike-required (Section 4)
**Integrating a "prerequisite spike" note in Part 8.**
The review identifies three genuine hard risks for Whisper-in-webview: microphone permissions in VS Code webviews are not guaranteed, bundle size is larger than estimated, and model cache persistence is unreliable. I'm keeping voice in the plan (user asked for it) but adding a mandatory spike section: a 30-line POC must confirm `getUserMedia` works in a VS Code webview before committing to the full implementation. If the spike fails, voice is deferred.

### 5. warmupTicks(150) freeze warning (Section 5)
**Integrating a loading indicator note in Part 4.2.**
150 synchronous warmup ticks can take 750ms–3s on larger graphs. Adding a loading state: the webview shows "Building graph..." until warmup completes and the first frame is rendered.

### 6. InstancedMesh color buffer management (Section 5)
**Integrating in Part 4.3.**
Adding explicit mention that `instanceColor.needsUpdate = true` must be called after any per-instance color mutation. This is a known Three.js footgun.

### 7. Stage badges as InstancedMesh, not individual Meshes (Section 5)
**Integrating in Part 4.3.**
Individual Mesh objects for badges defeat the instancing optimization. Changing to a fourth InstancedMesh (thin `TorusGeometry`) for stage badges, managed alongside the node type meshes.

### 8. Define maxAgeMs for recency fading (Section 5)
**Integrating in Part 5.2.**
Setting `maxAgeMs = 30 days (2_592_000_000ms)`. Within a healthy active graph, most edges will have recency scores near 0 (recently active). The 30-day window means edges not seen in 30+ days are at minimum opacity.

### 9. Specify opacity interaction between recency and breathing (Section 5)
**Integrating in Part 5.3.**
These are NOT multiplicative on the same channel. Recency fading reduces the edge's `material.opacity` (base transparency). Breathing modulates the edge's `material.emissiveIntensity` (glow). They operate on different material properties — no unintended compounding.

### 10. Update @xenova/transformers → @huggingface/transformers (Section 8)
**Integrating everywhere in the plan.**
`@xenova/transformers` (v2.x) is no longer maintained. Using `@huggingface/transformers` (v3+).

### 11. Correct webview bundle size estimate (Section 2)
**Integrating in Part 2.3.**
600-800KB was for Three.js only. With three-forcegraph + @huggingface/transformers runtime, the bundle is 3-5MB. Updating the estimate.

### 12. Explicit local path resolution algorithm (Sections 6, 9)
**Integrating in Parts 6 and 9.**
The algorithm: strip `project:` prefix from node ID to get the GitHub URL path (e.g., `github.com/user/repo`). Then resolve as `localReposRoot + "/" + repoName` where `repoName` is the last path segment. If the resolved path exists, use it. Otherwise fall back to the GitHub URL. Also noting: if `localReposRoot` is empty, skip the local path attempt and go straight to GitHub.

### 13. Explicit ephemeral edge defaults for connection:new (Section 6)
**Integrating in Part 5.1.**
The `connection:new` payload lacks weight/timestamps. Ephemeral edges default to: `weight: 1.0` (forces it to maximum brightness in relativistic color), `first_seen: now`, `last_seen: now`, `raw_count: 1`.

### 14. Graph size cap (Section 7)
**Integrating in Part 4.2 and Part 3.3.**
Hard limit: if the snapshot contains >500 nodes, show only the top 300 edges by weight plus their terminal nodes, and display a warning in the HUD. This prevents blocking warmup on large graphs. The workspaceState cache stores at most 500 edges.

### 15. Cross-component integration test (Section 9)
**Integrating in Part 10.**
Adding a cross-component smoke test: fires a real data layer hook event → verifies the API server broadcasts the enriched graph → confirms the extension relay chain works end-to-end (using a mock webview postMessage sink).

### 16. Remove vscode-messenger dependency
**Integrating in Parts 2 and 3.**
The message protocol is 5-6 fire-and-forget message types. A simple `switch(message.type)` in both the extension host and webview is cleaner and has zero extra bundle footprint. Removing `vscode-messenger` and `vscode-messenger-webview` from the dependency list.

---

## What I'm NOT Integrating (and Why)

### Visual regression testing
Out of scope for this phase. Requires a separate Playwright or screenshot-comparison infrastructure setup that would add significant scope. Deferred to a dedicated visual-testing phase.

### ConnectionType divergence fix (data layer vs API server)
Pre-existing tech debt between 01-data-layer (3 variants) and 02-api-server (4 variants). This is a cross-component alignment problem. I'm noting it but not including a fix here — it needs its own PR across both components. The extension only consumes the API server's type, so for this phase, the API server's 4-variant type is what the extension depends on.

### Specific devneural.json hook runner test cases (path traversal, permissions)
The review asks for explicit test cases for file-not-found, malformed JSON, symlinks, etc. These will be in the TDD plan as specific test stubs — they're implementation detail, not plan-level content.
