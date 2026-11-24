// S-09 ④〜⑦（PushSection・NotificationTiming）と、Push の購読の後始末の画面テスト（04-12）
// テスト一覧の No.63（Push の部分）・64 と、番号なしの④の失敗・許可・非対応・ログアウト・manifest など
// ブラウザの pushManager・Service Worker・通知の許可は page.addInitScript で偽物に差し替える（本物の Push サービスに通信しない。決まりの一覧 C-9）
import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { accountResponse, callApi, expectNoHorizontalScroll, expectTapTargets, loginAsNewUser, mockApi } from './helpers';

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/e2e-existing-endpoint';
const STATUS = {
  checking: '確認中…',
  on: 'この端末で受け取る：オン',
  off: 'この端末で受け取る：オフ',
  unsupported: 'この環境では利用できません',
  denied: '許可されていません',
};

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

interface FakePushOptions {
  endpoint?: string | null; // 最初からブラウザにある購読（無ければ null）
  permission?: NotificationPermission; // 最初の通知の許可
  answer?: NotificationPermission; // 許可を求めたときの答え（'default' はダイアログを閉じただけ）
  iphone?: boolean; // ホーム画面に追加していない iPhone（PushManager が無い）
}

interface FakePushState {
  unsubscribeCalls: number;
  subscribeCalls: number;
  registerCalls: number;
  permission: NotificationPermission;
}

// ブラウザの Push を偽物にする。購読は sessionStorage に残し、開き直しても同じ購読がある（本物のブラウザと同じ）
async function installFakePush(page: Page, options: FakePushOptions = {}): Promise<void> {
  await page.addInitScript((cfg: FakePushOptions) => {
    const KEY = '__fakePushEndpoint';
    const w = window as unknown as Record<string, unknown>;
    if (cfg.endpoint && sessionStorage.getItem('__fakePushInit') === null) {
      sessionStorage.setItem('__fakePushInit', '1');
      sessionStorage.setItem(KEY, cfg.endpoint);
    }
    const state = { unsubscribeCalls: 0, subscribeCalls: 0, registerCalls: 0, permission: cfg.permission ?? 'default', registered: false };
    const makeSubscription = (endpoint: string) => ({
      endpoint,
      expirationTime: null,
      options: { userVisibleOnly: true, applicationServerKey: null },
      getKey: () => null,
      toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'BFakeP256dhKeyForE2E', auth: 'fakeAuthForE2E' } }),
      unsubscribe: async () => {
        state.unsubscribeCalls += 1;
        if (sessionStorage.getItem(KEY) === endpoint) sessionStorage.removeItem(KEY);
        return true;
      },
    });
    const current = () => {
      const endpoint = sessionStorage.getItem(KEY);
      return endpoint ? makeSubscription(endpoint) : null;
    };
    const pushManager = {
      getSubscription: async () => current(),
      subscribe: async () => {
        state.subscribeCalls += 1;
        sessionStorage.setItem(KEY, `https://fcm.googleapis.com/fcm/send/e2e-new-${Date.now()}`);
        return current();
      },
    };
    const registration = { scope: `${location.origin}/`, pushManager };
    const serviceWorker = {
      getRegistration: async () => (state.registered || current() ? registration : undefined),
      register: async () => {
        state.registerCalls += 1;
        state.registered = true;
        return registration;
      },
      ready: Promise.resolve(registration),
      controller: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    Object.defineProperty(Navigator.prototype, 'serviceWorker', { configurable: true, get: () => serviceWorker });
    class FakeNotification {
      static get permission() {
        return state.permission;
      }
      static async requestPermission() {
        if (state.permission === 'default') state.permission = cfg.answer ?? 'granted';
        return state.permission;
      }
    }
    Object.defineProperty(window, 'Notification', { configurable: true, writable: true, value: FakeNotification });
    if (cfg.iphone) {
      delete w.PushManager;
      Object.defineProperty(Navigator.prototype, 'userAgent', {
        configurable: true,
        get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      });
      Object.defineProperty(Navigator.prototype, 'platform', { configurable: true, get: () => 'iPhone' });
    }
    w.__fakePush = state;
  }, options);
}

