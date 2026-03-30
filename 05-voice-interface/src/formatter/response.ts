import path from 'path';
import type { IntentResult, IntentName } from '../intent/types';

const serverPath = path.resolve(__dirname, '../../../02-api-server/dist/server.js');

interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  connection_type?: string;
}

interface GraphNode {
  id: string;
  label?: string;
  type: string;
  stage?: string;
}

interface GraphResponse {
  nodes?: GraphNode[];
  edges: GraphEdge[];
}

interface NodeResponse {
  node: { id: string; label?: string; type: string; stage?: string };
  edges: GraphEdge[];
}

function extractLabel(nodeId: string): string {
  const afterColon = nodeId.includes(':') ? nodeId.split(':').slice(1).join(':') : nodeId;
  const segments = afterColon.split('/');
  const last = segments[segments.length - 1];
  return last.charAt(0).toUpperCase() + last.slice(1);
}

function joinList(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  const copy = [...names];
  const last = copy.pop()!;
  return `${copy.join(', ')}, and ${last}`;
}

function formatTopSkills(edges: GraphEdge[], limit: number): string {
  const skillEdges = edges.filter(
    e => e.target?.startsWith('skill:') || e.source?.startsWith('skill:'),
  );
  if (skillEdges.length === 0) {
    return "I didn't find any skill connections in your graph.";
  }

  const weightMap = new Map<string, number>();
  for (const e of skillEdges) {
    const skillId = e.target?.startsWith('skill:') ? e.target : e.source;
    weightMap.set(skillId, (weightMap.get(skillId) ?? 0) + e.weight);
  }

  const sorted = [...weightMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  const names = sorted.map(([id]) => extractLabel(id));
  if (names.length === 1) return `Your top skill is ${names[0]}.`;
  return `Your top skills are ${joinList(names)}.`;
}

function formatSubgraph(subgraph: GraphResponse): string {
  const edges = subgraph.edges ?? [];
  if (edges.length === 0) {
    return "I didn't find any connections matching that query.";
  }

  const skillCount = edges.filter(
    e => e.target?.startsWith('skill:') || e.source?.startsWith('skill:'),
  ).length;
  const toolCount = edges.filter(
    e => e.target?.startsWith('tool:') || e.source?.startsWith('tool:'),
  ).length;

  const parts: string[] = [];
  if (skillCount > 0) parts.push(`${skillCount} skill${skillCount === 1 ? '' : 's'}`);
  if (toolCount > 0) parts.push(`${toolCount} tool${toolCount === 1 ? '' : 's'}`);
  if (parts.length === 0) parts.push(`${edges.length} connection${edges.length === 1 ? '' : 's'}`);

  const nodes = subgraph.nodes ?? [];
  const projectNode = nodes.find(n => n.type === 'project');
  const label = projectNode
    ? (projectNode.label ?? extractLabel(projectNode.id))
    : 'This project';

  return `${label} connects to ${parts.join(' and ')}.`;
}

function formatNode(nodeResult: NodeResponse): string {
  const node = nodeResult.node;
  const label = node.label ?? extractLabel(node.id);
  const edges = nodeResult.edges ?? [];
  if (edges.length === 0) return `${label} has no connections in your graph.`;
  return `${label} is connected to ${edges.length} node${edges.length === 1 ? '' : 's'}.`;
}

function formatStages(graph: GraphResponse, stageFilter?: string): string {
  const nodes = (graph.nodes ?? []).filter(n => n.type === 'project');

  if (stageFilter) {
    const matching = nodes.filter(n => n.stage === stageFilter);
    if (matching.length === 0) {
      return `I didn't find any ${stageFilter} projects in your graph.`;
    }
    const names = matching.map(n => n.label ?? extractLabel(n.id));
    return `You have ${matching.length} ${stageFilter} project${matching.length === 1 ? '' : 's'}: ${joinList(names)}.`;
  }

  const groups = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    const stage = n.stage ?? 'untracked';
    if (!groups.has(stage)) groups.set(stage, []);
    groups.get(stage)!.push(n);
  }

  if (groups.size === 0) return "I didn't find any projects in your graph.";

  const sentences: string[] = [];
  for (const [stage, stageNodes] of groups) {
    if (sentences.length >= 5) break;
    const names = stageNodes.map(n => n.label ?? extractLabel(n.id));
    sentences.push(
      `You have ${stageNodes.length} ${stage} project${stageNodes.length === 1 ? '' : 's'}: ${joinList(names)}.`,
    );
  }
  return sentences.join(' ');
}

const HEDGING_LABELS: Partial<Record<IntentName, string>> = {
  get_context: 'your current context',
  get_top_skills: 'your top skills',
  get_connections: 'connections',
  get_node: 'a specific node',
  get_stages: 'project stages',
};

export function formatResponse(
  intent: IntentResult,
  apiResult: unknown,
  hedging: boolean,
): string {
  if (apiResult === null) {
    return `The DevNeural graph isn't running. Start it with: node ${serverPath}`;
  }

  let text: string;

  switch (intent.intent) {
    case 'get_top_skills': {
      const edges = Array.isArray(apiResult) ? (apiResult as GraphEdge[]) : [];
      text = formatTopSkills(edges, intent.entities.limit ?? 5);
      break;
    }

    case 'get_context': {
      text = formatSubgraph(apiResult as GraphResponse);
      break;
    }

    case 'get_connections': {
      const result = apiResult as (GraphResponse & { node?: unknown }) | NodeResponse;
      if (result && 'node' in result && result.node) {
        text = formatNode(result as NodeResponse);
      } else {
        text = formatSubgraph(result as GraphResponse);
      }
      break;
    }

    case 'get_node': {
      text = formatNode(apiResult as NodeResponse);
      break;
    }

    case 'get_stages': {
      text = formatStages(apiResult as GraphResponse, intent.entities.stageFilter);
      break;
    }

    case 'unknown':
    default:
      text = "I didn't understand that query. Could you rephrase it?";
      break;
  }

  if (hedging && intent.intent !== 'unknown') {
    const label = HEDGING_LABELS[intent.intent];
    if (label) text = `I think you're asking about ${label}. ${text}`;
  }

  return text;
}
