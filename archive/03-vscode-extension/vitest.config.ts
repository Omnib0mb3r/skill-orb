import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    alias: {
      // Map vscode to the hand-rolled mock so extension host unit tests
      // never attempt to load the real VS Code module outside of VS Code.
      vscode: join(__dirname, 'src/__mocks__/vscode.ts'),
    },
  },
});