async function fakeState(page: Page): Promise<FakePushState> {
  return page.evaluate(() => (window as unknown as { __fakePush: FakePushState }).__fakePush);
}

function pushStatus(page: Page) {
  return page.getByTestId('push-status');
}

function pushSwitch(page: Page) {
  return page.getByRole('switch', { name: 'この端末でPushを受け取る' });
}

// S-09 を開く（GET /api/account は、Gates の分も PushSection の分も同じ応答。pushSubscriptionIds は ids）
async function openSettings(page: Page, email: string, ids: string[]) {
  const account = await mockApi(page, 'GET', '/api/account', accountResponse(email, { pushSubscriptionIds: ids, pushSubscriptionCount: ids.length }));
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: '設定' })).toBeVisible();
  return account;
}

test.describe('S-09 ⑤ この端末の Push 状態', () => {
  test('No.64 ブラウザに購読があり、GET /api/account の pushSubscriptionIds にこの端末の ID が無いと、ブラウザの購読を解除して「この端末で受け取る：オフ」', async ({ page }) => {
    await installFakePush(page, { endpoint: ENDPOINT, permission: 'granted' });
    const user = await loginAsNewUser(page);
    const account = await openSettings(page, user.email, ['0'.repeat(64), 'f'.repeat(64)]);
    await expect(pushStatus(page)).toHaveText(STATUS.off);
    await expect(pushSwitch(page)).toHaveAttribute('aria-checked', 'false');
    expect((await fakeState(page)).unsubscribeCalls).toBe(1);
    await expect.poll(() => account.calls()).toBe(3); // Gates の1回と、⑤の確認の1回と、③（04-21 の NotificationSection）の1回
  });

  test('No.64 ID があれば「この端末で受け取る：オン」のまま（ブラウザの購読を解除しない）', async ({ page }) => {
    await installFakePush(page, { endpoint: ENDPOINT, permission: 'granted' });
    const user = await loginAsNewUser(page);
    await openSettings(page, user.email, ['0'.repeat(64), sha256(ENDPOINT)].sort());
    await expect(pushStatus(page)).toHaveText(STATUS.on);
    await expect(pushSwitch(page)).toHaveAttribute('aria-checked', 'true');
    expect((await fakeState(page)).unsubscribeCalls).toBe(0);
  });

  test('ブラウザに購読があり GET /api/account を⑤の確認で読めない（503）ときは、ブラウザの判定のまま「オン」', async ({ page }) => {
    await installFakePush(page, { endpoint: ENDPOINT, permission: 'granted' });
    const user = await loginAsNewUser(page);
    await mockApi(page, 'GET', '/api/account', [
      accountResponse(user.email),
      { status: 503, error: { code: 'TEMPORARILY_UNAVAILABLE', message: '一時的に利用できません。時間をおいて再試行してください' } },
    ]);
    await page.goto('/settings');
    await expect(pushStatus(page)).toHaveText(STATUS.on);
    expect((await fakeState(page)).unsubscribeCalls).toBe(0);
  });

  test('ブラウザに購読が無い端末では、⑤の確認のために GET /api/account を読まず「この端末で受け取る：オフ」', async ({ page }) => {
    await installFakePush(page, { permission: 'default' });
    const user = await loginAsNewUser(page);
    const account = await openSettings(page, user.email, []);
    await expect(pushStatus(page)).toHaveText(STATUS.off);
    await expect.poll(() => account.calls()).toBe(2); // Gates の1回と、③（04-21 の NotificationSection）の1回。⑤の確認では読まない
  });

  test('許可が拒否されていると「許可されていません」と案内。④を押しても④の下に同じ文を重ねない', async ({ page }) => {
    await installFakePush(page, { permission: 'denied' });
    const user = await loginAsNewUser(page);
    await openSettings(page, user.email, []);
    await expect(pushStatus(page)).toHaveText(STATUS.denied);
    const main = page.getByRole('main');
    await expect(main.getByText('ブラウザの設定で通知を許可してください')).toHaveCount(1);
    await expect(main.getByText('通知センターの通知履歴は使えます。')).toBeVisible();
    await pushSwitch(page).click();
    await expect(pushSwitch(page)).toHaveAttribute('aria-checked', 'false');
    await expect(main.getByText('ブラウザの設定で通知を許可してください')).toHaveCount(1);
    expect((await fakeState(page)).subscribeCalls).toBe(0);
  });

  test('ホーム画面に追加していない iPhone は「この環境では利用できません」と「ホーム画面に追加すると利用できます」。④を押しても同じ文を重ねない', async ({ page }) => {
    await installFakePush(page, { iphone: true });
    const user = await loginAsNewUser(page);
    await openSettings(page, user.email, []);
    await expect(pushStatus(page)).toHaveText(STATUS.unsupported);
    const main = page.getByRole('main');
    await expect(main.getByText('ホーム画面に追加すると利用できます')).toHaveCount(1);
    await expect(main.getByText('通知センターの通知履歴は使えます。')).toBeVisible();
    await pushSwitch(page).click();
    await expect(main.getByText('ホーム画面に追加すると利用できます')).toHaveCount(1);
    await expect(main.getByRole('alert')).toHaveCount(0);
  });
});

