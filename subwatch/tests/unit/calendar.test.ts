// 月の部品（lib/calendar.ts）と、月の集計（lib/dashboard.ts の computeCalendar）の単体テスト（04-13）
// テスト一覧の No.52・No.71（lib の月の計算を直接呼ぶ部分）。期待値は機能設計書「テスト一覧」「テストデータ」と画面設計書「サンプルデータ」のとおり
import { describe, expect, it } from 'vitest';
import {
  CALENDAR_MONTH_MAX,
  CALENDAR_MONTH_MIN,
  calendarMonthOf,
  calendarWeeks,
  dayLabel,
  initialSelectedDate,
  isCalendarMonth,
  monthDateRange,
  monthLabel,
  monthNumberLabel,
  monthOf,
  shiftMonth,
} from '@/lib/calendar';
import { computeCalendar, computeDashboard, type DashboardSubscription } from '@/lib/dashboard';

let seq = 0;
function sub(fields: Partial<DashboardSubscription> & Pick<DashboardSubscription, 'serviceName' | 'price' | 'billingCycle' | 'firstBillingDate'>): DashboardSubscription {
  seq += 1;
  return { subscriptionId: `sub${String(seq).padStart(17, '0')}`, billingDayMode: 'fixedDay', websiteUrl: null, ...fields };
}

// 機能設計書「テストデータ」の5件（登録の順は表の行の順）
function testData(): DashboardSubscription[] {
  return [
    sub({ subscriptionId: 'netflix', serviceName: 'Netflix', price: 1590, billingCycle: 'monthly', firstBillingDate: '2026-10-08' }),
    sub({ subscriptionId: 'spotify', serviceName: 'Spotify', price: 980, billingCycle: 'monthly', firstBillingDate: '2026-09-05' }),
    sub({ subscriptionId: 'adobe', serviceName: 'Adobe Creative Cloud', price: 6480, billingCycle: 'monthly', firstBillingDate: '2026-10-11' }),
    sub({ subscriptionId: 'icloud', serviceName: 'iCloud+', price: 12000, billingCycle: 'yearly', firstBillingDate: '2025-12-01' }),
    sub({ subscriptionId: 'chatgpt', serviceName: 'ChatGPT', price: 3000, billingCycle: 'monthly', firstBillingDate: '2026-11-30', billingDayMode: 'endOfMonth' }),
  ];
}

function summary(result: ReturnType<typeof computeCalendar>) {
  return result.days.map((day) => [day.date, day.items.map((item) => `${item.serviceName} ${item.priceJPY}`)]);
}

