// GET /api/calendar?month=YYYY-MM（04-13。API一覧 No.11、詳細_F-05、API共通仕様 B25・B77）
// テスト一覧の No.52（テストデータの 2026-11・2026-12）と No.71 の API の部分（3か月・6か月・月末の丸め・請求の無い月・month が不正で400）
// month を指定した集計は今日によらないので、route をそのまま呼ぶ。month を省いたときは、実際の今日（todayJST）の月と比べる（API共通仕様 B55）
// サブスクは 04-07 の seedSubscriptions・TEST_DATA_SUBSCRIPTIONS（tests/emulator/helpers.ts）で置く
import { beforeEach, describe, expect, it } from 'vitest';
import { GET as getCalendarRoute } from '@/app/api/calendar/route';
import { GET as getDashboardRoute } from '@/app/api/dashboard/route';
import { todayJST } from '@/lib/clock';
import { callRoute, resetEmulators, seedSubscriptions, seedUser, signUpUser, TEST_DATA_SUBSCRIPTIONS } from './helpers';

async function callCalendar(token: string | undefined, query = '') {
  return callRoute(getCalendarRoute, { token, path: `/api/calendar${query}` });
}

async function initializedUser() {
  const user = await signUpUser();
  await seedUser(user.uid);
  return user;
}

type Day = { date: string; items: { subscriptionId: string; serviceName: string; priceJPY: number }[] };

function summary(days: Day[]) {
  return days.map((day) => [day.date, day.items.map((item) => `${item.serviceName} ${item.priceJPY}`)]);
}

const MONTH_ERROR = {
  code: 'VALIDATION_ERROR',
  message: '入力内容を確認してください',
  field: 'month',
  details: [{ field: 'month', code: 'VALIDATION_ERROR', message: '入力内容を確認してください' }],
};

beforeEach(async () => {
  await resetEmulators();
});

