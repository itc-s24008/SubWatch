// 統合の通しのテスト（統合日の共通 手順6）。mockApi も仮データ（NEXT_PUBLIC_USE_MOCKS）も使わず、本物の API と Emulator で動かす。
// 前の統合日のテストは消さずに残し、次の統合日（11/25・12/1）は、このファイルに足す（11/25 の分は、このファイルの最後）
//
// ===== 統合①（11/19）：登録 → 一覧 → 編集 → 削除（04-05・04-06・04-07・04-08・04-09 のつなぎ） =====
import { expect, test, type Page } from '@playwright/test';
import { addDays } from '../../lib/billing';
import { todayJST } from '../../lib/clock';
import { adminDb } from '../../lib/firebase-admin';
import { seedSubscriptions } from '../emulator/helpers';
import { callApi, fillSubscriptionForm, loginAsNewUser, waitForHydration } from './helpers';

// S-05 で保存した後の S-06 の URL（自動の ID は英数字20文字なので、/subscriptions/new は合わない）
const DETAIL_URL = /\/subscriptions\/[A-Za-z0-9]{20}$/;
const EDIT_URL = /\/subscriptions\/[A-Za-z0-9]{20}\/edit$/;

let counter = 0;
function newEmail(): string {
  counter += 1;
  return `integration${Date.now()}${counter}@example.com`;
}

// YYYY-MM-DD → 「MM/DD」（lib/format.ts の formatMonthDay と同じ形。期待値は自分で作る）
function monthDay(date: string): string {
  return `${date.slice(5, 7)}/${date.slice(8, 10)}`;
}

function main(page: Page) {
  return page.getByRole('main');
}

// S-06 の②のカード（サービス名の見出しを含む section）
function detailCard(page: Page) {
  return main(page).locator('section').filter({ has: page.getByRole('heading', { level: 2 }) });
}

function listCards(page: Page) {
  return main(page).getByRole('list', { name: 'サブスク一覧' }).getByRole('listitem');
}

// S-03 の「登録数」のカード
function countCard(page: Page) {
  return main(page).getByText('登録数', { exact: true }).locator('..');
}

function saveButton(page: Page) {
  return main(page).getByRole('button', { name: '保存する' });
}

async function uidOfEmail(email: string): Promise<string> {
  const snapshot = await adminDb().collection('users').where('email', '==', email).get();
  expect(snapshot.size).toBe(1);
  return snapshot.docs[0].id;
}

async function subscriptionCountOf(uid: string): Promise<{ docs: number; field: unknown }> {
  const user = await adminDb().collection('users').doc(uid).get();
  const docs = await adminDb().collection('users').doc(uid).collection('subscriptions').get();
  return { docs: docs.size, field: user.data()?.subscriptionCount };
}

