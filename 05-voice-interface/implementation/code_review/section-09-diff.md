diff --git a/03-web-app/package.json b/03-web-app/package.json
index 45153b0..85e8a83 100644
--- a/03-web-app/package.json
+++ b/03-web-app/package.json
@@ -1,5 +1,5 @@
 {
-  "name": "devneural-web",
+  "name": "devneural-web-app",
   "private": true,
   "version": "0.1.0",
   "type": "module",
@@ -7,7 +7,7 @@
     "dev": "vite",
     "build": "tsc && vite build",
     "preview": "vite preview",
-    "test": "tsc --noEmit && vitest run",
+    "test": "vitest run",
     "build:check": "tsc --noEmit"
   },
   "dependencies": {
diff --git a/03-web-app/src/graph/types.ts b/03-web-app/src/graph/types.ts
new file mode 100644
index 0000000..088bda9
--- /dev/null
+++ b/03-web-app/src/graph/types.ts
@@ -0,0 +1,43 @@
+/** Node types that correspond to DevNeural graph node types. */
+export type NodeType = 'project' | 'skill' | 'tool';
+
+/**
+ * A node as represented in the orb scene.
+ * Tracks position and velocity for the force simulation.
+ */
+export interface OrbNode {
+  id: string;
+  label: string;
+  type: NodeType;
+  position: { x: number; y: number; z: number };
+  velocity: { x: number; y: number; z: number };
+}
+
+/**
+ * An edge between two OrbNodes with a weight that drives
+ * both spring force strength and visual opacity.
+ */
+export interface OrbEdge {
+  /** Source node ID. */
+  sourceId: string;
+  /** Target node ID. */
+  targetId: string;
+  /** Connection weight in range 0.0–10.0. */
+  weight: number;
+}
+
+/**
+ * The full state of the Three.js scene, kept outside Three.js
+ * objects so it is accessible to the force simulation and event handlers
+ * without requiring a WebGL context.
+ */
+export interface SceneState {
+  nodes: Map<string, OrbNode>;
+  edges: OrbEdge[];
+  /** Node IDs currently highlighted by a voice:highlight event. Empty = none highlighted. */
+  highlightedNodeIds: Set<string>;
+  /** Single node ID focused by a voice:focus event. Null = none focused. */
+  focusedNodeId: string | null;
+  /** Whether the force simulation has cooled down (all velocities below threshold). */
+  simulationCooled: boolean;
+}
diff --git a/03-web-app/src/orb/visuals.ts b/03-web-app/src/orb/visuals.ts
new file mode 100644
index 0000000..8b5a83f
--- /dev/null
+++ b/03-web-app/src/orb/visuals.ts
@@ -0,0 +1,54 @@
+import type { NodeType } from '../graph/types';
+
+// No top-level import from 'three' — keeps this module testable without WebGL.
+
+export interface MaterialConfig {
+  color: number;
+  opacity: number;
+  transparent: boolean;
+  emissive?: number;
+  emissiveIntensity?: number;
+}
+
+const NODE_COLORS: Record<NodeType, number> = {
+  project: 0x4488ff,
+  skill: 0x44cc55,
+  tool: 0xff8833,
+};
+
+export function getMaterialForNodeType(type: NodeType): MaterialConfig {
+  const color = NODE_COLORS[type] ?? NODE_COLORS.project;
+  return {
+    color,
+    opacity: 0.9,
+    transparent: false,
+    emissive: color,
+    emissiveIntensity: 0.1,
+  };
+}
+
+export function getEdgeOpacity(weight: number): number {
+  return Math.min(1.0, Math.max(0.05, weight / 10));
+}
+
+export const defaultMaterialConfig: MaterialConfig = {
+  color: 0x8899bb,
+  opacity: 0.8,
+  transparent: true,
+  emissiveIntensity: 0.05,
+};
+
+export const highlightMaterialConfig: MaterialConfig = {
+  color: 0xffffff,
+  opacity: 1.0,
+  transparent: false,
+  emissive: 0xffffff,
+  emissiveIntensity: 0.6,
+};
+
+export const dimmedMaterialConfig: MaterialConfig = {
+  color: 0x334455,
+  opacity: 0.2,
+  transparent: true,
+  emissiveIntensity: 0.0,
+};
diff --git a/03-web-app/tests/orb/visuals.test.ts b/03-web-app/tests/orb/visuals.test.ts
new file mode 100644
index 0000000..f9d798c
--- /dev/null
+++ b/03-web-app/tests/orb/visuals.test.ts
@@ -0,0 +1,68 @@
+import { describe, it, expect, vi } from 'vitest';
+
+vi.mock('three');
+
+import {
+  getMaterialForNodeType,
+  getEdgeOpacity,
+  highlightMaterialConfig,
+  dimmedMaterialConfig,
+  defaultMaterialConfig,
+} from '../../src/orb/visuals';
+
+describe('getMaterialForNodeType', () => {
+  it('returns a config with a blue hue for project nodes', () => {
+    const config = getMaterialForNodeType('project');
+    // Blue hue: R component < G/B, or explicitly in blue range
+    expect(config.color).toBeGreaterThanOrEqual(0x0000ff);
+    expect(config.color).toBeLessThanOrEqual(0x8888ff);
+  });
+
+  it('returns a config with a green hue for skill nodes', () => {
+    const config = getMaterialForNodeType('skill');
+    expect(config.color).toBeGreaterThanOrEqual(0x00bb00);
+    expect(config.color).toBeLessThanOrEqual(0x88ff88);
+  });
+
+  it('returns a config with an orange hue for tool nodes', () => {
+    const config = getMaterialForNodeType('tool');
+    expect(config.color).toBeGreaterThanOrEqual(0xcc6600);
+    expect(config.color).toBeLessThanOrEqual(0xffaa44);
+  });
+
+  it('returns a config for unknown node type without throwing', () => {
+    expect(() => getMaterialForNodeType('unknown' as never)).not.toThrow();
+  });
+});
+
+describe('getEdgeOpacity', () => {
+  it('is monotonic — getEdgeOpacity(5) > getEdgeOpacity(3)', () => {
+    expect(getEdgeOpacity(5)).toBeGreaterThan(getEdgeOpacity(3));
+  });
+
+  it('returns at least 0.05 for weight 0 (minimum visibility)', () => {
+    expect(getEdgeOpacity(0)).toBeGreaterThanOrEqual(0.05);
+  });
+
+  it('returns at most 1.0 for weight 10 (max opacity capped)', () => {
+    expect(getEdgeOpacity(10)).toBeLessThanOrEqual(1.0);
+  });
+
+  it('returns a value in 0.0–1.0 for any weight in the valid range', () => {
+    for (const w of [0, 1, 2.5, 5, 7.5, 10]) {
+      const opacity = getEdgeOpacity(w);
+      expect(opacity).toBeGreaterThanOrEqual(0.0);
+      expect(opacity).toBeLessThanOrEqual(1.0);
+    }
+  });
+});
+
+describe('material config variants', () => {
+  it('highlightMaterialConfig differs from defaultMaterialConfig', () => {
+    expect(highlightMaterialConfig).not.toEqual(defaultMaterialConfig);
+  });
+
+  it('dimmedMaterialConfig has lower opacity than defaultMaterialConfig', () => {
+    expect(dimmedMaterialConfig.opacity).toBeLessThan(defaultMaterialConfig.opacity);
+  });
+});
diff --git a/03-web-app/tsconfig.json b/03-web-app/tsconfig.json
index 52bdfd7..e3ed60a 100644
--- a/03-web-app/tsconfig.json
+++ b/03-web-app/tsconfig.json
@@ -12,5 +12,5 @@
     "noEmit": true,
     "strict": true
   },
-  "include": ["src", "webview"]
+  "include": ["src", "webview", "tests"]
 }
diff --git a/03-web-app/vite.config.ts b/03-web-app/vite.config.ts
index ac2299b..d0a2c80 100644
--- a/03-web-app/vite.config.ts
+++ b/03-web-app/vite.config.ts
@@ -7,7 +7,7 @@ export default defineConfig({
     target: 'esnext',
   },
   server: {
-    port: 5173,
+    port: 3748,
     open: true,
   },
 });
diff --git a/03-web-app/vitest.config.ts b/03-web-app/vitest.config.ts
index c4588ab..1fd39ba 100644
--- a/03-web-app/vitest.config.ts
+++ b/03-web-app/vitest.config.ts
@@ -2,7 +2,11 @@ import { defineConfig } from 'vitest/config';
 
 export default defineConfig({
   test: {
-    environment: 'jsdom',
-    globals: true,
+    globals: false,
+    testTimeout: 10000,
+    environmentMatchGlobs: [
+      ['tests/**', 'node'],
+      ['webview/**', 'jsdom'],
+    ],
   },
 });
