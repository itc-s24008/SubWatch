// 請求カレンダー（S-07）の画面テスト（04-13）
// テスト一覧の No.52・No.71（画面の部分）、No.41（S-07 の読み込み失敗）と、月の連続切り替え（最後に頼んだ月の応答だけを使う）
// 今日はブラウザの時刻（page.clock.setFixedTime。ログインの前に決める）で 2026-11-04（水）にする。
// No.52・No.71 の月の表示は、Emulator にサブスクを置いて本物の GET /api/calendar で確かめる（month を指定した集計は今日によらない）。
// 失敗・400・応答の遅れの場面は mockApi で応答を作る
import { expect, test, type Page } from '@playwright/test';
import { seedSubscriptions, TEST_DATA_SUBSCRIPTIONS } from '../emulator/helpers';
import { expectNoHorizontalScroll, expectTapTargets, loginAsNewUser, mockApi } from './helpers';
import type { CalendarDto } from '@/lib/types';

const TODAY = new Date('2026-11-04T10:00:00+09:00'); // 基準日 2026-11-04（水）の日本時間10時

// 画面設計書「サンプルデータ」の 2026年11月（mockApi の応答）
const NOVEMBER: CalendarDto = {
  month: '2026-11',
  days: [
    { date: '2026-11-05', items: [{ subscriptionId: 'e2eSpotify0000000001', serviceName: 'Spotify', priceJPY: 980 }] },
    { date: '2026-11-08', items: [{ subscriptionId: 'e2eNetflix0000000001', serviceName: 'Netflix', priceJPY: 1590 }] },
    { date: '2026-11-11', items: [{ subscriptionId: 'e2eAdobe000000000001', serviceName: 'Adobe Creative Cloud', priceJPY: 6480 }] },
    { date: '2026-11-30', items: [{ subscriptionId: 'e2eChatGPT0000000001', serviceName: 'ChatGPT', priceJPY: 3000 }] },
  ],
  monthTotalJPY: 12050,
};

// テスト一覧 No.52 の 2026-12（mockApi の応答）
const DECEMBER: CalendarDto = {
  month: '2026-12',
  days: [
    { date: '2026-12-01', items: [{ subscriptionId: 'e2eICloud00000000001', serviceName: 'iCloud+', priceJPY: 12000 }] },
    { date: '2026-12-05', items: [{ subscriptionId: 'e2eSpotify0000000001', serviceName: 'Spotify', priceJPY: 980 }] },
    { date: '2026-12-08', items: [{ subscriptionId: 'e2eNetflix0000000001', serviceName: 'Netflix', priceJPY: 1590 }] },
    { date: '2026-12-11', items: [{ subscriptionId: 'e2eAdobe000000000001', serviceName: 'Adobe Creative Cloud', priceJPY: 6480 }] },
    { date: '2026-12-31', items: [{ subscriptionId: 'e2eChatGPT0000000001', serviceName: 'ChatGPT', priceJPY: 3000 }] },
  ],
  monthTotalJPY: 24050,
};

const JANUARY: CalendarDto = { month: '2027-01', days: [], monthTotalJPY: 0 };

const LOAD_FAILED = 'カレンダーを読み込めませんでした。もう一度お試しください';

function main(page: Page) {
  return page.getByRole('main');
}

// ② の日付のボタン（aria-label は「11月5日（木）」、請求予定がある日は「11月5日（木） 請求予定1件」）
function day(page: Page, name: string) {
  return main(page).getByRole('button', { name, exact: true });
}

async function openCalendar(page: Page): Promise<void> {
  await page.goto('/calendar');
  await expect(page.getByRole('heading', { level: 1, name: '請求カレンダー' })).toBeVisible();
}

async function loginAt(page: Page, now: Date = TODAY) {
  await page.clock.setFixedTime(now); // 今日を決める（ログインの前）
  return loginAsNewUser(page);
}

