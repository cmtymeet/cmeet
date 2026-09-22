import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const polyfills = () => nodePolyfills({ globals: { Buffer: true, global: true, process: true }, protocolImports: true });

export default defineConfig({
  root: resolve('tests'),
  plugins: [svelte(), polyfills()],
  resolve: {
    dedupe: ['@aztec/bb.js', '@noir-lang/noir_js'],
    alias: Object.fromEntries(['buffer', 'global', 'process'].map(name => {
      const specifier = `vite-plugin-node-polyfills/shims/${name}`;
      return [specifier, fileURLToPath(import.meta.resolve(specifier))];
    }))
  },
  worker: { format: 'es', plugins: () => [polyfills()] },
  optimizeDeps: { exclude: ['@aztec/bb.js'] },
  build: {
    target: 'esnext',
    outDir: process.env.CMEET_ENTRY_OUT_DIR || resolve('.ci-work/entry-dist'),
    emptyOutDir: true,
    rollupOptions: { input: { index: resolve('tests/entry.html') } }
  }
});