test('統合① 本物の API で、S-01 の登録 → S-03 → S-05 の登録 → S-06 → S-04 → S-05 の編集 → S-06 → 削除 → S-04 の「削除しました」が通して動く', async ({ page }) => {
  const email = newEmail();
  const today = todayJST();
  const firstBillingDate = addDays(today, 3); // 次の請求は3日後（S-03 の「7日以内」に入る）

  // ---- S-01 ユーザー登録（04-05。本物の POST /api/account/bootstrap）→ S-03 ホーム（04-09。本物の GET /api/dashboard） ----
  await page.goto('/register');
  await waitForHydration(page, 'form');
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード', { exact: true }).fill('password1234');
  await page.getByLabel('パスワード確認').fill('password1234');
  await page.getByRole('checkbox', { name: /利用規約/ }).check();
  await page.getByRole('checkbox', { name: /プライバシーポリシー/ }).check();
  await page.getByRole('button', { name: 'アカウントを作成' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'ホーム' })).toBeVisible();
  await expect(main(page).getByText('登録されたサブスクがありません')).toBeVisible();
  await expect(countCard(page)).toContainText('0件');
  const uid = await uidOfEmail(email);
  expect(await subscriptionCountOf(uid)).toEqual({ docs: 0, field: 0 });

  // ---- S-05 登録（04-06。本物の POST /api/subscriptions）→ S-06（04-08。本物の GET /api/subscriptions/:id） ----
  await main(page).getByRole('link', { name: '＋ サブスクを登録する' }).click();
  await expect(page).toHaveURL(/\/subscriptions\/new$/);
  await expect(page.getByRole('heading', { level: 1, name: 'サブスクを追加' })).toBeVisible();
  await waitForHydration(page, 'form');
  await fillSubscriptionForm(page, {
    serviceName: '統合テスト動画',
    planName: 'スタンダード',
    price: '1590',
    billingCycle: 'monthly',
    firstBillingDate,
    category: 'video',
    websiteUrl: 'https://www.example.com',
  });
  await saveButton(page).click();

  await expect(page).toHaveURL(DETAIL_URL); // /subscriptions/new は拾わない
  const detailPath = new URL(page.url()).pathname;
  const subscriptionId = detailPath.split('/').pop()!;
  await expect(page.getByRole('heading', { level: 1, name: 'サービス詳細' })).toBeVisible();
  await expect(detailCard(page).getByRole('heading', { level: 2, name: '統合テスト動画' })).toBeVisible();
  await expect(detailCard(page)).toContainText('動画・スタンダード');
  await expect(detailCard(page)).toContainText(`${monthDay(firstBillingDate)}・¥1,590`); // サーバーが計算した nextBillingDate
  // DB に保存の形で入り、users.subscriptionCount が1になった
  const saved = await adminDb().collection('users').doc(uid).collection('subscriptions').doc(subscriptionId).get();
  expect(saved.data()).toMatchObject({
    subscriptionId,
    uid,
    serviceName: '統合テスト動画',
    planName: 'スタンダード',
    price: 1590,
    billingCycle: 'monthly',
    firstBillingDate,
    nextBillingDate: firstBillingDate,
    billingDayMode: 'fixedDay',
    category: 'video',
    trialEnabled: false,
    trialEndDate: null,
    websiteUrl: 'https://www.example.com',
    cancelUrl: null,
    paymentMethod: null,
    memo: null,
    subscriptionNotificationEnabled: true,
  });
  expect(await subscriptionCountOf(uid)).toEqual({ docs: 1, field: 1 });

  // ---- S-03（本物の集計）：登録数1件、次の請求は3日後 ----
  await page.getByRole('navigation', { name: 'メニュー' }).getByRole('link', { name: 'ホーム' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ホーム' })).toBeVisible();
  await expect(main(page).getByText('次の請求まであと3日')).toBeVisible();
  await expect(countCard(page)).toContainText('1件');

  // ---- S-04 一覧（04-09。本物の GET /api/subscriptions）→ カードから S-06 ----
  await page.getByRole('navigation', { name: 'メニュー' }).getByRole('link', { name: '一覧' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'サブスク一覧' })).toBeVisible();
  await expect(listCards(page)).toHaveCount(1);
  await expect(listCards(page).first()).toContainText('統合テスト動画');
  await expect(listCards(page).first()).toContainText('動画・¥1,590 / 月');
  await expect(listCards(page).first()).toContainText(`次回請求 ${monthDay(firstBillingDate)}`);
  await listCards(page).first().getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`${detailPath}$`));
  await expect(detailCard(page).getByRole('heading', { level: 2, name: '統合テスト動画' })).toBeVisible();

  // ---- S-05 編集（04-08。本物の PATCH /api/subscriptions/:id）→ 保存の後は履歴を1つ戻って S-06 ----
  await main(page).getByRole('link', { name: '編集する' }).click();
  await expect(page).toHaveURL(EDIT_URL);
  await expect(page.getByRole('heading', { level: 1, name: 'サブスクを編集' })).toBeVisible();
  await waitForHydration(page, 'form');
  await expect(main(page).getByRole('textbox', { name: 'サービス名', exact: true })).toHaveValue('統合テスト動画');
  await expect(main(page).getByRole('textbox', { name: '1回の請求額（円）', exact: true })).toHaveValue('1590');
  await fillSubscriptionForm(page, { planName: 'プレミアム', price: '1890' });
  await saveButton(page).click();

  await expect(page).toHaveURL(new RegExp(`${detailPath}$`));
  await expect(detailCard(page)).toContainText('動画・プレミアム');
  await expect(detailCard(page)).toContainText(`${monthDay(firstBillingDate)}・¥1,890`);
  const updated = await adminDb().collection('users').doc(uid).collection('subscriptions').doc(subscriptionId).get();
  expect(updated.data()).toMatchObject({ planName: 'プレミアム', price: 1890, serviceName: '統合テスト動画', nextBillingDate: firstBillingDate });
  // S-06 から編集して保存したので、［戻る］1回で S-06 の前の画面（S-04）に戻る（画面設計書 S-05 ⑱）
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'サブスク一覧' })).toBeVisible();
  await expect(listCards(page).first()).toContainText('動画・¥1,890 / 月');
  await listCards(page).first().getByRole('link').click();
  await expect(detailCard(page).getByRole('heading', { level: 2, name: '統合テスト動画' })).toBeVisible();

  // ---- 削除（04-08。本物の DELETE /api/subscriptions/:id）→ S-04 に「削除しました」（04-09） ----
  await main(page).getByRole('button', { name: '削除する' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: '統合テスト動画を削除しますか？' })).toBeVisible();
  await dialog.getByRole('button', { name: '削除する' }).click();

  await expect(page).toHaveURL(/\/subscriptions$/);
  await expect(main(page).getByRole('status').filter({ hasText: '削除しました' })).toBeVisible();
  await expect(main(page).getByText('サブスクを登録していません')).toBeVisible();
  await expect(listCards(page)).toHaveCount(0);
  expect(await subscriptionCountOf(uid)).toEqual({ docs: 0, field: 0 });

  // 開き直すと「削除しました」は出ない。S-03 の登録数も0件に戻る
  await page.reload();
  await expect(main(page).getByText('サブスクを登録していません')).toBeVisible();
  await expect(main(page).getByRole('status').filter({ hasText: '削除しました' })).toHaveCount(0);
  await page.getByRole('navigation', { name: 'メニュー' }).getByRole('link', { name: 'ホーム' }).click();
  await expect(main(page).getByText('登録されたサブスクがありません')).toBeVisible();
  await expect(countCard(page)).toContainText('0件');
});

