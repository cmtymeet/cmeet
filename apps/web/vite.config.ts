import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
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
    include: ['tests/unit/**/*.test.ts'],
  },
});
