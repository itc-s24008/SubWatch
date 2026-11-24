// S-08 通知センター（app/(main)/notifications/page.tsx）と S-09 ③通知（NotificationSection）の画面テスト（04-21）
// テスト一覧の No.33（S-09 のスイッチ③④の画面の部分。④は 04-12 の PushSection）・34・35・41（S-08 の空・読み込み失敗・オフライン）・51 と、
// 番号なしの「既読に失敗したら移動しない」・フィルターの切り替え・［さらに読み込む］など
// ・S-08 の失敗の場面は mockApi で応答を作る。No.34・35・51 は Emulator に通知を置き、本物の API を読ませる
// ・S-09 のテストでは GET /api/account は作らず、Emulator の本物を読ませる（Gates がログインのときに1回、NotificationSection が S-09 を
//   開いたときに1回）。PATCH /api/account だけ mockApi にする
import { expect, test, type Page } from '@playwright/test';
import { Timestamp } from 'firebase-admin/firestore';
import type { NotificationDto } from '../../lib/types';
import { seedNotificationEvents, seedUser } from '../emulator/helpers';
import { expectNoHorizontalScroll, expectTapTargets, loginAsNewUser, mockApi } from './helpers';

const LOAD_FAILED = '通知を読み込めませんでした。もう一度お試しください';
const READ_FAILED = '既読にできませんでした。もう一度お試しください';
const CHANGE_FAILED = '変更できませんでした。もう一度お試しください';
const DAY_MS = 24 * 60 * 60 * 1000;

// mockApi の応答に使う通知1件（書かなかった項目は Spotify の1日前の請求の通知。未読・サブスクあり）
function notification(fields: Partial<NotificationDto> = {}): NotificationDto {
  return {
    notificationId: 'a'.repeat(64),
    subscriptionId: 'testSubscription0002',
    serviceNameAtNotification: 'Spotify',
    notificationType: 'billing',
    daysBefore: 1,
    targetDate: '2026-11-04',
    title: '請求日まであと1日',
    body: '11/05・¥980 の請求予定',
    priceAtNotification: 980,
    subscriptionExists: true,
    viewedAt: null,
    webPushStatus: 'sent',
    createdAt: new Date().toISOString(),
    ...fields,
  };
}

function listReply(items: NotificationDto[], options: { unreadCount?: number; nextCursor?: string | null; delayMs?: number } = {}) {
  return {
    data: {
      items,
      nextCursor: options.nextCursor ?? null,
      unreadCount: options.unreadCount ?? items.filter((item) => item.viewedAt === null).length,
    },
    delayMs: options.delayMs,
  };
}

function badge(page: Page) {
  return page.getByTestId('unread-count');
}

function card(page: Page, text: string) {
  return page.getByTestId('notification-card').filter({ hasText: text });
}

function filterButton(page: Page, name: string) {
  return page.getByRole('group', { name: 'フィルター' }).getByRole('button', { name, exact: true });
}

function readAllButton(page: Page) {
  return page.getByRole('button', { name: 'すべて既読にする' });
}

async function openNotifications(page: Page) {
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { level: 1, name: /通知センター/ })).toBeVisible();
}

