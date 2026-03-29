# Interview Transcript — 03-vscode-extension

## Q1: Node visual differentiation and full orb vision

**Question:** How should node types be visually differentiated?

**Answer (detailed design note):**

The overall structure is a sphere — like a white orb — with nodes clustered on the surface and connection lines radiating inward and across. DevNeural itself is anchored at the center of the orb.

Node shapes are differentiated by type:
- **Projects**: small file icons (tiny rectangles like sheets of paper)
- **Tools**: cube or gear shape
- **Skills**: octahedron or diamond shape

Shape tells you what type at a glance.

Connection strength and color are **relativistic** — always relative to the current distribution of all connection weights. The strongest connections at any given moment are warm orange/red, medium are cyan/green, and the weakest are cool blue. As usage patterns shift over time, colors dynamically rebalance across the entire orb. Nothing is permanently any color.

When a path is actively being used, updated, or worked on, that connection glows brightly to indicate live activity. Newer connections appear more vivid; older less-used ones fade slightly over time. The orb is alive — connections pulse, glow, and breathe in real time as data updates.

Each project node carries one or more development stage tags stored in `devneural.json` at the project root. Primary stages: alpha, beta, deployed, or archived. Secondary tag: "revision needed" can be paired with any primary stage. A "sandbox" tag indicates R&D or exploratory work. Tags stack — a project can be `beta + revision needed + sandbox` simultaneously. The hook logger reads `devneural.json` on each invocation and pulls stage tags into the connection data automatically. Tags are visually indicated on nodes as subtle badges or rings that don't interfere with the connection color system.

Camera behavior is context-aware: if one project is active, the orb automatically focuses on that project and its connections. If multiple projects are active, the camera zooms out to keep all active projects in frame. If nothing is active, the full sphere is shown zoomed out. Manual controls always override automatic behavior.

Interaction feels like Google Earth: smooth zoom toward any node reveals file detail and content. Hovering over a node shows a tooltip with the file name, project, connection count, and stage tags. Clicking a connection highlights all related interconnections.

Nodes are actionable: clicking a project node opens it in VS Code. Clicking a skill or tool node shows all projects that use it. From any node you can jump directly to the GitHub repo for that project.

Nodes and connections are fully searchable and reverse-searchable. Search results pulse or highlight distinctly to stand out.

The orb has two control modes: automatic (camera and animation respond to active sessions and searches) and manual (zoom, pan, rotate freely like Google Earth).

Performance: use instanced meshes and level-of-detail rendering to stay smooth with hundreds of nodes.

A minimal HUD overlay shows what each shape, color, and tag badge means.

**IMPORTANT pre-work requirement:** Before implementing the visualization, review the existing DevNeural codebase and make any updates needed to support the schema changes. This includes updating the data layer, weights schema, hook logger, and any relevant types to support project-level metadata. Add a standard `devneural.json` config file spec that should live in every project root, and a `devneural.md` that explains the schema to both Claude and VS Code. These standards need to be defined and documented before visualization work begins.

---

## Q2: Schema scope in this plan

**Question:** You mentioned schema changes need to happen before the visualization. How should this be scoped?

**Answer:** Include schema changes as early sections in this plan, and redo any required TDD for changed components.

---

## Q3: Local folder structure and node actions

**Question:** Does the user have a structured local directory for node path resolution?

**Answer:** Yes. The `devneural.json` config file and `devneural.md` enforce a local folder hierarchy that aligns with git structure. The devneural.json spec will define where projects live locally, making local path resolution deterministic from node IDs.

---

## Q4: Voice scope — 03-extension vs 05-voice-interface

**Question:** What does 'preliminary voice' mean for this extension vs the full section 05 voice component?

**Answer:** Full voice implementation in section 03 (not a stub). Section 05 is a different, deeper voice component (likely AI assistant layer, multi-turn, etc.).

**Critical requirement:** Voice must work **offline** — when internet is down, the orb should still respond to voice queries about the static data on the orb and local PC information. Local speech recognition is required (not dependent on a cloud API).

---

## Q5: Panel persistence across VS Code restarts

**Question:** Should the orb panel persist across VS Code restarts?

**Answer:** Yes — restore the panel and last graph state on restart using `onWebviewPanel` activation event + serialized graph state in `ExtensionContext.workspaceState`.

---

## Q6: Animation for connection:new events

**Question:** How long should the pulse/glow animation last on a connection:new event?

**Answer:** Permanent until the next graph:snapshot arrives. Recently-fired connections stay highlighted until the graph is rebuilt.

---

## Key Design Decisions (Summary)

| Decision | Choice |
|---|---|
| Visualization structure | Sphere/orb with nodes on surface, DevNeural at center |
| Node type encoding | Shape: file icon (project), cube/gear (tool), octahedron/diamond (skill) |
| Edge color encoding | Relativistic strength: orange/red (strong), cyan/green (medium), cool blue (weak) |
| Active connection indicator | Glow brighter; stays until next graph:snapshot |
| Stage tags | devneural.json per project; alpha/beta/deployed/archived/revision-needed/sandbox; shown as badges/rings |
| Camera behavior | Context-aware auto-focus; manual override (Google Earth style) |
| Search | Text query in HUD; results pulse/highlight |
| Voice | Offline-capable (WebAssembly Whisper); full implementation; section 05 = deeper AI voice layer |
| Node actions | Open project in VS Code; show using-projects for tools/skills; GitHub link |
| Panel persistence | Yes — workspaceState serialization + onWebviewPanel activation |
| WebSocket architecture | Extension host owns WS connection; relays to webview via postMessage |
| Three.js library | three-forcegraph (extends Object3D, plugs into owned scene) |
| Bundler | esbuild: CJS bundle for extension host, IIFE/browser bundle for webview |
| Schema pre-work | devneural.json spec + update 01-data-layer + 02-api-server FIRST, then visualization |