test.describe('S-09 ④ この端末で Push を受け取る', () => {
  test('オンにすると許可を求めて購読を作り、必要な項目だけを POST /api/push/subscribe（本物の API）に送って「オン」。開き直しても「オン」', async ({ page }) => {
    await installFakePush(page, { permission: 'default', answer: 'granted' });
    await loginAsNewUser(page);
    const bodies: unknown[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/push/subscribe') && request.method() === 'POST') bodies.push(request.postDataJSON());
    });
    await page.goto('/settings');
    await expect(pushStatus(page)).toHaveText(STATUS.off);
    await pushSwitch(page).click();
    await expect(pushStatus(page)).toHaveText(STATUS.on);
    await expect(pushSwitch(page)).toHaveAttribute('aria-checked', 'true');
    const state = await fakeState(page);
    expect(state.registerCalls).toBe(1);
    expect(state.subscribeCalls).toBe(1);
    expect(bodies).toHaveLength(1);
    expect(Object.keys(bodies[0] as object).sort()).toEqual(['endpoint', 'keys', 'userAgent']);
    expect((bodies[0] as { keys: object }).keys).toEqual({ p256dh: 'BFakeP256dhKeyForE2E', auth: 'fakeAuthForE2E' });

    await page.reload(); // サーバー（本物の GET /api/account）にこの端末の ID があるので「オン」のまま
    await expect(pushStatus(page)).toHaveText(STATUS.on);
    expect((await fakeState(page)).unsubscribeCalls).toBe(0);
  });

  test('登録が失敗（500）すると、ブラウザの購読を解除してオフに戻し、④のすぐ下に「登録できませんでした。もう一度お試しください」', async ({ page }) => {
    await installFakePush(page, { permission: 'granted' });
    const user = await loginAsNewUser(page);
    await mockApi(page, 'POST', '/api/push/subscribe', { status: 500, error: { code: 'INTERNAL_ERROR', message: '処理に失敗しました。もう一度お試しください' } });
    await openSettings(page, user.email, []);
    await expect(pushStatus(page)).toHaveText(STATUS.off);
    await pushSwitch(page).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('登録できませんでした。もう一度お試しください');
    await expect(pushSwitch(page)).toHaveAttribute('aria-checked', 'false');
    await expect(pushStatus(page)).toHaveText(STATUS.off);
    expect((await fakeState(page)).unsubscribeCalls).toBe(1);
  });

  test('登録がオフライン（通信の失敗）でも、共通の文ではなく「登録できませんでした。もう一度お試しください」', async ({ page }) => {
    await installFakePush(page, { permission: 'granted' });
    const user = await loginAsNewUser(page);
    await mockApi(page, 'POST', '/api/push/subscribe', 'failure');
    await openSettings(page, user.email, []);
    await pushSwitch(page).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('登録できませんでした。もう一度お試しください');
  });

  test('登録でゲートのエラー（409 TERMS_RECONSENT_REQUIRED）なら、文を出さずにブラウザの購読を解除し、S-13 に切り替わる', async ({ page }) => {
    await installFakePush(page, { permission: 'granted' });
    const user = await loginAsNewUser(page);
    await mockApi(page, 'POST', '/api/push/subscribe', { status: 409, error: { code: 'TERMS_RECONSENT_REQUIRED', message: '利用規約が更新されました。もう一度同意してください' } });
    await openSettings(page, user.email, []);
    await pushSwitch(page).click();
    await expect(page.getByRole('heading', { level: 1, name: '設定' })).toBeHidden();
    await expect(page.getByText('登録できませんでした。もう一度お試しください')).toHaveCount(0);
    await expect.poll(async () => (await fakeState(page)).unsubscribeCalls).toBe(1);
  });

  test('許可のダイアログを閉じただけなら、⑤は「オフ」のまま、④の下に「ブラウザの設定で通知を許可してください」', async ({ page }) => {
    await installFakePush(page, { permission: 'default', answer: 'default' });
    const user = await loginAsNewUser(page);
    await openSettings(page, user.email, []);
    await pushSwitch(page).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('ブラウザの設定で通知を許可してください');
    await expect(pushStatus(page)).toHaveText(STATUS.off);
    await expect(pushSwitch(page)).toHaveAttribute('aria-checked', 'false');
  });

  test('オフでサーバーの解除が失敗（503）すると、購読を残してオンのまま「解除できませんでした…」。もう一度押して成功すると、解除して「オフ」', async ({ page }) => {
    await installFakePush(page, { endpoint: ENDPOINT, permission: 'granted' });
    const user = await loginAsNewUser(page);
    const del = await mockApi(page, 'DELETE', '/api/push/subscribe', [
      { status: 503, error: { code: 'TEMPORARILY_UNAVAILABLE', message: '一時的に利用できません。時間をおいて再試行してください' } },
      { status: 204 },
    ]);
    await openSettings(page, user.email, [sha256(ENDPOINT)]);
    await expect(pushStatus(page)).toHaveText(STATUS.on);
    await pushSwitch(page).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('解除できませんでした。もう一度お試しください');
    await expect(pushSwitch(page)).toHaveAttribute('aria-checked', 'true');
    expect((await fakeState(page)).unsubscribeCalls).toBe(0);

    await pushSwitch(page).click();
    await expect(pushStatus(page)).toHaveText(STATUS.off);
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    expect(del.calls()).toBe(2);
    expect(del.bodies()[1]).toEqual({ endpoint: ENDPOINT });
    expect((await fakeState(page)).unsubscribeCalls).toBe(1);
  });
});

