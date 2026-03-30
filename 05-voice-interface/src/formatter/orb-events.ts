import type { IntentResult } from '../intent/types';

const API_URL = `http://localhost:${process.env.DEVNEURAL_PORT ?? '3747'}/voice/command`;

interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

interface GraphNode {
  id: string;
  type: string;
  stage?: string;
}

interface GraphResponse {
  nodes?: GraphNode[];
  edges: GraphEdge[];
}

interface NodeResponse {
  node: { id: string; type: string };
  edges: GraphEdge[];
}

async function postEvent(type: string, payload: unknown): Promise<void> {
  try {
    await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload }),
    });
  } catch {
    // Swallow all errors — orb events are best-effort
  }
}

export async function sendOrbEvents(
  intent: IntentResult,
  apiResult: unknown,
): Promise<void> {
  switch (intent.intent) {
    case 'get_context': {
      const subgraph = apiResult as GraphResponse;
      const nodes = subgraph?.nodes ?? [];
      const projectNode = nodes.find(n => n.type === 'project');
      const projectId = projectNode?.id ?? '';

      if (projectId) {
        await postEvent('voice:focus', { nodeId: projectId });
      }

      const adjacentIds = [...new Set(
        (subgraph?.edges ?? []).flatMap(e => [e.source, e.target]),
      )].filter(id => id !== projectId);

      await postEvent('voice:highlight', { nodeIds: adjacentIds });
      break;
    }

    case 'get_top_skills': {
      const edges = Array.isArray(apiResult) ? (apiResult as GraphEdge[]) : [];
      const skillIds = [...new Set(
        edges
          .filter(e => e.target?.startsWith('skill:') || e.source?.startsWith('skill:'))
          .map(e => e.target?.startsWith('skill:') ? e.target : e.source),
      )].slice(0, intent.entities.limit ?? 5);
      await postEvent('voice:highlight', { nodeIds: skillIds });
      break;
    }

    case 'get_connections':
    case 'get_node': {
      const result = apiResult as (NodeResponse & { node?: unknown }) | null;
      if (result && 'node' in result && result.node) {
        await postEvent('voice:focus', { nodeId: (result as NodeResponse).node.id });
      } else {
        await postEvent('voice:highlight', { nodeIds: [] });
      }
      break;
    }

    case 'get_stages': {
      const graph = apiResult as GraphResponse;
      const projectNodes = (graph?.nodes ?? []).filter(n => n.type === 'project');
      const stageFilter = intent.entities.stageFilter;
      const matchingIds = stageFilter
        ? projectNodes.filter(n => n.stage === stageFilter).map(n => n.id)
        : projectNodes.map(n => n.id);
      await postEvent('voice:highlight', { nodeIds: matchingIds });
      break;
    }

    case 'unknown':
    default:
      await postEvent('voice:clear', {});
      break;
  }
}