test('統合① 本物の API の 409 DUPLICATE_CANDIDATE で S-05 に同名の警告が出て、［登録する］で別の契約として登録できる（04-06・04-07）', async ({ page }) => {
  const user = await loginAsNewUser(page);
  await seedSubscriptions(user.uid, [{ serviceName: 'Spotify' }]);
  await page.goto('/subscriptions/new');
  await expect(page.getByRole('heading', { level: 1, name: 'サブスクを追加' })).toBeVisible();
  await waitForHydration(page, 'form');
  // 前後の空白・英字の大文字小文字・全角と半角は、同名の判定では区別しない（lib/validation.ts の duplicateKey。決まりの一覧 C-17）
  await fillSubscriptionForm(page, { serviceName: ' spotify ', price: '980', billingCycle: 'monthly', firstBillingDate: addDays(todayJST(), 1), category: 'music' });
  await saveButton(page).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: '『spotify』はすでに登録されています。' })).toBeVisible();
  await expect(dialog).toContainText('別の契約として登録しますか？');
  await dialog.getByRole('button', { name: '登録する' }).click();

  await expect(page).toHaveURL(DETAIL_URL);
  await expect(detailCard(page).getByRole('heading', { level: 2, name: 'spotify' })).toBeVisible();
  expect((await subscriptionCountOf(user.uid)).docs).toBe(2);
});

