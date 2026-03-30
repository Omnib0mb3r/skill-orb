diff --git a/06-notebooklm-integration/.gitignore b/06-notebooklm-integration/.gitignore
new file mode 100644
index 0000000..2aa0532
--- /dev/null
+++ b/06-notebooklm-integration/.gitignore
@@ -0,0 +1,4 @@
+node_modules/
+dist/
+config.json
+*.js.map
diff --git a/06-notebooklm-integration/config.example.json b/06-notebooklm-integration/config.example.json
new file mode 100644
index 0000000..889c011
--- /dev/null
+++ b/06-notebooklm-integration/config.example.json
@@ -0,0 +1,8 @@
+{
+  "vault_path": "/absolute/path/to/your/obsidian/vault",
+  "notes_subfolder": "DevNeural/Projects",
+  "data_root": "/absolute/path/to/devneural/data",
+  "api_base_url": "http://localhost:3747",
+  "prepend_sessions": true,
+  "claude_model": "claude-haiku-4-5-20251001"
+}
diff --git a/06-notebooklm-integration/package.json b/06-notebooklm-integration/package.json
new file mode 100644
index 0000000..5c40d09
--- /dev/null
+++ b/06-notebooklm-integration/package.json
@@ -0,0 +1,21 @@
+{
+  "name": "devneural-obsidian-sync",
+  "version": "0.1.0",
+  "private": true,
+  "type": "module",
+  "scripts": {
+    "build": "tsc",
+    "dev": "tsx src/generate-summary.ts",
+    "test": "vitest run"
+  },
+  "dependencies": {
+    "@anthropic-ai/sdk": "^0.24.0",
+    "zod": "^3.23.0"
+  },
+  "devDependencies": {
+    "@types/node": "^22.0.0",
+    "tsx": "^4.19.0",
+    "typescript": "^5.7.0",
+    "vitest": "^2.1.0"
+  }
+}
diff --git a/06-notebooklm-integration/tests/fixtures/sample-session.jsonl b/06-notebooklm-integration/tests/fixtures/sample-session.jsonl
new file mode 100644
index 0000000..2e789ee
--- /dev/null
+++ b/06-notebooklm-integration/tests/fixtures/sample-session.jsonl
@@ -0,0 +1,7 @@
+{"timestamp":"2026-03-30T10:00:00Z","project":"github.com/Omnib0mb3r/DevNeural","source_node":"project:github.com/Omnib0mb3r/DevNeural","target_node":"tool:Read","connection_type":"project->tool","tool_name":"Read","stage":"post","tags":[],"tool_input":{"file_path":"/src/types.ts"}}
+{"timestamp":"2026-03-30T10:05:00Z","project":"github.com/Omnib0mb3r/DevNeural","source_node":"project:github.com/Omnib0mb3r/DevNeural","target_node":"skill:deep-plan","connection_type":"project->skill","tool_name":"Skill","stage":"post","tags":[],"tool_input":{"path":"/skills/deep-plan.md"}}
+{"timestamp":"2026-03-30T10:10:00Z","project":"github.com/Omnib0mb3r/DevNeural","source_node":"project:github.com/Omnib0mb3r/DevNeural","target_node":"project:github.com/Omnib0mb3r/skill-connections","connection_type":"project->project","tool_name":"Read","stage":"post","tags":[],"tool_input":{"file_path":"/data/graph.json"}}
+{"timestamp":"2026-03-30T10:15:00Z","project":"github.com/Omnib0mb3r/DevNeural","source_node":"tool:Bash","target_node":"skill:gsd-execute","connection_type":"tool->skill","tool_name":"Bash","stage":"post","tags":[],"tool_input":{"command":"npm test"}}
+{"timestamp":"2026-03-30T10:20:00Z","project":"github.com/Omnib0mb3r/skill-connections","source_node":"project:github.com/Omnib0mb3r/skill-connections","target_node":"tool:Grep","connection_type":"project->tool","tool_name":"Grep","stage":"post","tags":[],"tool_input":{"pattern":"LogEntry"}}
+{"timestamp":"2026-03-30T10:30:00Z","project":"github.com/Omnib0mb3r/DevNeural","source_node":"project:github.com/Omnib0mb3r/DevNeural","target_node":"tool:Edit","connection_type":"project->tool","tool_name":"Edit","stage":"post","tags":[],"tool_input":{"file_path":"/src/config.ts"}}
+{"timestamp":"2026-03-30T10:45:00Z","project":"github.com/Omnib0mb3r/DevNeural","source_node":"project:github.com/Omnib0mb3r/DevNeural","target_node":"skill:superpowers","connection_type":"project->skill","tool_name":"Skill","stage":"post","tags":[],"tool_input":{"path":"/skills/superpowers.md"}}
diff --git a/06-notebooklm-integration/tests/fixtures/sample-weights.json b/06-notebooklm-integration/tests/fixtures/sample-weights.json
new file mode 100644
index 0000000..1fea1a5
--- /dev/null
+++ b/06-notebooklm-integration/tests/fixtures/sample-weights.json
@@ -0,0 +1,44 @@
+{
+  "edges": [
+    {
+      "source_node": "project:github.com/Omnib0mb3r/DevNeural",
+      "target_node": "tool:Read",
+      "weight": 0.95,
+      "raw_count": 50,
+      "first_seen": "2026-03-01",
+      "last_seen": "2026-03-30"
+    },
+    {
+      "source_node": "project:github.com/Omnib0mb3r/DevNeural",
+      "target_node": "tool:Edit",
+      "weight": 0.88,
+      "raw_count": 38,
+      "first_seen": "2026-03-05",
+      "last_seen": "2026-03-29"
+    },
+    {
+      "source_node": "project:github.com/Omnib0mb3r/DevNeural",
+      "target_node": "tool:Bash",
+      "weight": 0.75,
+      "raw_count": 25,
+      "first_seen": "2026-03-10",
+      "last_seen": "2026-03-30"
+    },
+    {
+      "source_node": "project:github.com/Omnib0mb3r/DevNeural",
+      "target_node": "skill:deep-plan",
+      "weight": 0.42,
+      "raw_count": 10,
+      "first_seen": "2026-03-30",
+      "last_seen": "2026-03-30"
+    },
+    {
+      "source_node": "project:github.com/Omnib0mb3r/skill-connections",
+      "target_node": "tool:Grep",
+      "weight": 0.30,
+      "raw_count": 8,
+      "first_seen": "2026-03-15",
+      "last_seen": "2026-03-28"
+    }
+  ]
+}
diff --git a/06-notebooklm-integration/tsconfig.json b/06-notebooklm-integration/tsconfig.json
new file mode 100644
index 0000000..be9a5bf
--- /dev/null
+++ b/06-notebooklm-integration/tsconfig.json
@@ -0,0 +1,17 @@
+{
+  "compilerOptions": {
+    "target": "ES2022",
+    "lib": ["ES2022"],
+    "module": "NodeNext",
+    "moduleResolution": "NodeNext",
+    "outDir": "./dist",
+    "rootDir": "./src",
+    "strict": true,
+    "esModuleInterop": true,
+    "skipLibCheck": true,
+    "sourceMap": true,
+    "declaration": true
+  },
+  "include": ["src/**/*"],
+  "exclude": ["node_modules", "dist", "tests"]
+}
diff --git a/06-notebooklm-integration/vitest.config.ts b/06-notebooklm-integration/vitest.config.ts
new file mode 100644
index 0000000..66be301
--- /dev/null
+++ b/06-notebooklm-integration/vitest.config.ts
@@ -0,0 +1,9 @@
+import { defineConfig } from 'vitest/config';
+
+export default defineConfig({
+  test: {
+    include: ['tests/**/*.test.ts'],
+    environment: 'node',
+    passWithNoTests: true,
+  },
+});
