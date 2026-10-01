import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  base: './',
  server: {
    // Views and tests import the workspace-local ui/ and core/ sources.
    fs: { allow: [workspaceRoot] },
  },
  resolve: {
    // Component tests mount Svelte in jsdom: resolve the browser build.
    conditions: ['browser', 'module', 'import', 'default'],
  },
  build: { target: 'esnext', sourcemap: true },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1', port: 4173 },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
  },
});