describe('lib/calendar.ts 月の部品', () => {
  it('isCalendarMonth：YYYY-MM で 2000-01〜2100-12 の中だけ true', () => {
    for (const ok of ['2000-01', '2026-11', '2100-12']) expect(isCalendarMonth(ok)).toBe(true);
    for (const ng of ['1999-12', '2101-01', '2026-13', '2026-00', '2026-1', '2026-011', '', '2026/11', '２０２６-11', null, undefined, 202611]) {
      expect(isCalendarMonth(ng)).toBe(false);
    }
  });

  it('monthOf：日付の月。壊れた日付は RangeError', () => {
    expect(monthOf('2026-11-04')).toBe('2026-11');
    expect(() => monthOf('2026-02-30')).toThrow(RangeError);
  });

  it('calendarMonthOf：今日の月。2000-01〜2100-12 の外なら近い方の端', () => {
    expect(calendarMonthOf('2026-11-04')).toBe('2026-11');
    expect(calendarMonthOf('1999-12-31')).toBe(CALENDAR_MONTH_MIN);
    expect(calendarMonthOf('2101-01-01')).toBe(CALENDAR_MONTH_MAX);
    expect(calendarMonthOf('2000-01-01')).toBe('2000-01');
    expect(calendarMonthOf('2100-12-31')).toBe('2100-12');
  });

  it('shiftMonth：年をまたぐ前月・翌月。範囲の外も返す（押せるかは isCalendarMonth で調べる）', () => {
    expect(shiftMonth('2026-11', 1)).toBe('2026-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2027-01', -1)).toBe('2026-12');
    expect(shiftMonth('2026-11', -23)).toBe('2024-12');
    expect(shiftMonth('2000-01', -1)).toBe('1999-12');
    expect(isCalendarMonth(shiftMonth('2000-01', -1))).toBe(false);
    expect(isCalendarMonth(shiftMonth('2100-12', 1))).toBe(false);
    expect(() => shiftMonth('2026-13', 1)).toThrow(RangeError);
    expect(() => shiftMonth('2026-11', 0.5)).toThrow(RangeError);
  });

  it('monthDateRange：月の1日と末日（うるう年の2月は29日、2100年2月は28日）', () => {
    expect(monthDateRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(monthDateRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(monthDateRange('2027-02')).toEqual({ from: '2027-02-01', to: '2027-02-28' });
    expect(monthDateRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthDateRange('2100-02')).toEqual({ from: '2100-02-01', to: '2100-02-28' });
    expect(() => monthDateRange('2026-13')).toThrow(RangeError);
  });

  it('calendarWeeks：月曜始まり。2026年11月は 10/26（月）〜12/06（日）の6週（図 S-07 のとおり）', () => {
    const weeks = calendarWeeks('2026-11');
    expect(weeks).toHaveLength(6);
    for (const week of weeks) expect(week).toHaveLength(7);
    expect(weeks[0][0]).toEqual({ date: '2026-10-26', inMonth: false });
    expect(weeks[0][6]).toEqual({ date: '2026-11-01', inMonth: true });
    expect(weeks[1][0]).toEqual({ date: '2026-11-02', inMonth: true });
    expect(weeks[5][0]).toEqual({ date: '2026-11-30', inMonth: true });
    expect(weeks[5][6]).toEqual({ date: '2026-12-06', inMonth: false });
    expect(weeks.flat().filter((cell) => cell.inMonth)).toHaveLength(30);
  });

  it('calendarWeeks：1日が月曜で末日が日曜の月（2027年2月）は4週で、前後の月の日付が無い', () => {
    const weeks = calendarWeeks('2027-02');
    expect(weeks).toHaveLength(4);
    expect(weeks[0][0].date).toBe('2027-02-01');
    expect(weeks[3][6].date).toBe('2027-02-28');
    expect(weeks.flat().every((cell) => cell.inMonth)).toBe(true);
  });

  it('initialSelectedDate：今月なら今日、ほかの月なら1日', () => {
    expect(initialSelectedDate('2026-11', '2026-11-04')).toBe('2026-11-04');
    expect(initialSelectedDate('2026-12', '2026-11-04')).toBe('2026-12-01');
    expect(initialSelectedDate('2026-10', '2026-11-04')).toBe('2026-10-01');
    expect(initialSelectedDate('2100-12', '2101-03-15')).toBe('2100-12-01'); // 端末の日付が範囲の外：端の月の1日
  });

  it('表示の文字：「2026年11月」「11月」「11月5日（木）」', () => {
    expect(monthLabel('2026-11')).toBe('2026年11月');
    expect(monthLabel('2027-01')).toBe('2027年1月');
    expect(monthNumberLabel('2026-11')).toBe('11月');
    expect(dayLabel('2026-11-05')).toBe('11月5日（木）');
    expect(dayLabel('2026-11-04')).toBe('11月4日（水）');
    expect(dayLabel('2026-11-30')).toBe('11月30日（月）');
  });
});

describe('computeCalendar 月の集計', () => {
  it('No.52 テストデータの 2026-11 は5日・8日・11日・30日にそれぞれ1件、月間12,050円', () => {
    const result = computeCalendar(testData(), '2026-11');
    expect(result.month).toBe('2026-11');
    expect(summary(result)).toEqual([
      ['2026-11-05', ['Spotify 980']],
      ['2026-11-08', ['Netflix 1590']],
      ['2026-11-11', ['Adobe Creative Cloud 6480']],
      ['2026-11-30', ['ChatGPT 3000']],
    ]);
    expect(result.monthTotalJPY).toBe(12050);
    expect(result.days[0].items[0]).toEqual({ subscriptionId: 'spotify', serviceName: 'Spotify', priceJPY: 980 });
  });

  it('No.52 あわせて 2026-12 は、年額の iCloud+ の1日（¥12,000）を含む1日・5日・8日・11日・31日の5件、月間24,050円', () => {
    const result = computeCalendar(testData(), '2026-12');
    expect(summary(result)).toEqual([
      ['2026-12-01', ['iCloud+ 12000']],
      ['2026-12-05', ['Spotify 980']],
      ['2026-12-08', ['Netflix 1590']],
      ['2026-12-11', ['Adobe Creative Cloud 6480']],
      ['2026-12-31', ['ChatGPT 3000']],
    ]);
    expect(result.days.reduce((n, day) => n + day.items.length, 0)).toBe(5);
    expect(result.monthTotalJPY).toBe(24050);
  });

  it('No.52 同じ月の S-03「今月の予定額」と S-07「月間請求予定額」は同じ（基準日 2026-11-04）', () => {
    const dashboard = computeDashboard(testData(), '2026-11-04', 0);
    const calendar = computeCalendar(testData(), '2026-11');
    expect(calendar.monthTotalJPY).toBe(dashboard.monthTotal.amountJPY);
    expect(calendar.days.reduce((n, day) => n + day.items.length, 0)).toBe(dashboard.monthTotal.count);
  });

  describe('No.71 3か月・6か月・月末の丸め・請求の無い月', () => {
    // A：2026-08-31・3か月・fixedDay、B：2026-06-15・6か月・fixedDay
    function ab(): DashboardSubscription[] {
      return [
        sub({ subscriptionId: 'subA', serviceName: 'A', price: 1200, billingCycle: 'quarterly', firstBillingDate: '2026-08-31' }),
        sub({ subscriptionId: 'subB', serviceName: 'B', price: 3000, billingCycle: 'semiAnnual', firstBillingDate: '2026-06-15' }),
      ];
    }

    it('No.71 2026-11 は A の11/30だけ（月末に丸める）', () => {
      const result = computeCalendar(ab(), '2026-11');
      expect(summary(result)).toEqual([['2026-11-30', ['A 1200']]]);
      expect(result.monthTotalJPY).toBe(1200);
    });

    it('No.71 2026-12 は B の12/15だけ', () => {
      const result = computeCalendar(ab(), '2026-12');
      expect(summary(result)).toEqual([['2026-12-15', ['B 3000']]]);
      expect(result.monthTotalJPY).toBe(3000);
    });

    it('No.71 2027-01 は0件（days は空、月間0円）', () => {
      expect(computeCalendar(ab(), '2027-01')).toEqual({ month: '2027-01', days: [], monthTotalJPY: 0 });
    });

    it('No.71 2027-02 は A の2/28', () => {
      const result = computeCalendar(ab(), '2027-02');
      expect(summary(result)).toEqual([['2027-02-28', ['A 1200']]]);
    });
  });

  it('同じ日の items は渡された順（作成日時の昇順）のまま', () => {
    const subs = [
      sub({ subscriptionId: 'older', serviceName: '古い', price: 100, billingCycle: 'monthly', firstBillingDate: '2026-10-10' }),
      sub({ subscriptionId: 'newer', serviceName: '新しい', price: 200, billingCycle: 'yearly', firstBillingDate: '2026-11-10' }),
    ];
    expect(summary(computeCalendar(subs, '2026-11'))).toEqual([['2026-11-10', ['古い 100', '新しい 200']]]);
  });

  it('請求日より前の月には請求日を作らない', () => {
    const subs = [sub({ serviceName: '後から', price: 500, billingCycle: 'monthly', firstBillingDate: '2027-03-15' })];
    expect(computeCalendar(subs, '2027-02').days).toEqual([]);
    expect(summary(computeCalendar(subs, '2027-03'))).toEqual([['2027-03-15', ['後から 500']]]);
  });

  it('0円の請求だけの月は、1件・0円', () => {
    const subs = [sub({ serviceName: '無料', price: 0, billingCycle: 'monthly', firstBillingDate: '2026-11-20' })];
    const result = computeCalendar(subs, '2026-11');
    expect(summary(result)).toEqual([['2026-11-20', ['無料 0']]]);
    expect(result.monthTotalJPY).toBe(0);
  });

  it('請求日・周期・請求日方式・料金が壊れたサブスクは、例外にせず集計から外す', () => {
    const subs = [
      sub({ serviceName: '正常', price: 980, billingCycle: 'monthly', firstBillingDate: '2026-09-05' }),
      sub({ serviceName: '日付が壊れた', price: 100, billingCycle: 'monthly', firstBillingDate: '2026-02-30' }),
      sub({ serviceName: '周期が壊れた', price: 100, billingCycle: 'weekly' as never, firstBillingDate: '2026-09-05' }),
      sub({ serviceName: '方式が壊れた', price: 100, billingCycle: 'monthly', firstBillingDate: '2026-09-05', billingDayMode: 'lastDay' as never }),
      sub({ serviceName: '料金が壊れた', price: '100' as never, billingCycle: 'monthly', firstBillingDate: '2026-09-05' }),
    ];
    const result = computeCalendar(subs, '2026-11');
    expect(summary(result)).toEqual([['2026-11-05', ['正常 980']]]);
    expect(result.monthTotalJPY).toBe(980);
  });
});
