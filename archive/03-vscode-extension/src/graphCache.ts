import type { CachedSnapshot, GraphSnapshot } from './types';

export const CACHE_KEY = 'devneural.lastGraph';
export const MAX_CACHED_EDGES = 500;

export function readCachedSnapshot(
  workspaceState: { get<T>(key: string): T | undefined },
): CachedSnapshot | undefined {
  return workspaceState.get<CachedSnapshot>(CACHE_KEY);
}

export async function writeCachedSnapshot(
  workspaceState: { update(key: string, value: unknown): Thenable<void> },
  snapshot: GraphSnapshot,
): Promise<void> {
  const sorted = [...snapshot.edges].sort((a, b) => b.weight - a.weight);
  const capped: CachedSnapshot = {
    nodes: snapshot.nodes,
    edges: sorted.slice(0, MAX_CACHED_EDGES),
  };
  await workspaceState.update(CACHE_KEY, capped);
}
