// ホーム（S-03）とサブスク一覧（S-04）の画面テスト（04-09）
// テスト一覧の No.7（0件と、あわせての S-04 の既定の並び）・No.70（画面の部分）・No.41（読み込み失敗）
// GET /api/subscriptions（04-07）はまだ無いので mockApi で応答を作る。GET /api/dashboard は 0件のときだけ本物を使う
import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalScroll, expectTapTargets, loginAsNewUser, mockApi } from './helpers';
import type { DashboardDto, SubscriptionDto } from '@/lib/types';

let seq = 0;
function subscription(fields: Partial<SubscriptionDto> & Pick<SubscriptionDto, 'serviceName' | 'price' | 'nextBillingDate'>): SubscriptionDto {
  seq += 1;
  const createdAt = new Date(Date.UTC(2026, 9, 1, 0, seq)).toISOString();
  return {
    subscriptionId: `e2eSubscription${String(seq).padStart(5, '0')}`,
    planName: null,
    billingCycle: 'monthly',
    firstBillingDate: fields.nextBillingDate,
    billingDayMode: 'fixedDay',
    category: 'other',
    trialEnabled: false,
    trialEndDate: null,
    websiteUrl: null,
    cancelUrl: null,
    paymentMethod: null,
    memo: null,
    subscriptionNotificationEnabled: true,
    createdAt,
    updatedAt: createdAt,
    ...fields,
  };
}

function dashboard(fields: Partial<DashboardDto> = {}): DashboardDto {
  return {
    weekTotal: { count: 2, amountJPY: 2570 },
    monthTotal: { count: 4, amountJPY: 12050 },
    monthlyEquivalentJPY: 13050,
    yearlyEquivalentJPY: 156600,
    subscriptionCount: 5,
    unreadCount: 1,
    nextBills: [
      { subscriptionId: 'e2eSpotify0000000001', serviceName: 'Spotify', websiteUrl: null, date: '2026-11-05', priceJPY: 980, daysLeft: 1 },
      { subscriptionId: 'e2eNetflix0000000001', serviceName: 'Netflix', websiteUrl: 'https://www.netflix.com', date: '2026-11-08', priceJPY: 1590, daysLeft: 4 },
      { subscriptionId: 'e2eAdobe000000000001', serviceName: 'Adobe Creative Cloud', websiteUrl: null, date: '2026-11-11', priceJPY: 6480, daysLeft: 7 },
    ],
    ...fields,
  };
}

function cardNames(page: Page) {
  return page.getByRole('list', { name: 'サブスク一覧' }).getByRole('listitem');
}

test.describe('S-03 ホーム', () => {
  test('No.7 サブスク0件でホームを開くと、¥0 と［サブスクを登録する］が出る', async ({ page }) => {
    await loginAsNewUser(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'ホーム' })).toBeVisible();
    await expect(page.getByText('登録されたサブスクがありません')).toBeVisible();
    await expect(page.getByText('サブスクを追加して、請求予定をまとめて管理しましょう')).toBeVisible();
    const main = page.getByRole('main');
    await expect(main.getByText('¥0', { exact: true })).toHaveCount(4); // 今月・今週・月額換算・年額換算
    await expect(main.getByText('0件', { exact: true })).toHaveCount(3); // 今月・今週・登録数
    await expect(page.getByText('次の請求予定')).toBeVisible();
    await expect(page.getByRole('link', { name: '＋ サブスクを登録する' })).toHaveAttribute('href', '/subscriptions/new');
    await expect(page.getByRole('link', { name: '通知センター', exact: true })).toBeVisible(); // 未読0件はバッジなし
  });

  test('テストデータの集計を表示する（次の請求カード・今後の支払い予定・未読のバッジ）', async ({ page }) => {
    await loginAsNewUser(page);
    await mockApi(page, 'GET', '/api/dashboard', { data: dashboard() });
    await page.goto('/');
    await expect(page.getByText('次の請求まであと1日')).toBeVisible();
    await expect(page.getByText('11/05・¥980・あと1日')).toBeVisible();
    await expect(page.getByText('¥12,050')).toBeVisible();
    await expect(page.getByText('¥2,570')).toBeVisible();
    await expect(page.getByText('5件')).toBeVisible();
    await expect(page.getByText('¥13,050')).toBeVisible();
    await expect(page.getByText('¥156,600')).toBeVisible();
    await expect(page.getByText('11/05 ¥980 あと1日')).toBeVisible();
    await expect(page.getByText('11/08 ¥1,590 あと4日')).toBeVisible();
    await expect(page.getByText('11/11 ¥6,480 あと7日')).toBeVisible();
    await expect(page.getByText('予定額は登録内容からの予測です')).toBeVisible();
    await expect(page.getByText('実際の決済額・支払い済み状態ではありません')).toBeVisible();
    await expect(page.getByRole('link', { name: '通知センター（未読1件）' })).toBeVisible();
    await expect(page.getByRole('link', { name: '＋ サブスクを追加' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'すべて見る ›' })).toHaveAttribute('href', '/subscriptions');
  });

  test('未読が100件以上なら、ベルのバッジは「99+」', async ({ page }) => {
    await loginAsNewUser(page);
    await mockApi(page, 'GET', '/api/dashboard', { data: dashboard({ unreadCount: 120 }) });
    await page.goto('/');
    const bell = page.getByRole('link', { name: '通知センター（未読120件）' });
    await expect(bell).toBeVisible();
    await expect(bell).toContainText('99+');
  });

  test('No.41 ホームの読み込みに失敗すると「請求予定を読み込めませんでした…」と［再試行］（金額は出さず、ベルはバッジなし）。再試行で読める', async ({ page }) => {
    await loginAsNewUser(page);
    const mock = await mockApi(page, 'GET', '/api/dashboard', [
      { status: 500, error: { code: 'INTERNAL_ERROR', message: '処理に失敗しました。もう一度お試しください' } },
      { data: dashboard() },
    ]);
    await page.goto('/');
    await expect(page.getByText('請求予定を読み込めませんでした。もう一度お試しください')).toBeVisible();
    await expect(page.getByText('今月の予定額')).toHaveCount(0);
    await expect(page.getByRole('link', { name: '通知センター', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '再試行' }).click();
    await expect(page.getByText('¥12,050')).toBeVisible();
    expect(mock.calls()).toBe(2);
  });

  test('No.41 一時的な障害（503）のときは共通の文「一時的に利用できません…」', async ({ page }) => {
    await loginAsNewUser(page);
    await mockApi(page, 'GET', '/api/dashboard', {
      status: 503,
      error: { code: 'TEMPORARILY_UNAVAILABLE', message: '一時的に利用できません。時間をおいて再試行してください' },
    });
    await page.goto('/');
    await expect(page.getByText('一時的に利用できません。時間をおいて再試行してください')).toBeVisible();
    await expect(page.getByRole('button', { name: '再試行' })).toBeVisible();
  });
});

