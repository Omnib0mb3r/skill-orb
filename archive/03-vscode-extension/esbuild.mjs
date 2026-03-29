import { build } from 'esbuild';

const production = process.argv.includes('--production');

const sharedConfig = {
  bundle: true,
  sourcemap: !production,
  minify: production,
};

await Promise.all([
  // Extension host bundle
  build({
    ...sharedConfig,
    entryPoints: ['src/extension.ts'],
    format: 'cjs',
    platform: 'node',
    external: ['vscode'],
    outfile: 'dist/extension.js',
  }),
  // Webview bundle
  build({
    ...sharedConfig,
    entryPoints: ['webview/main.ts'],
    format: 'iife',
    platform: 'browser',
    outfile: 'dist/webview.js',
  }),
]);
