import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ObsidianSyncConfig, GraphInsight } from '../types.js';

interface Edge {
  source_node: string;
  target_node: string;
  weight: number;
  raw_count: number;
  first_seen: string;
  last_seen: string;
}

interface GraphResponse {
  nodes: Array<{ id: string; [key: string]: unknown }>;
  edges: Edge[];
}

// weights.json uses a connections object keyed by "source||target"
interface WeightsFile {
  schema_version?: number;
  connections: Record<string, Edge>;
}

const MILESTONE_COUNTS = new Set([10, 25, 50, 100]);

async function fetchEdgesFromApi(projectId: string, config: ObsidianSyncConfig): Promise<Edge[] | null> {
  try {
    const url = `${config.api_base_url}/graph/subgraph?project=${encodeURIComponent(projectId)}`;
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[graph-reader] API returned ${response.status}, falling back to file`);
      return null;
    }
    const data = (await response.json()) as GraphResponse;
    const prefixed = `project:${projectId}`;
    // Filter client-side to match the project, consistent with the file fallback
    return (data.edges ?? []).filter(
      e =>
        e.source_node === projectId ||
        e.source_node === prefixed ||
        e.target_node === projectId ||
        e.target_node === prefixed,
    );
  } catch (err) {
    console.warn(`[graph-reader] API fetch failed: ${(err as Error).message}, falling back to file`);
    return null;
  }
}

function loadEdgesFromFile(projectId: string, config: ObsidianSyncConfig): Edge[] | null {
  try {
    const weightsPath = join(config.data_root, 'weights.json');
    const raw = readFileSync(weightsPath, { encoding: 'utf-8' });
    const data = JSON.parse(raw) as WeightsFile;
    const prefixed = `project:${projectId}`;
    return Object.values(data.connections).filter(
      e =>
        e.source_node === projectId ||
        e.source_node === prefixed ||
        e.target_node === projectId ||
        e.target_node === prefixed,
    );
  } catch (err) {
    console.warn(`[graph-reader] Failed to read weights.json: ${(err as Error).message}`);
    return null;
  }
}

function classifyEdges(edges: Edge[], date: string): GraphInsight[] {
  const insights: GraphInsight[] = [];

  // new_connection: first_seen date portion equals date
  for (const edge of edges) {
    if (edge.first_seen.startsWith(date)) {
      insights.push({
        type: 'new_connection',
        source_node: edge.source_node,
        target_node: edge.target_node,
        weight: edge.weight,
        raw_count: edge.raw_count,
        description: `New connection: ${edge.source_node} → ${edge.target_node}`,
      });
    }
  }

  // high_weight: top 3 edges by weight descending
  // Note: may overlap with new_connection — acceptable per spec
  const sorted = [...edges].sort((a, b) => b.weight - a.weight);
  for (const edge of sorted.slice(0, 3)) {
    insights.push({
      type: 'high_weight',
      source_node: edge.source_node,
      target_node: edge.target_node,
      weight: edge.weight,
      raw_count: edge.raw_count,
      description: `Strong connection (weight ${edge.weight.toFixed(2)}): ${edge.source_node} → ${edge.target_node}`,
    });
  }

  // weight_milestone: last_seen date matches AND raw_count is a milestone value
  // Note: approximate — an edge at a milestone count touched again today may be a false positive
  for (const edge of edges) {
    if (edge.last_seen.startsWith(date) && MILESTONE_COUNTS.has(edge.raw_count)) {
      insights.push({
        type: 'weight_milestone',
        source_node: edge.source_node,
        target_node: edge.target_node,
        weight: edge.weight,
        raw_count: edge.raw_count,
        description: `Milestone: ${edge.source_node} → ${edge.target_node} reached ${edge.raw_count} uses`,
      });
    }
  }

  return insights;
}

export async function extractGraphInsights(
  projectId: string,
  date: string,
  config: ObsidianSyncConfig,
): Promise<GraphInsight[]> {
  let edges = await fetchEdgesFromApi(projectId, config);

  if (edges === null) {
    edges = loadEdgesFromFile(projectId, config);
  }

  if (edges === null) {
    return [];
  }

  return classifyEdges(edges, date);
}
