import type { IntentResult, IntentName } from '../intent/types';
import { fetchWithTimeout, GraphNode, GraphResponse, ApiClientConfig } from './api-client';

export interface IntentApiResult {
  intent: IntentName;
  data: unknown;
  resolvedNodeId?: string;
  entities: IntentResult['entities'];
}

/**
 * Resolve a human-readable label to a node ID (case-insensitive).
 * Returns null if no match found.
 */
export function resolveLabel(name: string, nodes: GraphNode[]): string | null {
  const needle = name.toLowerCase();
  for (const node of nodes) {
    if (node.label?.toLowerCase() === needle) {
      return node.id;
    }
  }
  return null;
}

/**
 * Execute the API request(s) for the given intent.
 * Returns null on unknown intent or if a required label cannot be resolved.
 */
export async function executeIntentRequest(
  intent: IntentResult,
  projectId: string,
  config: ApiClientConfig,
): Promise<IntentApiResult | null> {
  const { apiUrl, timeoutMs } = config;
  const base = apiUrl;

  switch (intent.intent) {
    case 'get_context': {
      const url = `${base}/graph/subgraph?project=${encodeURIComponent(projectId)}`;
      const data = await fetchWithTimeout(url, timeoutMs);
      if (data === null) return null;
      return { intent: intent.intent, data, entities: intent.entities };
    }

    case 'get_top_skills': {
      const url = `${base}/graph/top?limit=100`;
      const data = await fetchWithTimeout(url, timeoutMs);
      if (data === null) return null;
      return { intent: intent.intent, data, entities: intent.entities };
    }

    case 'get_connections': {
      if (intent.entities.nodeName) {
        // Two-request flow: resolve label then fetch node connections
        const graphData = await fetchWithTimeout(`${base}/graph`, timeoutMs) as GraphResponse | null;
        if (!graphData) return null;
        const nodes = graphData.nodes ?? [];
        const resolvedNodeId = resolveLabel(intent.entities.nodeName, nodes);
        if (!resolvedNodeId) return null;
        const url = `${base}/graph/node/${encodeURIComponent(resolvedNodeId)}`;
        const data = await fetchWithTimeout(url, timeoutMs);
        if (data === null) return null;
        return { intent: intent.intent, data, resolvedNodeId, entities: intent.entities };
      } else {
        const url = `${base}/graph/subgraph?project=${encodeURIComponent(projectId)}`;
        const data = await fetchWithTimeout(url, timeoutMs);
        if (data === null) return null;
        return { intent: intent.intent, data, entities: intent.entities };
      }
    }

    case 'get_node': {
      if (!intent.entities.nodeName) return null;
      const graphData = await fetchWithTimeout(`${base}/graph`, timeoutMs) as GraphResponse | null;
      if (!graphData) return null;
      const nodes = graphData.nodes ?? [];
      const resolvedNodeId = resolveLabel(intent.entities.nodeName, nodes);
      if (!resolvedNodeId) return null;
      const url = `${base}/graph/node/${encodeURIComponent(resolvedNodeId)}`;
      const data = await fetchWithTimeout(url, timeoutMs);
      if (data === null) return null;
      return { intent: intent.intent, data, resolvedNodeId, entities: intent.entities };
    }

    case 'get_stages': {
      const data = await fetchWithTimeout(`${base}/graph`, timeoutMs);
      if (data === null) return null;
      return { intent: intent.intent, data, entities: intent.entities };
    }

    case 'unknown':
    default:
      return null;
  }
}
