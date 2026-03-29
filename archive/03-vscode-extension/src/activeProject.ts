import type { GraphNode } from './types';

/**
 * Returns node IDs for all project nodes whose localPath is a prefix of activeFilePath.
 * Returns [] if activeFilePath is undefined, empty, or no node has a matching localPath.
 */
export function detectActiveProjects(
  activeFilePath: string | undefined,
  nodes: GraphNode[],
): string[] {
  if (!activeFilePath) return [];

  return nodes
    .filter(n => n.type === 'project' && n.localPath && activeFilePath.startsWith(n.localPath + '/'))
    .map(n => n.id);
}
