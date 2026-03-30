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
  weight: number;
  raw_count: number;
  first_seen: string;
  last_seen: string;
}

export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type WsMessage =
  | { type: 'graph:snapshot'; payload: GraphSnapshot }
  | {
      type: 'connection:new';
      payload: Pick<GraphEdge, 'id' | 'source' | 'target' | 'connection_type'> & {
        timestamp: string;
      };
    }
  | { type: 'voice:focus'; payload: { nodeId: string } }
  | { type: 'voice:highlight'; payload: { nodeIds: string[] } }
  | { type: 'voice:clear'; payload: Record<string, never> };

export type CachedSnapshot = GraphSnapshot; // edges already capped to 500