test.describe('S-07 請求カレンダー', () => {
  test('No.52 テストデータの2026年11月は5日・8日・11日・30日に点、月間¥12,050・4件。日付を押すとその日の予定、翌月の12月は5件・¥24,050', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const user = await loginAt(page);
    const docs = await seedSubscriptions(user.uid, TEST_DATA_SUBSCRIPTIONS);
    const spotify = docs.find((doc) => doc.serviceName === 'Spotify')!;
    await openCalendar(page);

    await expect(page.locator('header').getByText('SubWatch', { exact: true })).toBeVisible();
    await expect(main(page).getByRole('heading', { name: '2026年11月' })).toBeVisible();
    // ② 請求予定がある日（点）は4日だけ
    for (const name of ['11月5日（木） 請求予定1件', '11月8日（日） 請求予定1件', '11月11日（水） 請求予定1件', '11月30日（月） 請求予定1件']) {
      await expect(day(page, name)).toBeVisible();
    }
    await expect(main(page).getByRole('button', { name: /請求予定\d+件$/ })).toHaveCount(4);
    // 月曜始まりで30日分。前後の月の日付（10/26〜10/31・12/1〜12/6）は押せない
    await expect(main(page).getByRole('button', { name: /^11月\d+日/ })).toHaveCount(30);
    await expect(main(page).getByRole('button', { name: /^(10|12)月/ })).toHaveCount(0);
    // 初期は今日（11/04）を選ぶ
    await expect(day(page, '11月4日（水）')).toHaveAttribute('aria-pressed', 'true');
    await expect(day(page, '11月5日（木） 請求予定1件')).toHaveAttribute('aria-pressed', 'false');
    // ③ 凡例 ④ 月間請求予定額
    await expect(main(page).getByText('凡例')).toBeVisible();
    await expect(main(page).getByText('11月の請求予定額')).toBeVisible();
    await expect(main(page).getByText('¥12,050', { exact: true })).toBeVisible();
    await expect(main(page).getByText('4件', { exact: true })).toBeVisible();
    await expect(main(page).getByText('この月の請求予定はありません')).toHaveCount(0);
    // ⑤ 選択日（今日）に予定なし
    await expect(main(page).getByRole('heading', { name: '11月4日（水）の予定' })).toBeVisible();
    await expect(main(page).getByText('この日の請求予定はありません')).toBeVisible();
    // ⑦ 注意書き（2行）
    await expect(main(page).getByText('金額は請求予定額です。', { exact: true })).toBeVisible();
    await expect(main(page).getByText('予定額は実際の決済額ではありません', { exact: true })).toBeVisible();
    // Google Calendar のボタンは出さない
    await expect(page.getByText(/Google/)).toHaveCount(0);

    // 11/05 を押すと Spotify の予定（図 S-07 の状態）
    await day(page, '11月5日（木） 請求予定1件').click();
    await expect(day(page, '11月5日（木） 請求予定1件')).toHaveAttribute('aria-pressed', 'true');
    await expect(day(page, '11月4日（水）')).toHaveAttribute('aria-pressed', 'false');
    await expect(main(page).getByRole('heading', { name: '11月5日（木）の予定' })).toBeVisible();
    await expect(main(page).getByText('この日の請求予定はありません')).toHaveCount(0);
    const row = main(page).getByRole('link', { name: /Spotify/ });
    await expect(row).toHaveAttribute('href', `/subscriptions/${spotify.subscriptionId}`);
    await expect(row).toContainText('請求予定・¥980');
    await expect(row.locator('span[aria-hidden="true"]').first()).toHaveText('S'); // 頭文字のアイコン

    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);

    // 翌月：12月は iCloud+ の1日を含む5件。選ぶ日は1日
    await main(page).getByRole('button', { name: '翌月' }).click();
    await expect(main(page).getByRole('heading', { name: '2026年12月' })).toBeVisible();
    await expect(main(page).getByText('12月の請求予定額')).toBeVisible();
    await expect(main(page).getByText('¥24,050', { exact: true })).toBeVisible();
    await expect(main(page).getByText('5件', { exact: true })).toBeVisible();
    await expect(main(page).getByRole('button', { name: /請求予定\d+件$/ })).toHaveCount(5);
    await expect(day(page, '12月1日（火） 請求予定1件')).toHaveAttribute('aria-pressed', 'true');
    await expect(day(page, '12月31日（木） 請求予定1件')).toBeVisible();
    await expect(main(page).getByRole('heading', { name: '12月1日（火）の予定' })).toBeVisible();
    await expect(main(page).getByRole('link', { name: /iCloud\+/ })).toContainText('請求予定・¥12,000');

    // 前月で11月へ戻ると、選ぶ日は今日。予定の行を押すと S-06
    await main(page).getByRole('button', { name: '前月' }).click();
    await expect(day(page, '11月4日（水）')).toHaveAttribute('aria-pressed', 'true');
    await day(page, '11月5日（木） 請求予定1件').click();
    await main(page).getByRole('link', { name: /Spotify/ }).click();
    await expect(page).toHaveURL(new RegExp(`/subscriptions/${spotify.subscriptionId}$`));
  });

  test('No.71 3か月・6か月の請求日：11月は月末に丸めた30日、12月は15日、2027年1月は「この月の請求予定はありません」（¥0・0件）、2月は28日', async ({ page }) => {
    const user = await loginAt(page);
    await seedSubscriptions(user.uid, [
      { serviceName: 'A', price: 1200, billingCycle: 'quarterly', firstBillingDate: '2026-08-31', billingDayMode: 'fixedDay', nextBillingDate: '2026-11-30' },
      { serviceName: 'B', price: 3000, billingCycle: 'semiAnnual', firstBillingDate: '2026-06-15', billingDayMode: 'fixedDay', nextBillingDate: '2026-12-15' },
    ]);
    await openCalendar(page);
    const next = main(page).getByRole('button', { name: '翌月' });
    const dots = main(page).getByRole('button', { name: /請求予定\d+件$/ });

    await expect(main(page).getByRole('heading', { name: '2026年11月' })).toBeVisible();
    await expect(day(page, '11月30日（月） 請求予定1件')).toBeVisible();
    await expect(dots).toHaveCount(1);

    await next.click();
    await expect(main(page).getByRole('heading', { name: '2026年12月' })).toBeVisible();
    await expect(day(page, '12月15日（火） 請求予定1件')).toBeVisible();
    await expect(dots).toHaveCount(1);

    await next.click();
    await expect(main(page).getByRole('heading', { name: '2027年1月' })).toBeVisible();
    await expect(main(page).getByText('1月の請求予定額')).toBeVisible();
    await expect(main(page).getByText('この月の請求予定はありません')).toBeVisible();
    await expect(main(page).getByText('¥0', { exact: true })).toBeVisible();
    await expect(main(page).getByText('0件', { exact: true })).toBeVisible();
    await expect(dots).toHaveCount(0);
    await expect(main(page).getByRole('heading', { name: '1月1日（金）の予定' })).toBeVisible();

    await next.click();
    await expect(main(page).getByRole('heading', { name: '2027年2月' })).toBeVisible();
    await expect(day(page, '2月28日（日） 請求予定1件')).toBeVisible();
    await expect(dots).toHaveCount(1);
    await day(page, '2月28日（日） 請求予定1件').click();
    await expect(main(page).getByRole('link', { name: /A/ })).toContainText('請求予定・¥1,200');
  });

  test('No.71 あわせて month が不正（400）のときは、今月（2026-11）を指定して読み直して表示する', async ({ page }) => {
    await loginAt(page);
    const november = await mockApi(page, 'GET', '/api/calendar?month=2026-11', { data: NOVEMBER });
    const december = await mockApi(page, 'GET', '/api/calendar?month=2026-12', {
      status: 400,
      error: { code: 'VALIDATION_ERROR', message: '入力内容を確認してください', field: 'month', details: [{ field: 'month', code: 'VALIDATION_ERROR', message: '入力内容を確認してください' }] },
    });
    await openCalendar(page);
    await expect(main(page).getByText('¥12,050', { exact: true })).toBeVisible();
    await day(page, '11月5日（木） 請求予定1件').click();

    await main(page).getByRole('button', { name: '翌月' }).click();
    await expect.poll(() => december.calls()).toBe(1);
    await expect.poll(() => november.calls()).toBe(2); // 400 の後に今月を指定して読み直した
    await expect(main(page).getByRole('heading', { name: '2026年11月' })).toBeVisible();
    await expect(main(page).getByText('¥12,050', { exact: true })).toBeVisible();
    await expect(day(page, '11月4日（水）')).toHaveAttribute('aria-pressed', 'true'); // 今月なので今日を選ぶ
    await expect(main(page).getByText(LOAD_FAILED)).toHaveCount(0);
    await expect(main(page).getByText('入力内容を確認してください')).toHaveCount(0);
  });

  test('No.71 あわせて 今月で読み直しても400なら、読み込み失敗の表示（見出しと①は出す）', async ({ page }) => {
    await loginAt(page);
    const calendar = await mockApi(page, 'GET', '/api/calendar', {
      status: 400,
      error: { code: 'VALIDATION_ERROR', message: '入力内容を確認してください', field: 'month' },
    });
    await openCalendar(page);
    await expect(main(page).getByText(LOAD_FAILED)).toBeVisible();
    expect(calendar.calls()).toBe(2); // 最初の1回と、今月での読み直しの1回だけ
    await expect(main(page).getByRole('heading', { name: '2026年11月' })).toBeVisible();
    await expect(main(page).getByRole('button', { name: '再試行' })).toBeVisible();
  });

  test('No.41 S-07 の読み込みに失敗すると「カレンダーを読み込めませんでした…」と［再試行］。見出しと①は出し、②〜⑦は出さない。再試行で読める', async ({ page }) => {
    await loginAt(page);
    const calendar = await mockApi(page, 'GET', '/api/calendar', [
      { status: 500, error: { code: 'INTERNAL_ERROR', message: '処理に失敗しました。もう一度お試しください' } },
      { data: NOVEMBER },
    ]);
    await openCalendar(page);
    await expect(main(page).getByRole('alert')).toContainText(LOAD_FAILED);
    await expect(main(page).getByRole('heading', { name: '2026年11月' })).toBeVisible();
    await expect(main(page).getByRole('button', { name: '前月' })).toBeEnabled();
    await expect(main(page).getByRole('button', { name: '翌月' })).toBeEnabled();
    await expect(main(page).getByText('11月の請求予定額')).toHaveCount(0);
    await expect(main(page).getByText('凡例')).toHaveCount(0);
    await expect(main(page).getByText('予定額は実際の決済額ではありません')).toHaveCount(0);
    await expect(day(page, '11月4日（水）')).toHaveCount(0);

    await main(page).getByRole('button', { name: '再試行' }).click();
    await expect(main(page).getByText('¥12,050', { exact: true })).toBeVisible();
    await expect(main(page).getByRole('alert')).toHaveCount(0);
    expect(calendar.calls()).toBe(2);
  });

  test('No.41 一時的な障害（503）のときは共通の文「一時的に利用できません…」と［再試行］', async ({ page }) => {
    await loginAt(page);
    await mockApi(page, 'GET', '/api/calendar', {
      status: 503,
      error: { code: 'TEMPORARILY_UNAVAILABLE', message: '一時的に利用できません。時間をおいて再試行してください' },
    });
    await openCalendar(page);
    await expect(main(page).getByText('一時的に利用できません。時間をおいて再試行してください')).toBeVisible();
    await expect(main(page).getByText(LOAD_FAILED)).toHaveCount(0);
    await expect(main(page).getByRole('button', { name: '再試行' })).toBeVisible();
  });

  test('月を続けて切り替えると、最後に頼んだ月の応答だけを使う（遅れて届いた12月の応答は使わない）。読み込み中は②〜⑦を消す', async ({ page }) => {
    await loginAt(page);
    await mockApi(page, 'GET', '/api/calendar?month=2026-11', { data: NOVEMBER });
    const december = await mockApi(page, 'GET', '/api/calendar?month=2026-12', { data: DECEMBER, delayMs: 3000 });
    const january = await mockApi(page, 'GET', '/api/calendar?month=2027-01', { data: JANUARY });
    await openCalendar(page);
    await expect(main(page).getByText('¥12,050', { exact: true })).toBeVisible();

    const next = main(page).getByRole('button', { name: '翌月' });
    await next.click();
    // 12月の読み込み中：①は12月、②〜⑦は消えて「読み込み中…」
    await expect(main(page).getByRole('heading', { name: '2026年12月' })).toBeVisible();
    await expect(main(page).getByText('読み込み中…')).toBeVisible();
    await expect(main(page).getByText('11月の請求予定額')).toHaveCount(0);
    await expect(main(page).getByText('金額は請求予定額です。')).toHaveCount(0);
    await expect.poll(() => december.calls()).toBe(1);

    await next.click(); // 12月の応答を待たずに1月へ
    await expect(main(page).getByRole('heading', { name: '2027年1月' })).toBeVisible();
    await expect(main(page).getByText('この月の請求予定はありません')).toBeVisible();
    expect(january.calls()).toBe(1);

    // 12月の応答が届いた後も、1月のまま
    await page.waitForTimeout(3500);
    await expect(main(page).getByRole('heading', { name: '2027年1月' })).toBeVisible();
    await expect(main(page).getByText('1月の請求予定額')).toBeVisible();
    await expect(main(page).getByText('この月の請求予定はありません')).toBeVisible();
    await expect(main(page).getByText('¥24,050')).toHaveCount(0);
    await expect(main(page).getByRole('button', { name: /^12月/ })).toHaveCount(0);
  });

  test('月を行き来しても崩れない：11月 → 12月（遅い）→ すぐ前月で11月に戻ると、11月の表示のまま', async ({ page }) => {
    await loginAt(page);
    const november = await mockApi(page, 'GET', '/api/calendar?month=2026-11', { data: NOVEMBER });
    const december = await mockApi(page, 'GET', '/api/calendar?month=2026-12', { data: DECEMBER, delayMs: 3000 });
    await openCalendar(page);
    await expect(main(page).getByText('¥12,050', { exact: true })).toBeVisible();

    await main(page).getByRole('button', { name: '翌月' }).click();
    await expect.poll(() => december.calls()).toBe(1);
    await main(page).getByRole('button', { name: '前月' }).click();
    await expect.poll(() => november.calls()).toBe(2);
    await expect(main(page).getByRole('heading', { name: '2026年11月' })).toBeVisible();
    await expect(main(page).getByText('¥12,050', { exact: true })).toBeVisible();

    await page.waitForTimeout(3500);
    await expect(main(page).getByRole('heading', { name: '2026年11月' })).toBeVisible();
    await expect(main(page).getByText('¥12,050', { exact: true })).toBeVisible();
    await expect(main(page).getByText('¥24,050')).toHaveCount(0);
    await expect(day(page, '11月4日（水）')).toHaveAttribute('aria-pressed', 'true');
  });

  test('端末の日付が2000年1月より前なら、2000年1月を表示して1日を選ぶ。2000年1月では［前月］を押せない', async ({ page }) => {
    await loginAt(page, new Date('1999-12-31T10:00:00+09:00'));
    const calendar = await mockApi(page, 'GET', '/api/calendar', { data: { month: '2000-01', days: [], monthTotalJPY: 0 } satisfies CalendarDto });
    await openCalendar(page);
    await expect(main(page).getByRole('heading', { name: '2000年1月' })).toBeVisible();
    await expect(day(page, '1月1日（土）')).toHaveAttribute('aria-pressed', 'true');
    await expect(main(page).getByRole('button', { name: '前月' })).toBeDisabled();
    await expect(main(page).getByRole('button', { name: '翌月' })).toBeEnabled();
    expect(calendar.calls()).toBe(1);
  });
});