test.describe('S-08 通知センター', () => {
  test('No.41 読み込み失敗：「通知を読み込めませんでした。もう一度お試しください」と［再試行］。①の未読件数は出さず、［再試行］で読めれば一覧を出す', async ({ page }) => {
    await loginAsNewUser(page);
    const list = await mockApi(page, 'GET', '/api/notifications', [
      { status: 500, error: { code: 'INTERNAL_ERROR', message: '処理に失敗しました。もう一度お試しください' } },
      listReply([notification()]),
    ]);
    await openNotifications(page);
    const main = page.getByRole('main');
    await expect(main.getByRole('alert')).toContainText(LOAD_FAILED);
    await expect(badge(page)).toHaveCount(0);
    await expect(readAllButton(page)).toBeDisabled();
    await main.getByRole('button', { name: '再試行' }).click();
    await expect(card(page, 'Spotify')).toBeVisible();
    await expect(badge(page)).toHaveText('1');
    await expect(readAllButton(page)).toBeEnabled();
    expect(list.calls()).toBe(2);
  });

  test('No.41 オフラインで読めないときは、共通の文「オフラインです。接続を確認してください」', async ({ page, context }) => {
    await loginAsNewUser(page);
    await openNotifications(page);
    await expect(page.getByText('通知はまだありません')).toBeVisible();
    await context.setOffline(true);
    try {
      await filterButton(page, '未読').click();
      await expect(page.getByRole('main').getByRole('alert')).toContainText('オフラインです。接続を確認してください');
      await expect(badge(page)).toHaveText('0'); // フィルターを変えている間（読めなかったときも）前の数のまま
    } finally {
      await context.setOffline(false);
    }
  });

  test('No.41 0件：「通知はまだありません」「請求予定の通知がここに表示されます」、①は灰色の0、「すべて既読にする」は押せない。未読フィルターで0件は「未読の通知はありません」', async ({ page }) => {
    await loginAsNewUser(page);
    await openNotifications(page);
    await expect(page.getByText('通知はまだありません')).toBeVisible();
    await expect(page.getByText('請求予定の通知がここに表示されます')).toBeVisible();
    await expect(badge(page)).toHaveText('0');
    await expect(readAllButton(page)).toBeDisabled();
    await expect(page.getByText('請求予定通知は決済完了の通知ではありません')).toBeVisible();
    await filterButton(page, '未読').click();
    await expect(page.getByText('未読の通知はありません')).toBeVisible();
    await filterButton(page, 'トライアル').click();
    await expect(page.getByText('通知はまだありません')).toBeVisible();
  });

  test('既読に失敗（503）したら移動せず、そのカードのすぐ下に「既読にできませんでした…」（共通の文ではない）。もう一度押して成功すると S-06 へ移る', async ({ page }) => {
    await loginAsNewUser(page);
    await mockApi(page, 'GET', '/api/notifications', listReply([notification(), notification({ notificationId: 'b'.repeat(64), serviceNameAtNotification: 'Netflix' })]));
    const read = await mockApi(page, 'POST', '/api/notifications/:id/read', [
      { status: 503, error: { code: 'TEMPORARILY_UNAVAILABLE', message: '一時的に利用できません。時間をおいて再試行してください' } },
      { data: { viewedAt: new Date().toISOString() } },
    ]);
    await openNotifications(page);
    await expect(badge(page)).toHaveText('2');
    const spotify = card(page, 'Spotify');
    await spotify.getByRole('button', { name: '詳細を見る' }).click();
    const alert = page.getByRole('main').getByRole('alert');
    await expect(alert).toHaveText(READ_FAILED);
    await expect(page.getByText('一時的に利用できません。時間をおいて再試行してください')).toHaveCount(0);
    await expect(page).toHaveURL(/\/notifications$/);
    await expect(badge(page)).toHaveText('2');
    // 文は失敗したカードのすぐ下（次の要素）
    await expect(page.getByTestId('notification-card').filter({ hasText: 'Spotify' }).locator('xpath=following-sibling::p[1]')).toHaveText(READ_FAILED);
    expect(read.calls()).toBe(1);

    await spotify.getByRole('button', { name: '詳細を見る' }).click();
    await expect(page).toHaveURL(/\/subscriptions\/testSubscription0002$/);
    expect(read.calls()).toBe(2);
  });

  test('既読に失敗（通信の失敗）しても移動せず「既読にできませんでした…」', async ({ page }) => {
    await loginAsNewUser(page);
    await mockApi(page, 'GET', '/api/notifications', listReply([notification()]));
    await mockApi(page, 'POST', '/api/notifications/:id/read', 'failure');
    await openNotifications(page);
    await card(page, 'Spotify').getByRole('button', { name: '詳細を見る' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(READ_FAILED);
    await expect(page).toHaveURL(/\/notifications$/);
  });

  test('すでに既読の通知の［詳細を見る］は、API を呼ばずに S-06 へ移る', async ({ page }) => {
    await loginAsNewUser(page);
    await mockApi(page, 'GET', '/api/notifications', listReply([notification({ viewedAt: new Date().toISOString() })]));
    const read = await mockApi(page, 'POST', '/api/notifications/:id/read', { data: { viewedAt: new Date().toISOString() } });
    await openNotifications(page);
    await expect(badge(page)).toHaveText('0');
    await card(page, 'Spotify').getByRole('button', { name: '詳細を見る' }).click();
    await expect(page).toHaveURL(/\/subscriptions\/testSubscription0002$/);
    expect(read.calls()).toBe(0);
  });

  test('No.34 91日前に作られた通知は表示されない（Emulator の通知を本物の API で読む）', async ({ page }) => {
    const user = await loginAsNewUser(page);
    const now = Date.now();
    await seedNotificationEvents(user.uid, [
      { targetDate: '2026-10-01', serviceNameAtNotification: '今日の通知', createdAt: Timestamp.fromMillis(now - 1000) },
      { targetDate: '2026-10-02', serviceNameAtNotification: '91日前の通知', createdAt: Timestamp.fromMillis(now - 91 * DAY_MS) },
    ]);
    await openNotifications(page);
    await expect(card(page, '今日の通知')).toBeVisible();
    await expect(page.getByText('91日前の通知')).toHaveCount(0);
    await expect(page.getByTestId('notification-card')).toHaveCount(1);
    await expect(badge(page)).toHaveText('1');
  });

  test('No.35 未読3件で「すべて既読にする」を押すと、①の未読数は0（読み直さない）。開き直しても0', async ({ page }) => {
    const user = await loginAsNewUser(page);
    const now = Date.now();
    await seedNotificationEvents(user.uid, [
      { targetDate: '2026-10-01', serviceNameAtNotification: 'Netflix', createdAt: Timestamp.fromMillis(now - 3000) },
      { targetDate: '2026-10-02', serviceNameAtNotification: 'Spotify', createdAt: Timestamp.fromMillis(now - 2000) },
      { targetDate: '2026-10-03', serviceNameAtNotification: 'ChatGPT', createdAt: Timestamp.fromMillis(now - 1000), notificationType: 'trial_end', daysBefore: 7 },
    ]);
    await openNotifications(page);
    await expect(badge(page)).toHaveText('3');
    await expect(page.getByTestId('notification-card')).toHaveCount(3);
    await expect(page.getByTestId('notification-card').getByText('未読', { exact: true })).toHaveCount(3); // 読み上げ用の「未読」（太字と色の点）
    const listCalls: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/notifications') listCalls.push(request.url());
    });
    await readAllButton(page).click();
    await expect(badge(page)).toHaveText('0');
    await expect(page.getByTestId('notification-card').getByText('未読', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('notification-card')).toHaveCount(3); // 「すべて」では一覧に残し、既読の表示に変える
    expect(listCalls).toEqual([]); // 読み直さない
    await openNotifications(page);
    await expect(badge(page)).toHaveText('0');
  });

  test('No.51 サブスクを削除した後の通知は、通知を作ったときのサービス名を出し、［詳細を見る］を出さない。カードを押すと既読にして移動しない', async ({ page }) => {
    const user = await loginAsNewUser(page);
    // subscriptionId（'a' が20個）のサブスクは置かない（削除された後と同じ）
    await seedNotificationEvents(user.uid, [{ targetDate: '2026-10-01', serviceNameAtNotification: '削除したサービス', createdAt: Timestamp.fromMillis(Date.now() - 1000) }]);
    await openNotifications(page);
    const target = card(page, '削除したサービス');
    await expect(target).toBeVisible();
    await expect(target.getByRole('button', { name: '詳細を見る' })).toHaveCount(0);
    await expect(badge(page)).toHaveText('1');
    await page.getByRole('button', { name: /削除したサービス/ }).click();
    await expect(badge(page)).toHaveText('0');
    await expect(page).toHaveURL(/\/notifications$/);
    // 既読になったカードは押せない（button ではなくなる）
    await expect(page.getByRole('button', { name: /削除したサービス/ })).toHaveCount(0);
    await expect(card(page, '削除したサービス')).toBeVisible();
  });

  test('フィルターを素早く切り替えると、最後に選んだフィルターの応答だけを使う（遅れて届いた前の応答は使わない）', async ({ page }) => {
    await loginAsNewUser(page);
    await mockApi(page, 'GET', '/api/notifications', listReply([notification({ serviceNameAtNotification: 'すべての通知' })]));
    const unread = await mockApi(page, 'GET', '/api/notifications?filter=unread', listReply([notification({ serviceNameAtNotification: '未読の通知' })], { delayMs: 2000 }));
    const billing = await mockApi(page, 'GET', '/api/notifications?filter=billing', listReply([notification({ serviceNameAtNotification: '請求の通知' })], { unreadCount: 5 }));
    await openNotifications(page);
    await expect(card(page, 'すべての通知')).toBeVisible();
    await filterButton(page, '未読').click();
    await expect.poll(() => unread.calls()).toBe(1);
    await filterButton(page, '請求').click();
    await expect(card(page, '請求の通知')).toBeVisible();
    await expect(badge(page)).toHaveText('5');
    await page.waitForTimeout(2500); // 未読の応答が届くのを待つ
    await expect(card(page, '請求の通知')).toBeVisible();
    await expect(page.getByText('未読の通知')).toHaveCount(0);
    await expect(filterButton(page, '請求')).toHaveAttribute('aria-pressed', 'true');
    expect(billing.calls()).toBe(1);
  });

  test('「未読」のフィルターで既読にした通知は一覧から外れ、「すべて既読にする」の後は「未読の通知はありません」', async ({ page }) => {
    await loginAsNewUser(page);
    await mockApi(page, 'GET', '/api/notifications', listReply([notification()]));
    await mockApi(page, 'GET', '/api/notifications?filter=unread', listReply([
      notification({ notificationId: 'c'.repeat(64), serviceNameAtNotification: '削除済み', subscriptionExists: false }),
      notification({ notificationId: 'd'.repeat(64), serviceNameAtNotification: 'Hulu' }),
    ]));
    await mockApi(page, 'POST', '/api/notifications/:id/read', { data: { viewedAt: new Date().toISOString() } });
    const readAll = await mockApi(page, 'POST', '/api/notifications/read-all', { data: { updatedCount: 1 } });
    await openNotifications(page);
    await filterButton(page, '未読').click();
    await expect(badge(page)).toHaveText('2');
    await page.getByRole('button', { name: /削除済み/ }).click();
    await expect(page.getByText('削除済み')).toHaveCount(0);
    await expect(badge(page)).toHaveText('1');
    await readAllButton(page).click();
    await expect(page.getByText('未読の通知はありません')).toBeVisible();
    await expect(badge(page)).toHaveText('0');
    expect(readAll.calls()).toBe(1);
  });

  test('「すべて既読にする」が失敗（503）したら、フィルターの枠のすぐ下に「既読にできませんでした…」（共通の文ではない）。未読数は変えない', async ({ page }) => {
    await loginAsNewUser(page);
    await mockApi(page, 'GET', '/api/notifications', listReply([notification()]));
    await mockApi(page, 'POST', '/api/notifications/read-all', { status: 503, error: { code: 'TEMPORARILY_UNAVAILABLE', message: '一時的に利用できません。時間をおいて再試行してください' } });
    await openNotifications(page);
    await readAllButton(page).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(READ_FAILED);
    await expect(badge(page)).toHaveText('1');
  });

  test('［さらに読み込む］：続きを読めないと、読んだ分を残してボタンの位置に読み込み失敗の文と［再試行］。再試行で続きを足す', async ({ page }) => {
    await loginAsNewUser(page);
    await mockApi(page, 'GET', '/api/notifications', listReply([notification({ serviceNameAtNotification: '1ページ目' })], { nextCursor: '1762214400000_abc' }));
    const next = await mockApi(page, 'GET', '/api/notifications?cursor=1762214400000_abc', [
      'failure',
      listReply([notification({ notificationId: 'e'.repeat(64), serviceNameAtNotification: '2ページ目' })]),
    ]);
    await openNotifications(page);
    await page.getByRole('button', { name: 'さらに読み込む' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText(LOAD_FAILED);
    await expect(card(page, '1ページ目')).toBeVisible();
    await page.getByRole('main').getByRole('button', { name: '再試行' }).click();
    await expect(card(page, '2ページ目')).toBeVisible();
    await expect(card(page, '1ページ目')).toBeVisible();
    await expect(page.getByRole('button', { name: 'さらに読み込む' })).toHaveCount(0); // nextCursor が null
    expect(next.calls()).toBe(2);
  });

  test('③の日付見出し（今日・昨日・MM/DD）、作成時刻（日本時間 HH:mm）、種類のチップ、保存された title・body をそのまま出す', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-04T03:00:00.000Z')); // 日本時間 2026-11-04 12:00
    await loginAsNewUser(page);
    await mockApi(page, 'GET', '/api/notifications', listReply([
      notification({ createdAt: '2026-11-04T00:00:00.000Z' }),
      notification({
        notificationId: 'b'.repeat(64),
        serviceNameAtNotification: 'ChatGPT',
        notificationType: 'trial_end',
        title: '無料トライアル終了まであと1日',
        body: '最終無料日は11/04です',
        createdAt: '2026-11-03T00:05:00.000Z',
        viewedAt: '2026-11-03T01:00:00.000Z',
      }),
      notification({ notificationId: 'c'.repeat(64), serviceNameAtNotification: 'Adobe Creative Cloud', createdAt: '2026-10-31T15:30:00.000Z', viewedAt: '2026-11-01T00:00:00.000Z' }),
    ]));
    await openNotifications(page);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 2 })).toHaveText(['今日', '昨日', '11/01', '通知の意味']);
    await expect(card(page, 'Spotify')).toContainText('09:00');
    await expect(card(page, 'Spotify')).toContainText('請求日まであと1日');
    await expect(card(page, 'Spotify')).toContainText('11/05・¥980 の請求予定');
    await expect(card(page, 'Spotify')).toContainText('請求');
    await expect(card(page, 'ChatGPT')).toContainText('09:05');
    await expect(card(page, 'ChatGPT')).toContainText('トライアル');
    await expect(card(page, 'Adobe Creative Cloud')).toContainText('00:30');
    await expect(badge(page)).toHaveText('1');
  });

  test('幅375pxで横スクロールなし・押せる大きさ44px以上・<h1> は1つ。①は100件以上で「99+」', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await loginAsNewUser(page);
    await mockApi(page, 'GET', '/api/notifications', listReply(
      [
        notification({ serviceNameAtNotification: 'とても長いサービス名のサブスクリプションサービスとても長いサービス名' }),
        notification({ notificationId: 'b'.repeat(64), subscriptionExists: false, serviceNameAtNotification: '削除済み' }),
      ],
      { unreadCount: 120, nextCursor: '1_abc' },
    ));
    await openNotifications(page);
    await expect(badge(page)).toHaveText('99+');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
  });
});

