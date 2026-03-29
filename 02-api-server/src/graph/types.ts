export type ConnectionType =
  | 'project->tool'
  | 'project->project'
  | 'project->skill'
  | 'tool->skill';

export interface WeightsFileEntry {
  source_node: string;
  target_node: string;
  connection_type: ConnectionType;
  raw_count: number;
  weight: number;
  first_seen: string;
  last_seen: string;
}

export interface WeightsFile {
  connections: Record<string, WeightsFileEntry>;
  last_updated: string;
  version: string;
}

export interface GraphNode {
  id: string;
  type: 'project' | 'tool' | 'skill';
  label: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  connection_type: ConnectionType;
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

export interface InMemoryGraph {
  /** O(1) lookup by node id */
  nodeIndex: Map<string, GraphNode>;
  /** All edges, sorted descending by weight at build time */
  edgeList: GraphEdge[];
  /** O(1) lookup by edge id (the "source||target" key) */
  edgeIndex: Map<string, GraphEdge>;
  /** Maps node id → list of edge ids the node participates in (as source or target) */
  adjacency: Map<string, string[]>;
}