describe('GET /api/calendar', () => {
  it('No.52 テストデータの 2026-11 は5日・8日・11日・30日にそれぞれ1件、月間12,050円', async () => {
    const user = await initializedUser();
    const docs = await seedSubscriptions(user.uid, TEST_DATA_SUBSCRIPTIONS);
    const idOf = (name: string) => docs.find((doc) => doc.serviceName === name)!.subscriptionId;
    const res = await callCalendar(user.token, '?month=2026-11');
    expect(res.status).toBe(200);
    expect(res.body?.data).toEqual({
      month: '2026-11',
      days: [
        { date: '2026-11-05', items: [{ subscriptionId: idOf('Spotify'), serviceName: 'Spotify', priceJPY: 980 }] },
        { date: '2026-11-08', items: [{ subscriptionId: idOf('Netflix'), serviceName: 'Netflix', priceJPY: 1590 }] },
        { date: '2026-11-11', items: [{ subscriptionId: idOf('Adobe Creative Cloud'), serviceName: 'Adobe Creative Cloud', priceJPY: 6480 }] },
        { date: '2026-11-30', items: [{ subscriptionId: idOf('ChatGPT'), serviceName: 'ChatGPT', priceJPY: 3000 }] },
      ],
      monthTotalJPY: 12050,
    });
  });

  it('No.52 あわせて 2026-12 は、年額の iCloud+ の1日（¥12,000）を含む1日・5日・8日・11日・31日の5件、月間24,050円', async () => {
    const user = await initializedUser();
    await seedSubscriptions(user.uid, TEST_DATA_SUBSCRIPTIONS);
    const res = await callCalendar(user.token, '?month=2026-12');
    expect(res.status).toBe(200);
    expect(res.body?.data.month).toBe('2026-12');
    expect(summary(res.body?.data.days)).toEqual([
      ['2026-12-01', ['iCloud+ 12000']],
      ['2026-12-05', ['Spotify 980']],
      ['2026-12-08', ['Netflix 1590']],
      ['2026-12-11', ['Adobe Creative Cloud 6480']],
      ['2026-12-31', ['ChatGPT 3000']],
    ]);
    expect(res.body?.data.monthTotalJPY).toBe(24050);
  });

  it('No.71 3か月（A：2026-08-31）と6か月（B：2026-06-15）：2026-11 は A の11/30、2026-12 は B の12/15、2027-01 は0件、2027-02 は A の2/28', async () => {
    const user = await initializedUser();
    await seedSubscriptions(user.uid, [
      { serviceName: 'A', price: 1200, billingCycle: 'quarterly', firstBillingDate: '2026-08-31', billingDayMode: 'fixedDay', nextBillingDate: '2026-11-30' },
      { serviceName: 'B', price: 3000, billingCycle: 'semiAnnual', firstBillingDate: '2026-06-15', billingDayMode: 'fixedDay', nextBillingDate: '2026-12-15' },
    ]);
    const expected: Record<string, [string, string[]][]> = {
      '2026-11': [['2026-11-30', ['A 1200']]],
      '2026-12': [['2026-12-15', ['B 3000']]],
      '2027-01': [],
      '2027-02': [['2027-02-28', ['A 1200']]],
    };
    for (const [month, days] of Object.entries(expected)) {
      const res = await callCalendar(user.token, `?month=${month}`);
      expect(res.status, month).toBe(200);
      expect(res.body?.data.month, month).toBe(month);
      expect(summary(res.body?.data.days), month).toEqual(days);
    }
    const january = await callCalendar(user.token, '?month=2027-01');
    expect(january.body?.data).toEqual({ month: '2027-01', days: [], monthTotalJPY: 0 });
  });

  it('No.71 あわせて ?month=2026-13 は400 VALIDATION_ERROR（field=month、details にも month）', async () => {
    const user = await initializedUser();
    const res = await callCalendar(user.token, '?month=2026-13');
    expect(res.status).toBe(400);
    expect(res.body?.data).toBeNull();
    expect(res.body?.error).toEqual(MONTH_ERROR);
  });

  it('month の不正：空文字（?month=）・形の違い・年が2000〜2100の外は400（field=month）', async () => {
    const user = await initializedUser();
    for (const query of ['?month=', '?month=2026-1', '?month=2026-11-01', '?month=202611', '?month=1999-12', '?month=2101-01', '?month=2026-00', '?month=abcd-ef']) {
      const res = await callCalendar(user.token, query);
      expect(res.status, query).toBe(400);
      expect(res.body?.error, query).toEqual(MONTH_ERROR);
    }
    for (const query of ['?month=2000-01', '?month=2100-12']) {
      const res = await callCalendar(user.token, query);
      expect(res.status, query).toBe(200);
    }
  });

  it('month を省略すると日本時間の今月。month が2つ以上なら最初の1つだけを見て、ほかのクエリは無視する', async () => {
    const user = await initializedUser();
    const omitted = await callCalendar(user.token);
    expect(omitted.status).toBe(200);
    expect(omitted.body?.data).toEqual({ month: todayJST().slice(0, 7), days: [], monthTotalJPY: 0 });

    const twice = await callCalendar(user.token, '?month=2026-12&month=2026-13&foo=bar');
    expect(twice.status).toBe(200);
    expect(twice.body?.data.month).toBe('2026-12');
    const invalidFirst = await callCalendar(user.token, '?month=2026-13&month=2026-12');
    expect(invalidFirst.status).toBe(400);
  });

  it('同じ日の items は作成日時の昇順。0円の請求も1件に数える', async () => {
    const user = await initializedUser();
    await seedSubscriptions(user.uid, [
      { serviceName: '古い', price: 500, billingCycle: 'monthly', firstBillingDate: '2026-10-10' },
      { serviceName: '新しい', price: 0, billingCycle: 'yearly', firstBillingDate: '2026-11-10' },
    ]);
    const res = await callCalendar(user.token, '?month=2026-11');
    expect(summary(res.body?.data.days)).toEqual([['2026-11-10', ['古い 500', '新しい 0']]]);
    expect(res.body?.data.monthTotalJPY).toBe(500);
  });

  it('請求日・周期・請求日方式・料金が壊れたサブスクは、500 にせず集計から外す（今月の合計は S-03 の「今月の予定額」と同じ）', async () => {
    const user = await initializedUser();
    const today = todayJST();
    await seedSubscriptions(user.uid, [
      { serviceName: '正常', price: 980, billingCycle: 'monthly', firstBillingDate: today },
      { serviceName: '日付が壊れた', price: 100, billingCycle: 'monthly', firstBillingDate: '2026-02-30' },
      { serviceName: '周期が壊れた', price: 100, billingCycle: 'weekly' as never, firstBillingDate: today },
      { serviceName: '方式が壊れた', price: 100, billingCycle: 'monthly', firstBillingDate: today, billingDayMode: 'lastDay' as never },
      { serviceName: '料金が壊れた', price: '100' as never, billingCycle: 'monthly', firstBillingDate: today },
    ]);
    const calendar = await callCalendar(user.token);
    expect(calendar.status).toBe(200);
    expect(summary(calendar.body?.data.days)).toEqual([[today, ['正常 980']]]);
    expect(calendar.body?.data.monthTotalJPY).toBe(980);
    const dashboard = await callRoute(getDashboardRoute, { token: user.token, path: '/api/dashboard' });
    expect(dashboard.body?.data.monthTotal).toEqual({ count: 1, amountJPY: calendar.body?.data.monthTotalJPY });
  });

  it('他人のサブスクは入らない', async () => {
    const me = await initializedUser();
    const other = await initializedUser();
    await seedSubscriptions(other.uid, TEST_DATA_SUBSCRIPTIONS);
    const res = await callCalendar(me.token, '?month=2026-11');
    expect(res.body?.data).toEqual({ month: '2026-11', days: [], monthTotalJPY: 0 });
  });

  it('検査の順序：ログインしていなければ、month が不正でも401 UNAUTHENTICATED', async () => {
    const res = await callCalendar(undefined, '?month=2026-13');
    expect(res.status).toBe(401);
    expect(res.body?.error.code).toBe('UNAUTHENTICATED');
  });

  it('検査の順序：users が無ければ、month が不正でも409 ACCOUNT_NOT_INITIALIZED', async () => {
    const user = await signUpUser();
    const res = await callCalendar(user.token, '?month=2026-13');
    expect(res.status).toBe(409);
    expect(res.body?.error.code).toBe('ACCOUNT_NOT_INITIALIZED');
  });

  it('検査の順序：規約の版が古ければ、month が不正でも409 TERMS_RECONSENT_REQUIRED', async () => {
    const user = await signUpUser();
    await seedUser(user.uid, { termsVersion: '2000-01-01' });
    const res = await callCalendar(user.token, '?month=2026-13');
    expect(res.status).toBe(409);
    expect(res.body?.error.code).toBe('TERMS_RECONSENT_REQUIRED');
  });
});
