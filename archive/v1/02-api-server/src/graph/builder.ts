import type { WeightsFile, InMemoryGraph, GraphNode, GraphEdge, ProjectRegistry } from './types.js';

// Tools that are ubiquitous and carry no signal about inter-project skill use
const EXCLUDED_TOOLS = new Set(['Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'NotebookEdit']);

/** Only accept project nodes that are real github.com repos. */
function isRealProject(nodeId: string): boolean {
  const path = nodeId.replace('project:', '');
  if (!path.startsWith('github.com/')) return false;
  if (path.includes('${')) return false;      // template strings
  if (path.includes('localhost')) return false;
  if (path.includes('raw.githubusercontent')) return false;
  return true;
}

/**
 * Collapse namespaced skill IDs to their root tool name so shared skills
 * appear as a single hub:
 *   skill:deep-plan:section-writer  → skill:deep-plan
 *   skill:deep-implement:code-reviewer → skill:deep-implement
 *   skill:gsd-planner → skill:gsd
 */
function normalizeSkillId(nodeId: string): string {
  const name = nodeId.replace(/^skill:/, '');
  const colon = name.indexOf(':');
  if (colon > 0) {
    return `skill:${name.slice(0, colon)}`;
  }
  // Collapse gsd-* sub-agents to skill:gsd
  if (name.startsWith('gsd-')) {
    return 'skill:gsd';
  }
  return nodeId;
}

/** Drop internal-build sections and meaningless skill placeholders. */
function isValidSkill(nodeId: string): boolean {
  const name = nodeId.replace(/^skill:/, '');
  if (/^section-\d+/.test(name)) return false;  // section-01, section-02, ...
  if (/^\d{2}-/.test(name)) return false;         // 02-api-server, 06-notebooklm, ...
  if (name === 'unknown-skill') return false;
  if (name === 'unknown') return false;
  return true;
}

function parseNode(id: string, registry?: ProjectRegistry): GraphNode {
  const colonIdx = id.indexOf(':');
  const prefix = id.slice(0, colonIdx);
  const label = id.slice(colonIdx + 1);
  const type = (prefix === 'project' || prefix === 'tool' || prefix === 'skill')
    ? prefix
    : 'skill';
  const node: GraphNode = { id, type, label };
  if (type === 'project' && registry) {
    const meta = registry.get(id);
    if (meta) {
      node.stage = meta.stage;
      node.tags = meta.tags;
      node.localPath = meta.localPath;
    }
  }
  return node;
}

export function buildGraph(weights: WeightsFile, registry?: ProjectRegistry): InMemoryGraph {
  const nodeIndex = new Map<string, GraphNode>();
  const edgeList: GraphEdge[] = [];
  const edgeIndex = new Map<string, GraphEdge>();
  const adjacency = new Map<string, string[]>();

  // Pass 1: collect all real github.com projects that appear as a source in any
  // connection. These always appear as nodes, even if their only edges are to
  // excluded tools (so a new project shows up in the orb immediately).
  // Also used to filter project→project edges: both endpoints must be active sources
  // to prevent URL-mentioned repos from appearing as ghost nodes.
  const activeProjects = new Set<string>();
  for (const entry of Object.values(weights.connections)) {
    if (entry.source_node.startsWith('project:') && isRealProject(entry.source_node)) {
      activeProjects.add(entry.source_node);
    }
  }

  // Pass 2: build the graph with filtering
  for (const [key, entry] of Object.entries(weights.connections)) {
    let src = entry.source_node;
    let tgt = entry.target_node;

    // ── Filter out noise ────────────────────────────────────────────────────

    // Drop excluded tools (Bash/Edit/Write etc.) appearing as either endpoint
    if (src.startsWith('tool:') && EXCLUDED_TOOLS.has(src.replace('tool:', ''))) continue;
    if (tgt.startsWith('tool:') && EXCLUDED_TOOLS.has(tgt.replace('tool:', ''))) continue;

    // Only allow real github.com project nodes
    if (src.startsWith('project:') && !isRealProject(src)) continue;
    if (tgt.startsWith('project:') && !isRealProject(tgt)) continue;

    // For project→project edges, both endpoints must be active (used as a source
    // elsewhere) — this filters out URL-mentioned repos that were never actually
    // the working context for Claude.
    if (entry.connection_type === 'project->project') {
      if (!activeProjects.has(src) || !activeProjects.has(tgt)) continue;
    }

    // Drop invalid/internal skill nodes
    if (src.startsWith('skill:') && !isValidSkill(src)) continue;
    if (tgt.startsWith('skill:') && !isValidSkill(tgt)) continue;

    // ── Normalize skill IDs ─────────────────────────────────────────────────
    if (src.startsWith('skill:')) src = normalizeSkillId(src);
    if (tgt.startsWith('skill:')) tgt = normalizeSkillId(tgt);

    // After normalization src === tgt would be a self-loop — skip it
    if (src === tgt) continue;

    // ── De-duplicate edges after normalization ──────────────────────────────
    const edgeKey = `${src}||${tgt}`;
    const existing = edgeIndex.get(edgeKey);
    if (existing) {
      existing.raw_count += entry.raw_count;
      existing.weight = Math.max(existing.weight, entry.weight);
      if (entry.last_seen > existing.last_seen) existing.last_seen = entry.last_seen;
      continue;
    }

    const edge: GraphEdge = {
      id: edgeKey,
      source: src,
      target: tgt,
      connection_type: entry.connection_type,
      raw_count: entry.raw_count,
      weight: entry.weight,
      first_seen: entry.first_seen,
      last_seen: entry.last_seen,
    };

    edgeList.push(edge);
    edgeIndex.set(edgeKey, edge);

    for (const nodeId of [src, tgt]) {
      if (!nodeIndex.has(nodeId)) {
        nodeIndex.set(nodeId, parseNode(nodeId, registry));
      }
      const adj = adjacency.get(nodeId);
      if (adj) {
        adj.push(edgeKey);
      } else {
        adjacency.set(nodeId, [edgeKey]);
      }
    }
  }

  // Pass 3: ensure every active project appears as a node even if all its edges
  // were filtered (e.g. only used Bash/Edit which are excluded tools).
  for (const projectId of activeProjects) {
    if (!nodeIndex.has(projectId)) {
      nodeIndex.set(projectId, parseNode(projectId, registry));
    }
  }

  edgeList.sort((a, b) => b.weight - a.weight);

  return { nodeIndex, edgeList, edgeIndex, adjacency };
}
