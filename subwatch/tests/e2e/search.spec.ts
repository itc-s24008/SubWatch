// S-04 の検索・カテゴリーの絞り込み・並べ替えの画面テスト（04-20。F-10 の Want）
// テスト一覧 No.58（成功基準①の判定から除く）。一覧の応答は mockApi で作る（テストデータ5件。nextBillingDate は基準日 2026-11-04 の値で固定し、
// 既定の並びも応答の値で決める。page.clock は使わない）
import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalScroll, expectTapTargets, loginAsNewUser, mockApi, subscriptionDto, waitForHydration } from './helpers';
import type { SubscriptionDto } from '@/lib/types';

// テストデータ5件（機能設計書「テストデータ」。API の並び＝作成日時の昇順＝表の行の順。カテゴリーは画面設計書「サンプルデータ」）
const TEST_DATA: SubscriptionDto[] = [
  subscriptionDto({ subscriptionId: 'e2eSearchNetflix0001', serviceName: 'Netflix', price: 1590, billingCycle: 'monthly', firstBillingDate: '2026-10-08', nextBillingDate: '2026-11-08', category: 'video', createdAt: '2026-11-04T00:00:00.000Z' }),
  subscriptionDto({ subscriptionId: 'e2eSearchSpotify0001', serviceName: 'Spotify', planName: null, price: 980, billingCycle: 'monthly', firstBillingDate: '2026-09-05', nextBillingDate: '2026-11-05', category: 'music', websiteUrl: null, paymentMethod: null, createdAt: '2026-11-04T00:00:00.001Z' }),
  subscriptionDto({ subscriptionId: 'e2eSearchAdobe000001', serviceName: 'Adobe Creative Cloud', planName: null, price: 6480, billingCycle: 'monthly', firstBillingDate: '2026-10-11', nextBillingDate: '2026-11-11', category: 'cloud', websiteUrl: null, paymentMethod: null, createdAt: '2026-11-04T00:00:00.002Z' }),
  subscriptionDto({ subscriptionId: 'e2eSearchiCloud00001', serviceName: 'iCloud+', planName: null, price: 12000, billingCycle: 'yearly', firstBillingDate: '2025-12-01', nextBillingDate: '2026-12-01', category: 'cloud', websiteUrl: null, paymentMethod: null, createdAt: '2026-11-04T00:00:00.003Z' }),
  subscriptionDto({ subscriptionId: 'e2eSearchChatGPT0001', serviceName: 'ChatGPT', planName: null, price: 3000, billingCycle: 'monthly', firstBillingDate: '2026-11-30', nextBillingDate: '2026-11-30', billingDayMode: 'endOfMonth', category: 'ai', trialEnabled: true, trialEndDate: '2026-11-10', websiteUrl: null, paymentMethod: null, createdAt: '2026-11-04T00:00:00.004Z' }),
];

const DEFAULT_ORDER = ['Spotify', 'Netflix', 'Adobe Creative Cloud', 'ChatGPT', 'iCloud+'];

function cardNames(page: Page) {
  return page.getByRole('list', { name: 'サブスク一覧' }).getByRole('listitem').locator('span.text-lg');
}

function searchBox(page: Page) {
  return page.getByRole('main').getByRole('searchbox', { name: 'サービス名で検索' });
}

function categoryTab(page: Page, name: string) {
  return page.getByRole('main').getByRole('group', { name: 'カテゴリー' }).getByRole('button', { name, exact: true });
}

function sortSelect(page: Page) {
  return page.getByRole('main').getByRole('combobox', { name: '並べ替え' });
}

async function openList(page: Page, items: SubscriptionDto[] = TEST_DATA) {
  await loginAsNewUser(page);
  const handle = await mockApi(page, 'GET', '/api/subscriptions', { data: { items, totalCount: items.length } });
  await page.goto('/subscriptions');
  await waitForHydration(page, '#subscription-search');
  return handle;
}

