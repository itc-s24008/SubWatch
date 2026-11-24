// 単体テスト（tests/unit）。npm test
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' }, // .tsx の部品を読み込むテストのため
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/env.ts'],
    environment: 'node',
  },
});
