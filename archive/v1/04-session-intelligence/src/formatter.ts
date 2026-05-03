interface GraphNode {
  id: string;
  type: 'project' | 'tool' | 'skill';
  label: string;
  stage?: string;
  tags?: string[];
  localPath?: string;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  connection_type: string;
  raw_count: number;
  weight: number;
  first_seen: string;
  last_seen: string;
}

interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  updated_at: string;
}

export interface FormatterConfig {
  maxResultsPerType: number;
  minWeight: number;
}

function relativeTime(isoDate: string): string {
  if (!isoDate) return 'unknown';
  const lastSeen = new Date(isoDate);
  if (isNaN(lastSeen.getTime())) return 'unknown';
  const now = new Date();
  const diffDays = Math.max(0, Math.floor((now.getTime() - lastSeen.getTime()) / (1000 * 60 * 60 * 24)));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 14) return '1 week ago';
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 60) return '1 month ago';
  return `${Math.floor(diffDays / 30)} months ago`;
}

function resolveLabel(targetId: string, nodeMap: Map<string, GraphNode>): string {
  if (!targetId) return '(unknown)';
  const node = nodeMap.get(targetId);
  if (node) return node.label;
  const colonIdx = targetId.indexOf(':');
  return colonIdx >= 0 ? targetId.slice(colonIdx + 1) : targetId;
}

export function formatSubgraph(
  projectId: string,
  response: GraphResponse,
  config: FormatterConfig,
): string {
  const sourceId = `project:${projectId}`;

  const filtered = response.edges.filter(
    (e) =>
      e.source === sourceId &&
      (e.connection_type === 'project->skill' || e.connection_type === 'project->project') &&
      e.weight >= config.minWeight,
  );

  const skillEdges = filtered
    .filter((e) => e.connection_type === 'project->skill')
    .sort((a, b) => b.weight - a.weight)
    .slice(0, config.maxResultsPerType);

  const projectEdges = filtered
    .filter((e) => e.connection_type === 'project->project')
    .sort((a, b) => b.weight - a.weight)
    .slice(0, config.maxResultsPerType);

  if (skillEdges.length === 0 && projectEdges.length === 0) {
    return 'No significant connections found for this project yet.';
  }

  const nodeMap = new Map<string, GraphNode>(response.nodes.map((n) => [n.id, n]));
  const lines: string[] = [`DevNeural Context for ${projectId}:`, ''];

  if (skillEdges.length > 0) {
    lines.push('  Skills (top connections):');
    for (const edge of skillEdges) {
      const label = resolveLabel(edge.target, nodeMap);
      const rel = relativeTime(edge.last_seen);
      lines.push(
        `    • ${label} (${edge.weight.toFixed(1)}/10, ${edge.raw_count} uses) — ${rel}`,
      );
    }
    lines.push('');
  }

  if (projectEdges.length > 0) {
    lines.push('  Related Projects:');
    for (const edge of projectEdges) {
      const label = resolveLabel(edge.target, nodeMap);
      const rel = relativeTime(edge.last_seen);
      lines.push(
        `    • ${label} (${edge.weight.toFixed(1)}/10, ${edge.raw_count} uses) — last connected ${rel}`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}