test.describe('S-04 検索・カテゴリー・並べ替え（No.58）', () => {
  test('No.58 検索：部分一致（前後の空白・大文字小文字を無視）。1文字ごとに絞り込み、API は呼び直さない', async ({ page }) => {
    const list = await openList(page);
    await expect(searchBox(page)).toHaveAttribute('placeholder', 'サービス名で検索');
    await expect(cardNames(page)).toHaveText(DEFAULT_ORDER);

    await searchBox(page).fill('cloud');
    await expect(cardNames(page)).toHaveText(['Adobe Creative Cloud', 'iCloud+']);

    await searchBox(page).fill('　 NETFLIX 　');
    await expect(cardNames(page)).toHaveText(['Netflix']);

    await searchBox(page).fill('');
    await searchBox(page).pressSequentially('SPO');
    await expect(cardNames(page)).toHaveText(['Spotify']);

    await searchBox(page).fill('   ');
    await expect(cardNames(page)).toHaveText(DEFAULT_ORDER);
    expect(list.calls()).toBe(1);
  });

  test('No.58 検索の0件は「条件に合うサブスクはありません」。全角の英字は半角と同じにしない', async ({ page }) => {
    await openList(page);
    await searchBox(page).fill('Hulu');
    await expect(page.getByRole('main').getByText('条件に合うサブスクはありません')).toBeVisible();
    await expect(page.getByRole('list', { name: 'サブスク一覧' })).toHaveCount(0);
    await expect(page.getByText('サブスクを登録していません')).toHaveCount(0);
    await expect(page.getByRole('link', { name: '＋ サブスクを追加' })).toBeVisible();

    await searchBox(page).fill('ｎｅｔｆｌｉｘ');
    await expect(page.getByRole('main').getByText('条件に合うサブスクはありません')).toBeVisible();

    await searchBox(page).fill('net');
    await expect(cardNames(page)).toHaveText(['Netflix']);
    await expect(page.getByText('条件に合うサブスクはありません')).toHaveCount(0);
  });

  test('No.58 カテゴリーの絞り込み：既定は「すべて」。「クラウド」で2件、「ゲーム」で0件、「すべて」で解除。検索語と両方に合うものだけ', async ({ page }) => {
    await openList(page);
    await expect(categoryTab(page, 'すべて')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('main').getByRole('group', { name: 'カテゴリー' }).getByRole('button')).toHaveText(['すべて', '動画', '音楽', 'クラウド', '学習', 'AI', 'ゲーム', 'ニュース', '仕事', 'その他']);

    await categoryTab(page, 'クラウド').click();
    await expect(categoryTab(page, 'クラウド')).toHaveAttribute('aria-pressed', 'true');
    await expect(categoryTab(page, 'すべて')).toHaveAttribute('aria-pressed', 'false');
    await expect(cardNames(page)).toHaveText(['Adobe Creative Cloud', 'iCloud+']);

    await searchBox(page).fill('icloud');
    await expect(cardNames(page)).toHaveText(['iCloud+']);
    await searchBox(page).fill('');

    await categoryTab(page, 'ゲーム').click();
    await expect(page.getByRole('main').getByText('条件に合うサブスクはありません')).toBeVisible();

    await categoryTab(page, 'すべて').click();
    await expect(cardNames(page)).toHaveText(DEFAULT_ORDER);
  });

  test('No.58 並べ替え3種：次回請求日が近い順（既定）・料金の高い順・登録日の新しい順', async ({ page }) => {
    await openList(page);
    await expect(sortSelect(page)).toHaveValue('nextBillingDate');
    await expect(sortSelect(page).locator('option')).toHaveText(['次回請求日が近い順', '料金の高い順', '登録日の新しい順']);
    await expect(cardNames(page)).toHaveText(DEFAULT_ORDER);

    await sortSelect(page).selectOption({ label: '料金の高い順' });
    await expect(cardNames(page)).toHaveText(['iCloud+', 'Adobe Creative Cloud', 'ChatGPT', 'Netflix', 'Spotify']);

    await sortSelect(page).selectOption({ label: '登録日の新しい順' });
    await expect(cardNames(page)).toHaveText(['ChatGPT', 'iCloud+', 'Adobe Creative Cloud', 'Spotify', 'Netflix']);

    await categoryTab(page, 'クラウド').click();
    await expect(cardNames(page)).toHaveText(['iCloud+', 'Adobe Creative Cloud']);

    await sortSelect(page).selectOption({ label: '次回請求日が近い順' });
    await expect(cardNames(page)).toHaveText(['Adobe Creative Cloud', 'iCloud+']);
  });

  test('登録が0件のときは、検索語やカテゴリーを指定していても「サブスクを登録していません」。①②③は出す', async ({ page }) => {
    await openList(page, []);
    await expect(page.getByText('サブスクを登録していません')).toBeVisible();
    await searchBox(page).fill('Netflix');
    await categoryTab(page, '動画').click();
    await sortSelect(page).selectOption({ label: '料金の高い順' });
    await expect(page.getByText('サブスクを登録していません')).toBeVisible();
    await expect(page.getByText('条件に合うサブスクはありません')).toHaveCount(0);
  });

  test('読み込み失敗のときも①②③を出す', async ({ page }) => {
    await loginAsNewUser(page);
    await mockApi(page, 'GET', '/api/subscriptions', { status: 500, error: { code: 'INTERNAL_ERROR', message: '処理に失敗しました。もう一度お試しください' } });
    await page.goto('/subscriptions');
    await expect(page.getByText('読み込めませんでした')).toBeVisible();
    await expect(searchBox(page)).toBeVisible();
    await expect(categoryTab(page, 'すべて')).toBeVisible();
    await expect(sortSelect(page)).toBeVisible();
  });

  test('検索語・カテゴリー・並べ替えは保存しない（ほかの画面から戻ると既定に戻る。URL にも入れない）', async ({ page }) => {
    await openList(page);
    await searchBox(page).fill('cloud');
    await categoryTab(page, 'クラウド').click();
    await sortSelect(page).selectOption({ label: '料金の高い順' });
    await expect(cardNames(page)).toHaveText(['iCloud+', 'Adobe Creative Cloud']);
    expect(new URL(page.url()).search).toBe('');

    await page.getByRole('navigation', { name: 'メニュー' }).getByRole('link', { name: 'ホーム' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'ホーム' })).toBeVisible();
    await page.getByRole('navigation', { name: 'メニュー' }).getByRole('link', { name: '一覧' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'サブスク一覧' })).toBeVisible();
    await expect(searchBox(page)).toHaveValue('');
    await expect(categoryTab(page, 'すべて')).toHaveAttribute('aria-pressed', 'true');
    await expect(sortSelect(page)).toHaveValue('nextBillingDate');
    await expect(cardNames(page)).toHaveText(DEFAULT_ORDER);
  });

  test('幅375pxで横スクロールなし（カテゴリーの横スクロールは枠の中だけ）・押せる大きさ44px以上', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openList(page);
    await expect(cardNames(page)).toHaveText(DEFAULT_ORDER);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    const tabs = page.getByRole('main').getByRole('group', { name: 'カテゴリー' });
    const overflow = await tabs.evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(overflow).toBe(true); // 375px では枠の中で横にスクロールする
    await categoryTab(page, 'その他').click(); // 枠の外に隠れたタブもスクロールして押せる
    await expect(page.getByRole('main').getByText('条件に合うサブスクはありません')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
