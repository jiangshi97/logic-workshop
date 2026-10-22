import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: '/logic-workshop/',
  plugins: [react()],
  resolve: {
    alias: {
      digitaljs: fileURLToPath(new URL('./node_modules/digitaljs/src/circuit.mjs', import.meta.url)),
      '@joint/core': fileURLToPath(new URL('./node_modules/@joint/core/joint.mjs', import.meta.url)),
      'logic-level-api': fileURLToPath(new URL('./packages/level-api/src/index.ts', import.meta.url)),
    },
  },
  test: { include: ['tests/*.test.ts'], server: { deps: { inline: ['digitaljs', '@joint/core', '@joint/layout-directed-graph'] } } },
});
