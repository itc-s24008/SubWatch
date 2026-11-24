// ホームの集計（lib/dashboard.ts）と S-04 の既定の並び（lib/subscription-order.ts）の単体テスト（04-09）
// テスト一覧の No.4・5・70（lib の集計の関数を直接呼ぶ部分）
import { describe, expect, it } from 'vitest';
import { computeDashboard, monthRange, unreadWindowStart, weekRange, type DashboardSubscription } from '@/lib/dashboard';
import { sortByNextBillingDate } from '@/lib/subscription-order';

const BASE_DATE = '2026-11-04'; // 基準日（水）

let seq = 0;
function sub(fields: Partial<DashboardSubscription> & Pick<DashboardSubscription, 'serviceName' | 'price' | 'billingCycle' | 'firstBillingDate'>): DashboardSubscription {
  seq += 1;
  return { subscriptionId: `sub${String(seq).padStart(17, '0')}`, billingDayMode: 'fixedDay', websiteUrl: null, ...fields };
}

// 機能設計書「テストデータ」の5件（登録の順は表の行の順）
function testData(): DashboardSubscription[] {
  return [
    sub({ serviceName: 'Netflix', price: 1590, billingCycle: 'monthly', firstBillingDate: '2026-10-08', websiteUrl: 'https://www.netflix.com' }),
    sub({ serviceName: 'Spotify', price: 980, billingCycle: 'monthly', firstBillingDate: '2026-09-05' }),
    sub({ serviceName: 'Adobe Creative Cloud', price: 6480, billingCycle: 'monthly', firstBillingDate: '2026-10-11' }),
    sub({ serviceName: 'iCloud+', price: 12000, billingCycle: 'yearly', firstBillingDate: '2025-12-01' }),
    sub({ serviceName: 'ChatGPT', price: 3000, billingCycle: 'monthly', firstBillingDate: '2026-11-30', billingDayMode: 'endOfMonth' }),
  ];
}