// ---- S-09 ③通知（NotificationSection）と④（PushSection）のスイッチ ----

function notificationSwitch(page: Page) {
  return page.getByRole('switch', { name: '通知' });
}

// GET /api/account の回数を数える（mockApi は使わず、本物の API を読ませる）
function countAccountReads(page: Page): () => number {
  let count = 0;
  page.on('request', (request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/account') count += 1;
  });
  return () => count;
}

async function openSettings(page: Page) {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: '設定' })).toBeVisible();
  await expect(notificationSwitch(page)).toBeEnabled(); // GET /api/account を読み終えると押せる
}

// ブラウザの Push を偽物にする（通知は許可済み・購読は無い状態から。④の画面テスト用。本物の Push サービスに通信しない）
async function installFakePush(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = { endpoint: null as string | null, registered: false };
    const subscription = (endpoint: string) => ({
      endpoint,
      expirationTime: null,
      options: { userVisibleOnly: true, applicationServerKey: null },
      getKey: () => null,
      toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'BFakeP256dhKeyForE2E', auth: 'fakeAuthForE2E' } }),
      unsubscribe: async () => {
        state.endpoint = null;
        return true;
      },
    });
    const pushManager = {
      getSubscription: async () => (state.endpoint ? subscription(state.endpoint) : null),
      subscribe: async () => {
        state.endpoint = `https://fcm.googleapis.com/fcm/send/e2e-04-21-${Date.now()}`;
        return subscription(state.endpoint);
      },
    };
    const registration = { scope: `${location.origin}/`, pushManager };
    const serviceWorker = {
      getRegistration: async () => (state.registered ? registration : undefined),
      register: async () => {
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
        return 'granted';
      }
      static async requestPermission() {
        return 'granted';
      }
    }
    Object.defineProperty(window, 'Notification', { configurable: true, writable: true, value: FakeNotification });
  });
}