test.describe('S-04 サブスク一覧', () => {
  test('No.7 並べ替えを作らなくても、次回請求日の近い順（同じ日は登録の古い順）で全件が出る', async ({ page }) => {
    const items = [
      subscription({ serviceName: '遅い', price: 500, nextBillingDate: '2026-11-20' }),
      subscription({ serviceName: '同じ日・古い', price: 980, nextBillingDate: '2026-11-08', category: 'music' }),
      subscription({ serviceName: '同じ日・新しい', price: 1590, nextBillingDate: '2026-11-08', category: 'video', billingCycle: 'yearly' }),
    ];
    await loginAsNewUser(page);
    await mockApi(page, 'GET', '/api/subscriptions', { data: { items, totalCount: items.length } });
    await page.goto('/subscriptions');
    await expect(page.getByRole('heading', { level: 1, name: 'サブスク一覧' })).toBeVisible();
    await expect(cardNames(page)).toHaveCount(3);
    await expect(cardNames(page).nth(0)).toContainText('同じ日・古い');
    await expect(cardNames(page).nth(1)).toContainText('同じ日・新しい');
    await expect(cardNames(page).nth(2)).toContainText('遅い');
    await expect(cardNames(page).nth(0)).toContainText('音楽・¥980 / 月');
    await expect(cardNames(page).nth(0)).toContainText('次回請求 11/08');
    await expect(cardNames(page).nth(1)).toContainText('動画・¥1,590 / 年');
    await expect(cardNames(page).nth(0).getByRole('link')).toHaveAttribute('href', `/subscriptions/${items[1].subscriptionId}`);
  });

  test('テストデータ5件は Spotify → Netflix → Adobe Creative Cloud → ChatGPT → iCloud+ の順', async ({ page }) => {
    const items = [
      subscription({ serviceName: 'Netflix', price: 1590, nextBillingDate: '2026-11-08' }),
      subscription({ serviceName: 'Spotify', price: 980, nextBillingDate: '2026-11-05' }),
      subscription({ serviceName: 'Adobe Creative Cloud', price: 6480, nextBillingDate: '2026-11-11' }),
      subscription({ serviceName: 'iCloud+', price: 12000, nextBillingDate: '2026-12-01', billingCycle: 'yearly' }),
      subscription({ serviceName: 'ChatGPT', price: 3000, nextBillingDate: '2026-11-30', billingDayMode: 'endOfMonth' }),
    ];
    await loginAsNewUser(page);
    await mockApi(page, 'GET', '/api/subscriptions', { data: { items, totalCount: items.length } });
    await page.goto('/subscriptions');
    await expect(cardNames(page)).toHaveCount(5);
    const names = await cardNames(page).locator('span.text-lg').allTextContents();
    expect(names).toEqual(['Spotify', 'Netflix', 'Adobe Creative Cloud', 'ChatGPT', 'iCloud+']);
  });

  test('0件のときは「サブスクを登録していません」と案内、［サブスクを追加］', async ({ page }) => {
    await loginAsNewUser(page);
    await mockApi(page, 'GET', '/api/subscriptions', { data: { items: [], totalCount: 0 } });
    await page.goto('/subscriptions');
    await expect(page.getByText('サブスクを登録していません')).toBeVisible();
    await expect(page.getByText('下の［サブスクを追加］から最初のサブスクを登録しましょう')).toBeVisible();
    await expect(page.getByRole('link', { name: '＋ サブスクを追加' })).toHaveAttribute('href', '/subscriptions/new');
  });

  test('No.41 一覧の読み込みに失敗すると「読み込めませんでした」「もう一度お試しください」と［再試行］。再試行で読める', async ({ page }) => {
    await loginAsNewUser(page);
    const items = [subscription({ serviceName: 'Spotify', price: 980, nextBillingDate: '2026-11-05' })];
    await mockApi(page, 'GET', '/api/subscriptions', [
      { status: 500, error: { code: 'INTERNAL_ERROR', message: '処理に失敗しました。もう一度お試しください' } },
      { data: { items, totalCount: 1 } },
    ]);
    await page.goto('/subscriptions');
    await expect(page.getByText('読み込めませんでした')).toBeVisible();
    await expect(page.getByText('もう一度お試しください')).toBeVisible();
    await page.getByRole('button', { name: '再試行' }).click();
    await expect(cardNames(page)).toHaveCount(1);
  });

  test('S-06 から移ってきたときの「削除しました」を画面名の下に出し、開き直すと出さない', async ({ page }) => {
    await loginAsNewUser(page);
    await mockApi(page, 'GET', '/api/subscriptions', { data: { items: [], totalCount: 0 } });
    await page.evaluate(() => window.sessionStorage.setItem('subwatch.flash', '削除しました')); // S-06（04-08）の setFlash と同じ
    await page.goto('/subscriptions');
    await expect(page.getByRole('status').filter({ hasText: '削除しました' })).toBeVisible();
    await page.reload();
    await expect(page.getByText('サブスクを登録していません')).toBeVisible();
    await expect(page.getByText('削除しました')).toHaveCount(0);
  });
});