describe('computeDashboard（GET /api/dashboard の集計）', () => {
  it('No.4 テストデータ5件・基準日2026-11-04：今週2件2,570円・今月4件12,050円・月額換算13,050円・年額換算156,600円', () => {
    const result = computeDashboard(testData(), BASE_DATE, 1);
    expect(result.weekTotal).toEqual({ count: 2, amountJPY: 2570 });
    expect(result.monthTotal).toEqual({ count: 4, amountJPY: 12050 });
    expect(result.monthlyEquivalentJPY).toBe(13050);
    expect(result.yearlyEquivalentJPY).toBe(156600);
    expect(result.subscriptionCount).toBe(5);
    expect(result.unreadCount).toBe(1);
  });

  it('No.4 7日以内の請求：Spotify（あと1日）、Netflix（あと4日）、Adobe Creative Cloud（あと7日）。websiteUrl も入る', () => {
    const result = computeDashboard(testData(), BASE_DATE, 0);
    expect(result.nextBills.map((b) => [b.serviceName, b.date, b.priceJPY, b.daysLeft])).toEqual([
      ['Spotify', '2026-11-05', 980, 1],
      ['Netflix', '2026-11-08', 1590, 4],
      ['Adobe Creative Cloud', '2026-11-11', 6480, 7],
    ]);
    expect(result.nextBills[1].websiteUrl).toBe('https://www.netflix.com');
  });

  it('No.5 月額980円と年額12,000円の月額換算合計は1,980円（A=23,760、(A+6)/12 の切り捨て）', () => {
    const result = computeDashboard(
      [
        sub({ serviceName: 'a', price: 980, billingCycle: 'monthly', firstBillingDate: '2026-01-10' }),
        sub({ serviceName: 'b', price: 12000, billingCycle: 'yearly', firstBillingDate: '2026-01-10' }),
      ],
      BASE_DATE,
      0,
    );
    expect(result.yearlyEquivalentJPY).toBe(23760);
    expect(result.monthlyEquivalentJPY).toBe(1980);
  });

  it('No.5 毎月980円・3か月1,000円・6か月500円の月額換算合計は1,397円（A=16,760。個別に四捨五入した1,396円にはならない）', () => {
    const result = computeDashboard(
      [
        sub({ serviceName: 'a', price: 980, billingCycle: 'monthly', firstBillingDate: '2026-01-10' }),
        sub({ serviceName: 'b', price: 1000, billingCycle: 'quarterly', firstBillingDate: '2026-01-10' }),
        sub({ serviceName: 'c', price: 500, billingCycle: 'semiAnnual', firstBillingDate: '2026-01-10' }),
      ],
      BASE_DATE,
      0,
    );
    expect(result.yearlyEquivalentJPY).toBe(16760);
    expect(result.monthlyEquivalentJPY).toBe(1397);
  });

  it('No.70 テストデータの iCloud+ と ChatGPT の2件（どちらも請求が8日以上先）：subscriptionCount=2・nextBills は空', () => {
    const data = testData().filter((s) => s.serviceName === 'iCloud+' || s.serviceName === 'ChatGPT');
    const result = computeDashboard(data, BASE_DATE, 0);
    expect(result.subscriptionCount).toBe(2);
    expect(result.nextBills).toEqual([]);
    expect(result.monthTotal).toEqual({ count: 1, amountJPY: 3000 }); // 金額の集計は通常どおり（ChatGPT 11/30）
  });

  it('0件：金額も件数も0', () => {
    expect(computeDashboard([], BASE_DATE, 0)).toEqual({
      weekTotal: { count: 0, amountJPY: 0 },
      monthTotal: { count: 0, amountJPY: 0 },
      monthlyEquivalentJPY: 0,
      yearlyEquivalentJPY: 0,
      subscriptionCount: 0,
      unreadCount: 0,
      nextBills: [],
    });
  });

  it('月末の請求日（1/31 → 2/28）とうるう年（2/29）：今月の集計に入る', () => {
    const jan31 = sub({ serviceName: 'a', price: 100, billingCycle: 'monthly', firstBillingDate: '2027-01-31' });
    expect(computeDashboard([jan31], '2027-02-10', 0).monthTotal).toEqual({ count: 1, amountJPY: 100 });
    expect(computeDashboard([jan31], '2027-02-10', 0).nextBills).toEqual([]); // 2/28 はあと18日
    expect(computeDashboard([jan31], '2027-02-22', 0).nextBills[0]).toMatchObject({ date: '2027-02-28', daysLeft: 6 });
    const leap = sub({ serviceName: 'b', price: 200, billingCycle: 'monthly', firstBillingDate: '2028-01-31' });
    expect(computeDashboard([leap], '2028-02-27', 0).nextBills[0]).toMatchObject({ date: '2028-02-29', daysLeft: 2 });
  });

  it('6か月・年額の周期：請求の無い月は今月に入らない', () => {
    const half = sub({ serviceName: 'a', price: 600, billingCycle: 'semiAnnual', firstBillingDate: '2026-05-15' });
    const year = sub({ serviceName: 'b', price: 1200, billingCycle: 'yearly', firstBillingDate: '2025-11-20' });
    expect(computeDashboard([half, year], BASE_DATE, 0).monthTotal).toEqual({ count: 2, amountJPY: 1800 }); // 11/15 と 11/20
    expect(computeDashboard([half, year], '2026-12-04', 0).monthTotal).toEqual({ count: 0, amountJPY: 0 });
    expect(computeDashboard([half, year], BASE_DATE, 0).yearlyEquivalentJPY).toBe(2400);
  });

  it('今週は日本時間の月曜〜日曜（今日が日曜なら前の月曜から）', () => {
    expect(weekRange('2026-11-04')).toEqual({ from: '2026-11-02', to: '2026-11-08' });
    expect(weekRange('2026-11-08')).toEqual({ from: '2026-11-02', to: '2026-11-08' });
    expect(weekRange('2026-11-09')).toEqual({ from: '2026-11-09', to: '2026-11-15' });
    expect(monthRange('2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('nextBills は今日（あと0日）と7日後を含み、8日後は入れない。日付の近い順に最大5件、同じ日は登録の古い順', () => {
    const items = [
      sub({ serviceName: '8日後', price: 1, billingCycle: 'monthly', firstBillingDate: '2026-11-12' }),
      sub({ serviceName: '同じ日の古い方', price: 1, billingCycle: 'monthly', firstBillingDate: '2026-11-06' }),
      sub({ serviceName: '今日', price: 1, billingCycle: 'monthly', firstBillingDate: '2026-10-04' }),
      sub({ serviceName: '同じ日の新しい方', price: 1, billingCycle: 'monthly', firstBillingDate: '2026-11-06' }),
      sub({ serviceName: '7日後', price: 1, billingCycle: 'monthly', firstBillingDate: '2026-11-11' }),
      sub({ serviceName: '3日後', price: 1, billingCycle: 'monthly', firstBillingDate: '2026-11-07' }),
      sub({ serviceName: '5日後', price: 1, billingCycle: 'monthly', firstBillingDate: '2026-11-09' }),
    ];
    const result = computeDashboard(items, BASE_DATE, 0);
    expect(result.nextBills.map((b) => `${b.serviceName}:${b.daysLeft}`)).toEqual([
      '今日:0',
      '同じ日の古い方:2',
      '同じ日の新しい方:2',
      '3日後:3',
      '5日後:5',
    ]);
  });

  it('請求日・周期・請求日方式・料金が壊れたサブスクは、金額と nextBills に入れず、登録数には数える（例外にしない）', () => {
    const broken = [
      sub({ serviceName: '日付', price: 100, billingCycle: 'monthly', firstBillingDate: '2026-13-40' }),
      sub({ serviceName: '周期', price: 100, billingCycle: 'weekly' as never, firstBillingDate: '2026-11-05' }),
      sub({ serviceName: '方式', price: 100, billingCycle: 'monthly', firstBillingDate: '2026-11-05', billingDayMode: 'x' as never }),
      sub({ serviceName: '料金', price: '100' as never, billingCycle: 'monthly', firstBillingDate: '2026-11-05' }),
    ];
    const result = computeDashboard([...broken, ...testData()], BASE_DATE, 0);
    expect(result.subscriptionCount).toBe(9);
    expect(result.monthTotal).toEqual({ count: 4, amountJPY: 12050 });
    expect(result.weekTotal).toEqual({ count: 2, amountJPY: 2570 });
    expect(result.yearlyEquivalentJPY).toBe(156600);
    expect(result.nextBills.map((b) => b.serviceName)).toEqual(['Spotify', 'Netflix', 'Adobe Creative Cloud']);
  });

  it('未読の数え始めは現在時刻の90日前', () => {
    expect(unreadWindowStart(new Date('2026-11-04T00:00:00.000Z')).toISOString()).toBe('2026-08-06T00:00:00.000Z');
  });
});

describe('sortByNextBillingDate（S-04 の既定の並び）', () => {
  it('No.7 次回請求日が近い順。同じ日は API の並び（登録の古い順）のまま。テストデータは Spotify → Netflix → Adobe → ChatGPT → iCloud+', () => {
    const items = [
      { serviceName: 'Netflix', nextBillingDate: '2026-11-08' },
      { serviceName: 'Spotify', nextBillingDate: '2026-11-05' },
      { serviceName: 'Adobe Creative Cloud', nextBillingDate: '2026-11-11' },
      { serviceName: 'iCloud+', nextBillingDate: '2026-12-01' },
      { serviceName: 'ChatGPT', nextBillingDate: '2026-11-30' },
    ];
    expect(sortByNextBillingDate(items).map((i) => i.serviceName)).toEqual(['Spotify', 'Netflix', 'Adobe Creative Cloud', 'ChatGPT', 'iCloud+']);
  });

  it('同じ日は渡された順のまま。次回請求日が読めないものは最後', () => {
    const items = [
      { id: 'a', nextBillingDate: '2026-11-10' },
      { id: 'b', nextBillingDate: 'broken' },
      { id: 'c', nextBillingDate: '2026-11-05' },
      { id: 'd', nextBillingDate: '2026-11-10' },
      { id: 'e', nextBillingDate: null },
    ];
    expect(sortByNextBillingDate(items).map((i) => i.id)).toEqual(['c', 'a', 'd', 'b', 'e']);
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd', 'e']); // 元の配列は変えない
  });
});
