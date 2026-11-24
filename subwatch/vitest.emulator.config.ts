// API のテスト（tests/emulator。Auth と Firestore の Emulator を使う）。npm run test:emulator
// ファイルを並列に動かさない（resetEmulators() がほかのファイルのデータを消すため）
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  test: {
    include: ['tests/emulator/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/env.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
