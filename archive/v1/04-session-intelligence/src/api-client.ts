export interface GraphNode {
  id: string;
  type: 'project' | 'tool' | 'skill';
  label: string;
  stage?: string;
  tags?: string[];
  localPath?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  connection_type: string;
  raw_count: number;
  weight: number;
  first_seen: string;
  last_seen: string;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  updated_at: string;
}

export interface ApiClientConfig {
  apiUrl: string;
  timeoutMs: number;
}

export function buildApiConfig(): ApiClientConfig {
  if (process.env.DEVNEURAL_API_URL) {
    return { apiUrl: process.env.DEVNEURAL_API_URL, timeoutMs: 5000 };
  }
  return {
    apiUrl: `http://localhost:${process.env.DEVNEURAL_PORT ?? '3747'}`,
    timeoutMs: 5000,
  };
}

export async function fetchSubgraph(
  projectId: string,
  config: ApiClientConfig,
): Promise<GraphResponse | null> {
  try {
    const url = `${config.apiUrl}/graph/subgraph?project=${encodeURIComponent(projectId)}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!response.ok) return null;
    const data = await response.json() as GraphResponse;
    return data;
  } catch {
    return null;
  }
}
