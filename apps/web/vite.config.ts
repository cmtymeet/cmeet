import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { pwaShellPlugin } from './build/pwa.js';

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  plugins: [svelte(), pwaShellPlugin()],
  base: './',
  server: {
    host: '127.0.0.1',
    // Views and tests import the workspace-local ui/ and core/ sources.
    fs: { allow: [workspaceRoot] },
  },
  resolve: {
    // Component tests mount Svelte in jsdom: resolve the browser build.
    conditions: ['browser', 'module', 'import', 'default'],
  },
  build: { target: 'esnext', sourcemap: false },
  preview: { host: '127.0.0.1', port: 4173 },
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/unit/platform.ts'],
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      allowExternal: true,
      reportOnFailure: true,
      reportsDirectory: './coverage',
      reporter: ['text', 'json', 'json-summary', 'lcov'],
      // allowExternal makes the provider match absolute source paths.
      include: ['ui/src/**/*.svelte', 'ui/src/**/*.ts', 'core/src/**/*.ts'].map((path) => resolve(workspaceRoot, path)),
      extension: ['.ts', '.svelte'],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