test.describe('S-09 ③通知', () => {
  test('開くと GET /api/account を読み（Gates の1回と、③の1回）、保存された値（オフ）を出す', async ({ page }) => {
    const user = await loginAsNewUser(page);
    await seedUser(user.uid, { email: user.email, accountNotificationEnabled: false });
    const reads = countAccountReads(page);
    await openSettings(page);
    await expect(notificationSwitch(page)).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText('通知履歴とPushをまとめて有効・無効')).toBeVisible();
    await expect.poll(reads).toBe(2);
  });

  test('押すとすぐに切り替わり、通信の間は押せない。成功したら応答の値を出し、画面を「読み込み中」に戻さず、GET /api/account を読み直さない', async ({ page }) => {
    await loginAsNewUser(page);
    const patch = await mockApi(page, 'PATCH', '/api/account', { data: { accountNotificationEnabled: false }, delayMs: 1500 });
    const reads = countAccountReads(page);
    await openSettings(page);
    await expect(notificationSwitch(page)).toHaveAttribute('aria-checked', 'true');
    await expect.poll(reads).toBe(2);
    await notificationSwitch(page).click();
    await expect(notificationSwitch(page)).toHaveAttribute('aria-checked', 'false');
    await expect(notificationSwitch(page)).toBeDisabled();
    await expect(notificationSwitch(page)).toBeEnabled();
    await expect(notificationSwitch(page)).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('heading', { level: 1, name: '設定' })).toBeVisible();
    await expect(page.getByText('読み込み中…')).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    expect(patch.bodies()).toEqual([{ accountNotificationEnabled: false }]);
    expect(reads()).toBe(2);
  });

  test('No.33 ③の変更がゲートの反応しないエラー（503）で失敗すると、元へ戻して「変更できませんでした…」（共通の文ではない）', async ({ page }) => {
    await loginAsNewUser(page);
    await mockApi(page, 'PATCH', '/api/account', { status: 503, error: { code: 'TEMPORARILY_UNAVAILABLE', message: '一時的に利用できません。時間をおいて再試行してください' } });
    await openSettings(page);
    await notificationSwitch(page).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(CHANGE_FAILED);
    await expect(notificationSwitch(page)).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('一時的に利用できません。時間をおいて再試行してください')).toHaveCount(0);
  });

  test('No.33 ③の変更が通信の失敗でも、元へ戻して「変更できませんでした…」', async ({ page }) => {
    await loginAsNewUser(page);
    await mockApi(page, 'PATCH', '/api/account', 'failure');
    await openSettings(page);
    await notificationSwitch(page).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(CHANGE_FAILED);
    await expect(notificationSwitch(page)).toHaveAttribute('aria-checked', 'true');
  });

  test('No.33 ③の変更がゲートのエラー（401 UNAUTHENTICATED）なら、文を出さずに元へ戻し、S-02 へ移る', async ({ page }) => {
    await loginAsNewUser(page);
    await mockApi(page, 'PATCH', '/api/account', { status: 401, error: { code: 'UNAUTHENTICATED', message: 'ログインしてください' } });
    await openSettings(page);
    // サインアウトの前の後始末を2.5秒待たせ、S-09 が切り替わる前の③を確かめる
    await page.evaluate(() => {
      window.__SUBWATCH_E2E__!.registerLocalCleanup(() => new Promise<void>((resolve) => setTimeout(resolve, 2500)));
    });
    await notificationSwitch(page).click();
    await expect(notificationSwitch(page)).toHaveAttribute('aria-checked', 'true', { timeout: 2000 });
    await expect(page.getByText(CHANGE_FAILED)).toHaveCount(0);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText(CHANGE_FAILED)).toHaveCount(0);
  });

  test('No.33 ③の変更がゲートのエラー（409 TERMS_RECONSENT_REQUIRED）なら、文を出さずに S-13 に切り替わる', async ({ page }) => {
    await loginAsNewUser(page);
    await mockApi(page, 'PATCH', '/api/account', { status: 409, error: { code: 'TERMS_RECONSENT_REQUIRED', message: '利用規約が更新されました。もう一度同意してください' } });
    await openSettings(page);
    await notificationSwitch(page).click();
    await expect(page.getByRole('heading', { level: 1, name: '設定' })).toBeHidden();
    await expect(page.getByText(CHANGE_FAILED)).toHaveCount(0);
  });

  test('No.33 ④（PushSection）の登録がゲートの反応しないエラー（500）なら、オフに戻して「登録できませんでした…」', async ({ page }) => {
    await installFakePush(page);
    await loginAsNewUser(page);
    await mockApi(page, 'POST', '/api/push/subscribe', { status: 500, error: { code: 'INTERNAL_ERROR', message: '処理に失敗しました。もう一度お試しください' } });
    await openSettings(page);
    const pushSwitch = page.getByRole('switch', { name: 'この端末でPushを受け取る' });
    await expect(pushSwitch).toBeEnabled();
    await pushSwitch.click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('登録できませんでした。もう一度お試しください');
    await expect(pushSwitch).toHaveAttribute('aria-checked', 'false');
  });

  test('No.33 ④（PushSection）の登録がゲートのエラー（409 TERMS_RECONSENT_REQUIRED）なら、文を出さずに S-13 に切り替わる', async ({ page }) => {
    await installFakePush(page);
    await loginAsNewUser(page);
    await mockApi(page, 'POST', '/api/push/subscribe', { status: 409, error: { code: 'TERMS_RECONSENT_REQUIRED', message: '利用規約が更新されました。もう一度同意してください' } });
    await openSettings(page);
    const pushSwitch = page.getByRole('switch', { name: 'この端末でPushを受け取る' });
    await expect(pushSwitch).toBeEnabled();
    await pushSwitch.click();
    await expect(page.getByRole('heading', { level: 1, name: '設定' })).toBeHidden();
    await expect(page.getByText('登録できませんでした。もう一度お試しください')).toHaveCount(0);
  });
});
