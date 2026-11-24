// 土台の確認（画面）。後のタスクが入った後も成り立つ形にする：
// users の無い人（initialized: false）に「ホーム」が出ることは期待しない。mockApi の確かめには、画面が自分では呼ばないパス（/api/smoke-test）を使う
import { expect, test } from '@playwright/test';
import { callApi, expectNoHorizontalScroll, expectTapTargets, loginAsNewUser, mockApi } from './helpers';

test('S-02（ログイン画面）が開く', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1, name: 'ログイン' })).toBeVisible();
});

test('ログインしていないと、中の画面から S-02 へ移る', async ({ page }) => {
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login$/);
});

test('loginAsNewUser でログインでき、中の画面が開く（幅375pxで横スクロールなし・押せる大きさ44px以上）', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await loginAsNewUser(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: '設定' })).toBeVisible();
  await expect(page.getByRole('link', { name: '設定' })).toHaveAttribute('aria-current', 'page');
  await expectNoHorizontalScroll(page);
  await expectTapTargets(page);
});

test('mockApi の応答を api() が受け取る（回数と本文も記録する）', async ({ page }) => {
  await page.goto('/terms');
  const mock = await mockApi(page, 'POST', '/api/smoke-test', [{ data: { ok: 1 } }, { status: 204 }]);
  expect(await callApi(page, '/api/smoke-test', { method: 'POST', body: { a: 1 } })).toEqual({ ok: true, data: { ok: 1 } });
  expect(await callApi(page, '/api/smoke-test', { method: 'POST', body: { a: 2 } })).toEqual({ ok: true });
  expect(mock.calls()).toBe(2);
  expect(mock.bodies()).toEqual([{ a: 1 }, { a: 2 }]);
});

test('401 UNAUTHENTICATED では onApiGate が呼ばれ、503 と通信の失敗では呼ばれない', async ({ page }) => {
  await page.goto('/terms');
  await page.waitForFunction(() => window.__SUBWATCH_E2E__ !== undefined);
  await page.evaluate(() => {
    const w = window as unknown as { gateEvents: unknown[] };
    w.gateEvents = [];
    window.__SUBWATCH_E2E__!.onApiGate((event) => w.gateEvents.push(event));
  });
  await mockApi(page, 'GET', '/api/smoke-test', [
    { status: 401, error: { code: 'UNAUTHENTICATED', message: 'ログインしてください' } },
    { status: 503, error: { code: 'TEMPORARILY_UNAVAILABLE', message: '一時的に利用できません。時間をおいて再試行してください' } },
    'failure',
  ]);
  expect(await callApi(page, '/api/smoke-test')).toMatchObject({ ok: false, error: { status: 401, code: 'UNAUTHENTICATED' } });
  expect(await callApi(page, '/api/smoke-test')).toMatchObject({ ok: false, error: { status: 503, code: 'TEMPORARILY_UNAVAILABLE' } });
  expect(await callApi(page, '/api/smoke-test')).toMatchObject({ ok: false, error: { status: 0, code: 'NETWORK_ERROR' } });
  const events = await page.evaluate(() => (window as unknown as { gateEvents: unknown[] }).gateEvents);
  expect(events).toEqual([{ status: 401, code: 'UNAUTHENTICATED', method: 'GET', path: '/api/smoke-test' }]);
});

test('応答が無いとき、timeoutMs の時間で TIMEOUT になる（page.clock で30秒を進める）', async ({ page }) => {
  await page.clock.install();
  await page.goto('/terms');
  const mock = await mockApi(page, 'DELETE', '/api/smoke-test', 'noResponse');
  const pending = callApi(page, '/api/smoke-test', { method: 'DELETE', body: { confirmation: 'DELETE' }, timeoutMs: 30_000 });
  await expect.poll(() => mock.calls()).toBe(1); // 要求が届いてから進める（届く前に進めると、まだタイマーが無い）
  await page.clock.runFor(30_000);
  expect(await pending).toMatchObject({ ok: false, error: { status: 0, code: 'TIMEOUT' } });
});

test('クエリを書いた mockApi は、そのクエリのときだけ応答する', async ({ page }) => {
  await page.goto('/terms');
  await mockApi(page, 'GET', '/api/smoke-test', { data: 'すべて' });
  await mockApi(page, 'GET', '/api/smoke-test?month=2026-11', { data: '11月' });
  expect(await callApi(page, '/api/smoke-test?month=2026-11')).toEqual({ ok: true, data: '11月' });
  expect(await callApi(page, '/api/smoke-test?month=2026-12')).toEqual({ ok: true, data: 'すべて' });
});