test('統合① 本物の API の 404：無い ID・他人の ID の S-06 は「見つかりません」、開いた後に削除されたサブスクの編集の保存は「サブスクが見つかりません」（04-07・04-08）', async ({ page }) => {
  const user = await loginAsNewUser(page);
  const other = await loginAsNewUser(page); // 2人目でログインし直す（1人目のサブスクは他人のもの）
  const [mine] = await seedSubscriptions(other.uid, [{ serviceName: '自分のサブスク' }]);
  const [othersSub] = await seedSubscriptions(user.uid, [{ serviceName: '他人のサブスク' }]);

  await page.goto('/subscriptions/abcdefghijklmnopqrst');
  await expect(main(page).getByText('見つかりません', { exact: true })).toBeVisible();
  await page.goto(`/subscriptions/${othersSub.subscriptionId}`);
  await expect(main(page).getByText('見つかりません', { exact: true })).toBeVisible();
  await expect(main(page).getByText('他人のサブスク')).toHaveCount(0);

  await page.goto(`/subscriptions/${mine.subscriptionId}/edit`);
  await expect(page.getByRole('heading', { level: 1, name: 'サブスクを編集' })).toBeVisible();
  await waitForHydration(page, 'form');
  await expect(main(page).getByRole('textbox', { name: 'サービス名', exact: true })).toHaveValue('自分のサブスク');
  const deleted = await callApi(page, `/api/subscriptions/${mine.subscriptionId}`, { method: 'DELETE' });
  expect(deleted).toEqual({ ok: true, data: undefined });
  await fillSubscriptionForm(page, { price: '1200' });
  await saveButton(page).click();
  await expect(main(page).getByRole('alert').filter({ hasText: 'サブスクが見つかりません' })).toBeVisible();
  await expect(page).toHaveURL(EDIT_URL);
});

// ===== α版の統合（11/25）：登録 → Cron（HTTP）→ 通知イベント → S-03 の未読数 → 2回目は noop → S-07（04-13・04-14・04-15 のつなぎ） =====
// Cron（GET /api/cron/daily）は Emulator の全利用者を見るので、件数は「以上」で確かめ、通知は、この利用者のものだけを見る。
// route の PushSender は、統合で lib/push.ts の pushSender（本物の送信）に替えた。購読の無い利用者の通知イベントは skipped が保存される
// （仮の noopPushSender は何も保存しないので pending のまま。ここで、差し替えが効いていることを確かめる）
import { dayLabel, monthOf } from '../../lib/calendar';
import { cronAuthHeaders } from '../emulator/helpers';