test.describe('S-03 と S-04 のつながり', () => {
  test('No.70 7日以内の請求が無い2件（iCloud+・ChatGPT）：S-03 の次の請求カードと一覧の欄に「7日以内の請求予定はありません」、登録数「2件」と S-04 のカード2枚が一致', async ({ page }) => {
    const items = [
      subscription({ serviceName: 'iCloud+', price: 12000, nextBillingDate: '2026-12-01', billingCycle: 'yearly', category: 'cloud' }),
      subscription({ serviceName: 'ChatGPT', price: 3000, nextBillingDate: '2026-11-30', billingDayMode: 'endOfMonth', category: 'ai' }),
    ];
    await loginAsNewUser(page);
    await mockApi(page, 'GET', '/api/dashboard', {
      data: dashboard({
        weekTotal: { count: 0, amountJPY: 0 },
        monthTotal: { count: 1, amountJPY: 3000 },
        monthlyEquivalentJPY: 4000,
        yearlyEquivalentJPY: 48000,
        subscriptionCount: 2,
        unreadCount: 0,
        nextBills: [],
      }),
    });
    await mockApi(page, 'GET', '/api/subscriptions', { data: { items, totalCount: items.length } });
    await page.goto('/');
    await expect(page.getByText('次の請求予定')).toBeVisible();
    await expect(page.getByText('7日以内の請求予定はありません')).toHaveCount(2);
    await expect(page.getByText('2件', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'すべて見る ›' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'サブスク一覧' })).toBeVisible();
    await expect(cardNames(page)).toHaveCount(2);
  });

  test('S-03・S-04 は幅375pxで横スクロールなし・押せる大きさ44px以上', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const items = [
      subscription({ serviceName: 'Adobe Creative Cloud Complete Plan For Teams', price: 10000000, nextBillingDate: '2026-11-11' }),
      subscription({ serviceName: 'Spotify', price: 980, nextBillingDate: '2026-11-05' }),
    ];
    await loginAsNewUser(page);
    await mockApi(page, 'GET', '/api/dashboard', { data: dashboard({ unreadCount: 120 }) });
    await mockApi(page, 'GET', '/api/subscriptions', { data: { items, totalCount: items.length } });
    await page.goto('/');
    await expect(page.getByText('¥12,050')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    await page.goto('/subscriptions');
    await expect(cardNames(page)).toHaveCount(2);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
  });
});
