import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import {
  mapInstanceToNodeId,
  deriveGitHubUrl,
  projectToScreen,
  createTooltip,
  handleNodeClick,
} from '../nodeActions';
import type { GraphNode, GraphEdge } from '../../src/types';

function makeNode(partial: Partial<GraphNode> & { id: string; type: GraphNode['type'] }): GraphNode {
  return { label: partial.id, ...partial };
}

function makeEdge(partial: Partial<GraphEdge> & { id: string; source: string; target: string }): GraphEdge {
  return {
    connection_type: 'project->tool',
    weight: 1,
    raw_count: 1,
    first_seen: '',
    last_seen: '',
    ...partial,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── mapInstanceToNodeId ───────────────────────────────────────────────────────

describe('mapInstanceToNodeId', () => {
  it('returns correct nodeId for a known instanceIndex', () => {
    const mesh = {} as THREE.InstancedMesh;
    const instanceMap = new Map([[0, 'node-1'], [1, 'node-2']]);
    expect(mapInstanceToNodeId(mesh, 0, instanceMap)).toBe('node-1');
    expect(mapInstanceToNodeId(mesh, 1, instanceMap)).toBe('node-2');
  });

  it('returns undefined when instanceIndex is out of bounds', () => {
    const mesh = {} as THREE.InstancedMesh;
    const instanceMap = new Map([[0, 'node-1']]);
    expect(mapInstanceToNodeId(mesh, 99, instanceMap)).toBeUndefined();
  });
});

// ── deriveGitHubUrl ───────────────────────────────────────────────────────────

describe('deriveGitHubUrl', () => {
  it('strips project: prefix and prepends https:// for github.com ids', () => {
    expect(deriveGitHubUrl('project:github.com/foo/bar')).toBe('https://github.com/foo/bar');
  });

  it('returns null for local-only ids', () => {
    expect(deriveGitHubUrl('project:local-only')).toBeNull();
  });

  it('passes through ids that already start with http', () => {
    expect(deriveGitHubUrl('project:https://example.com/repo')).toBe('https://example.com/repo');
  });
});

// ── handleNodeClick ───────────────────────────────────────────────────────────

describe('handleNodeClick — project node with GitHub URL', () => {
  it('calls window.open with the derived GitHub URL', () => {
    const openUrl = vi.fn();
    const tooltip = createTooltip();
    const cameraController = { onActiveProjectsChanged: vi.fn() };
    const node = makeNode({ id: 'project:github.com/foo/bar', type: 'project', label: 'FooBar' });

    handleNodeClick(node.id, node, [], { x: 0, y: 0 }, [], cameraController, tooltip, openUrl);

    expect(openUrl).toHaveBeenCalledWith('https://github.com/foo/bar', '_blank');
  });
});

describe('handleNodeClick — project node with no parseable URL', () => {
  it('shows info in tooltip and does not call window.open', () => {
    const openUrl = vi.fn();
    const tooltip = createTooltip();
    document.body.appendChild(tooltip.getElement());
    const node = makeNode({ id: 'project:local-only', type: 'project', label: 'LocalProject' });

    handleNodeClick(node.id, node, [], { x: 100, y: 50 }, [], { onActiveProjectsChanged: vi.fn() }, tooltip, openUrl);

    expect(openUrl).not.toHaveBeenCalled();
    expect(tooltip.getElement().style.display).not.toBe('none');
  });
});

describe('handleNodeClick — tool/skill node', () => {
  it('triggers focusOnConnected(nodeId) on camera controller', () => {
    const onActiveProjectsChanged = vi.fn();
    const tooltip = createTooltip();
    const node = makeNode({ id: 'tool:playwright', type: 'tool', label: 'playwright' });
    const connectedProjectIds = ['p1', 'p2'];

    handleNodeClick(node.id, node, connectedProjectIds, { x: 0, y: 0 }, [], { onActiveProjectsChanged }, tooltip, vi.fn());

    expect(onActiveProjectsChanged).toHaveBeenCalledWith(connectedProjectIds);
  });
});

// ── projectToScreen ───────────────────────────────────────────────────────────

describe('projectToScreen', () => {
  it('Hover tooltip is positioned at screen-space projection of node 3D position', () => {
    // Mock Vector3.project to return NDC (0,0) = canvas center
    vi.spyOn(THREE.Vector3.prototype, 'project').mockImplementation(function (this: THREE.Vector3) {
      this.set(0, 0, 0);
      return this;
    });

    const worldPos = new THREE.Vector3(100, 50, 30);
    const canvas = { clientWidth: 800, clientHeight: 600 } as HTMLCanvasElement;
    const mockCamera = {} as THREE.Camera;

    const result = projectToScreen(worldPos, mockCamera, canvas);

    // NDC (0,0) → screen center (400, 300) for 800×600 canvas
    expect(result.x).toBeCloseTo(400);
    expect(result.y).toBeCloseTo(300);
  });
});

// ── tooltip ───────────────────────────────────────────────────────────────────

describe('tooltip content', () => {
  it('shows label, type, connection count, and stage if present', () => {
    const tooltip = createTooltip();
    document.body.appendChild(tooltip.getElement());
    const node = makeNode({ id: 'p1', type: 'project', label: 'MyProject', stage: 'beta' });
    const edges = [
      makeEdge({ id: 'e1', source: 'p1', target: 't1' }),
      makeEdge({ id: 'e2', source: 's1', target: 'p1' }),
    ];

    tooltip.show(node, edges, 100, 100);
    const html = tooltip.getElement().innerHTML;

    expect(html).toContain('MyProject');
    expect(html).toContain('project');
    expect(html).toContain('2'); // 2 edges involving p1
    expect(html).toContain('beta');
  });
});

describe('tooltip hide', () => {
  it('is hidden on mouse-out', () => {
    const tooltip = createTooltip();
    document.body.appendChild(tooltip.getElement());
    const node = makeNode({ id: 'p1', type: 'project', label: 'Test' });

    tooltip.show(node, [], 100, 100);
    expect(tooltip.getElement().style.display).not.toBe('none');

    tooltip.hide();
    expect(tooltip.getElement().style.display).toBe('none');
  });
});