test('α版の統合 本物の API で、S-05 の登録 → Cron を HTTP で呼ぶ（鍵なしは 401）→ 通知イベント → S-03 の未読1件 → 同じ日の2回目は noop → S-07 に請求が出る', async ({ page }) => {
  const today = todayJST();
  const tomorrow = addDays(today, 1); // 請求日が明日なら、今日の Cron で「請求日まであと1日」が作られる
  const db = adminDb();

  // 今日の cronRuns を消す（同じ日の2回目は noop になるため。ほかのテストや前の実行が先に呼んでいても、ここから数える）
  await db.collection('cronRuns').doc(today).delete();
  // 本物の送信に替えたので、ほかのテストが置いた購読（https://push.example.com/… のテスト用の宛先）へ送らないように、Emulator の購読を消しておく
  const pushSubscriptions = await db.collectionGroup('webPushSubscriptions').get();
  await Promise.all(pushSubscriptions.docs.map((doc) => doc.ref.delete()));

  // ---- S-05 登録（04-06・04-07。本物の POST /api/subscriptions） ----
  const user = await loginAsNewUser(page);
  await page.goto('/subscriptions/new');
  await expect(page.getByRole('heading', { level: 1, name: 'サブスクを追加' })).toBeVisible();
  await waitForHydration(page, 'form');
  await fillSubscriptionForm(page, { serviceName: 'α版の通知テスト', price: '1590', billingCycle: 'monthly', firstBillingDate: tomorrow, category: 'video' });
  await saveButton(page).click();
  await expect(page).toHaveURL(DETAIL_URL); // /subscriptions/new は拾わない
  const subscriptionId = new URL(page.url()).pathname.split('/').pop()!;

  // ---- Cron（04-14。本物の GET /api/cron/daily）：鍵なしは 401 ----
  const unauthorized = await page.request.get('/api/cron/daily');
  expect(unauthorized.status()).toBe(401);
  expect((await unauthorized.json()).error.code).toBe('INVALID_CRON_SECRET');
  expect((await db.collection('cronRuns').doc(today).get()).exists).toBe(false); // 401 では何も書かない

  // ---- 1回目：通知イベントが作られる ----
  const first = await page.request.get('/api/cron/daily', { headers: cronAuthHeaders() });
  expect(first.status()).toBe(200);
  const firstData = (await first.json()).data;
  expect(firstData.status).toBe('completed');
  expect(firstData.createdCount).toBeGreaterThanOrEqual(1);
  expect((await db.collection('cronRuns').doc(today).get()).get('status')).toBe('completed');

  const events = await db.collection('users').doc(user.uid).collection('notificationEvents').get();
  expect(events.size).toBe(1);
  expect(events.docs[0].data()).toMatchObject({
    uid: user.uid,
    subscriptionId,
    serviceNameAtNotification: 'α版の通知テスト',
    notificationType: 'billing',
    daysBefore: 1,
    targetDate: today,
    title: '請求日まであと1日',
    body: `${monthDay(tomorrow)}・¥1,590 の請求予定`,
    priceAtNotification: 1590,
    viewedAt: null,
    webPushStatus: 'skipped', // 04-15 の pushSender が保存した（この利用者には購読が無い）
    webPushDeliveredIds: [],
    webPushSentAt: null,
    webPushLastErrorCode: null,
  });

  // ---- S-03 ホーム（04-09。本物の GET /api/dashboard）：未読1件 ----
  await page.getByRole('navigation', { name: 'メニュー' }).getByRole('link', { name: 'ホーム' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ホーム' })).toBeVisible();
  await expect(page.getByRole('link', { name: '通知センター（未読1件）' })).toBeVisible();
  await expect(main(page).getByText('次の請求まであと1日')).toBeVisible();

  // ---- 同じ日の2回目は noop（通知イベントは増えない） ----
  const second = await page.request.get('/api/cron/daily', { headers: cronAuthHeaders() });
  expect(second.status()).toBe(200);
  expect((await second.json()).data).toEqual({ status: 'noop', createdCount: 0, sentCount: 0, failedCount: 0 });
  expect((await db.collection('users').doc(user.uid).collection('notificationEvents').get()).size).toBe(1);
  await page.reload();
  await expect(page.getByRole('link', { name: '通知センター（未読1件）' })).toBeVisible();

  // ---- S-07 請求カレンダー（04-13。本物の GET /api/calendar）：明日に請求が出る ----
  await page.getByRole('navigation', { name: 'メニュー' }).getByRole('link', { name: 'カレンダー' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '請求カレンダー' })).toBeVisible();
  if (monthOf(tomorrow) !== monthOf(today)) await main(page).getByRole('button', { name: '翌月' }).click(); // 今日が月末なら翌月へ
  const day = main(page).getByRole('button', { name: `${dayLabel(tomorrow)} 請求予定1件` });
  await expect(day).toBeVisible();
  await day.click();
  await expect(main(page).getByRole('heading', { level: 2, name: `${dayLabel(tomorrow)}の予定` })).toBeVisible();
  const items = main(page).getByRole('list', { name: `${dayLabel(tomorrow)}の請求予定` }).getByRole('listitem');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('α版の通知テスト');
  await expect(items.first()).toContainText('請求予定・¥1,590');
  await items.first().getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/subscriptions/${subscriptionId}$`));
});