test.describe('Push 購読の後始末（No.63 の Push の部分・ログアウト）', () => {
  test('No.63 Push 購読のある端末で API が 401 UNAUTHENTICATED を返すと、偽の購読の解除が呼ばれ（サーバーの API は呼ばない）、S-02 に期限切れの文', async ({ page }) => {
    await installFakePush(page, { endpoint: ENDPOINT, permission: 'granted' });
    const user = await loginAsNewUser(page);
    const del = await mockApi(page, 'DELETE', '/api/push/subscribe', { status: 204 });
    await openSettings(page, user.email, [sha256(ENDPOINT)]);
    await expect(pushStatus(page)).toHaveText(STATUS.on);
    await mockApi(page, 'GET', '/api/smoke-test', { status: 401, error: { code: 'UNAUTHENTICATED', message: 'ログインしてください' } });
    expect(await callApi(page, '/api/smoke-test')).toMatchObject({ ok: false, error: { status: 401, code: 'UNAUTHENTICATED' } });
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('status').filter({ hasText: 'ログインの有効期限が切れました。もう一度ログインしてください' })).toBeVisible();
    expect((await fakeState(page)).unsubscribeCalls).toBe(1);
    expect(del.calls()).toBe(0);
  });

  test('No.63 ログアウトでは、DELETE /api/push/subscribe が 409 を返してもブラウザの購読を解除し、onApiGate は呼ばれず S-02 へ', async ({ page }) => {
    await installFakePush(page, { endpoint: ENDPOINT, permission: 'granted' });
    const user = await loginAsNewUser(page);
    const del = await mockApi(page, 'DELETE', '/api/push/subscribe', {
      status: 409,
      error: { code: 'ACCOUNT_NOT_INITIALIZED', message: 'アカウントの初期設定が完了していません' },
    });
    await openSettings(page, user.email, [sha256(ENDPOINT)]);
    await expect(pushStatus(page)).toHaveText(STATUS.on);
    await page.evaluate(() => {
      const w = window as unknown as { gateCalls: number };
      w.gateCalls = 0;
      window.__SUBWATCH_E2E__!.onApiGate(() => {
        w.gateCalls += 1;
      });
    });
    await page.getByRole('button', { name: 'ログアウト' }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(del.calls()).toBe(1);
    expect(del.bodies()[0]).toEqual({ endpoint: ENDPOINT });
    expect((await fakeState(page)).unsubscribeCalls).toBe(1);
    expect(await page.evaluate(() => (window as unknown as { gateCalls: number }).gateCalls)).toBe(0);
  });

  test('No.63 ブラウザに購読が無い端末では、ログアウトで DELETE /api/push/subscribe を呼ばない', async ({ page }) => {
    await installFakePush(page, { permission: 'granted' });
    const user = await loginAsNewUser(page);
    const del = await mockApi(page, 'DELETE', '/api/push/subscribe', { status: 204 });
    await openSettings(page, user.email, []);
    await expect(pushStatus(page)).toHaveText(STATUS.off);
    await page.getByRole('button', { name: 'ログアウト' }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(del.calls()).toBe(0);
  });
});

test.describe('S-09 ⑥⑦ と PWA のファイル', () => {
  test('⑥「通知タイミング（固定）」と⑦の案内（Safari とログインの状態を共有しない文を含む）。幅375pxで横スクロールなし・押せる大きさ44px以上', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await installFakePush(page, { permission: 'default' });
    const user = await loginAsNewUser(page);
    await openSettings(page, user.email, []);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: '通知タイミング（固定）' })).toBeVisible();
    await expect(main.getByText('請求日・最終無料日の7日前と1日前にお知らせします（毎日、日本時間9時台（遅れると11時台か18時台）に判定）')).toBeVisible();
    await expect(main.getByText('この端末のPush状態')).toBeVisible();
    await expect(main.getByText('ブラウザの許可が必要です')).toBeVisible();
    await expect(main.getByRole('heading', { name: 'ホーム画面に追加（PWA）' })).toBeVisible();
    await expect(main.getByText('ホーム画面に追加していないiPhoneではPushが届かないため、アプリを開いて通知履歴を確認してください')).toBeVisible();
    await expect(main.getByText('ホーム画面に追加したアプリは Safari とログインの状態を共有しないため、追加した後にもう一度ログインしてください')).toBeVisible();
    await expect(pushStatus(page)).toHaveText(STATUS.off);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
  });

  test('manifest.webmanifest（name・short_name・start_url・scope・display・色・icons 192/512）、sw.js、アイコン3枚が配られ、layout が manifest と apple-touch-icon を指定している', async ({ page, request }) => {
    const manifest = await (await request.get('/manifest.webmanifest')).json();
    expect(manifest).toMatchObject({
      name: 'SubWatch',
      short_name: 'SubWatch',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: expect.any(String),
      theme_color: expect.any(String),
    });
    expect(manifest.icons).toEqual([
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ]);
    for (const file of ['/sw.js', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png']) {
      expect((await request.get(file)).status(), file).toBe(200);
    }
    await page.goto('/login');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png');
  });
});
