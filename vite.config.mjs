import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath } from 'node:url';

const polyfills = () => nodePolyfills({ exclude: ['fs', 'fs/promises'], globals: { Buffer: true, global: true, process: true }, protocolImports: true });

export default defineConfig({
  plugins: [svelte(), polyfills()],
  // The same ESM shim resolution passed the cfrm browser accounting fixture.
  // A CJS namespace in place of Buffer fails during msgpackr initialization.
  resolve: {
    dedupe: ['@aztec/bb.js', '@noir-lang/noir_js'],
    alias: Object.fromEntries(['buffer', 'global', 'process'].map(name => {
      const specifier = `vite-plugin-node-polyfills/shims/${name}`;
      return [specifier, fileURLToPath(import.meta.resolve(specifier))];
    })),
  },
  worker: { format: 'es', plugins: () => [polyfills()] },
  optimizeDeps: { exclude: ['@aztec/bb.js'] },
  build: { target: 'esnext', sourcemap: true },
  server: { host: '127.0.0.1' },
});
