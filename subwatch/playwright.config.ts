// 画面のテスト（tests/e2e。Playwright）。npm run test:e2e
// webServer で Emulator（必ず --project demo-subwatch）と next dev を起動し、終わったら止める（Emulator は SIGINT で止める。止めないと java が残る）
// next dev は NEXT_PUBLIC_USE_MOCKS=false で起動する（仮データのまま動いているサーバーをテストしないため）
// このファイルは CommonJS として読まれるので import.meta を使わない
import { defineConfig, devices } from '@playwright/test';
import './tests/env';

const PORT = 3100; // ふだんの npm run dev（3000）とぶつからないように分ける

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000, // next dev は最初の表示が遅いので長め
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1, // Emulator のデータを共有するので1つずつ
  retries: 0,
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'firebase emulators:start --config ../firebase.json --project demo-subwatch --only auth,firestore',
      port: 8080,
      reuseExistingServer: false,
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGINT', timeout: 10_000 },
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `npx next dev -p ${PORT}`,
      url: `http://127.0.0.1:${PORT}/login`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { NEXT_PUBLIC_USE_MOCKS: 'false' },
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
