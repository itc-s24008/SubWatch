// lib/billing.ts の単体テスト。期待値は設計書（機能設計書「テスト一覧」「共通ロジック」「テストデータ」、要件定義書「共通ルール」）のとおり
import { describe, expect, it } from 'vitest';
import {
  addDays,
  annualAmount,
  billingDatesInRange,
  daysBetween,
  daysInMonth,
  isEndOfMonth,
  isValidDate,
  monthlyEquivalentTotal,
  nextBillingDate,
  nthBillingDate,
  weekdayOf,
} from '@/lib/billing';
import type { BillingCycle } from '@/lib/types';

describe('テスト一覧の請求日', () => {
  it('No.1 月末の丸め：2027-01-31・毎月・fixedDay は、基準日 2027-02-01 で 2027-02-28、基準日 2027-03-01 で 2027-03-31（前回丸めた日を次の基準にしない）', () => {
    expect(nextBillingDate('2027-01-31', 'monthly', 'fixedDay', '2027-02-01')).toBe('2027-02-28');
    expect(nextBillingDate('2027-01-31', 'monthly', 'fixedDay', '2027-03-01')).toBe('2027-03-31');
  });

  it('No.2 うるう年：2028-01-31・毎月・fixedDay の2月の請求日は 2028-02-29', () => {
    expect(nthBillingDate('2028-01-31', 'monthly', 'fixedDay', 1)).toBe('2028-02-29');
    expect(billingDatesInRange('2028-01-31', 'monthly', 'fixedDay', '2028-02-01', '2028-02-29')).toEqual(['2028-02-29']);
  });

  it('No.3 毎月末日：2026-11-30・毎月・endOfMonth・基準日 2026-11-30 は、2026-11-30、2026-12-31、2027-01-31、2027-02-28 と毎月の末日', () => {
    expect(nextBillingDate('2026-11-30', 'monthly', 'endOfMonth', '2026-11-30')).toBe('2026-11-30');
    expect(billingDatesInRange('2026-11-30', 'monthly', 'endOfMonth', '2026-11-30', '2027-02-28')).toEqual([
      '2026-11-30',
      '2026-12-31',
      '2027-01-31',
      '2027-02-28',
    ]);
  });

  it('No.6 6か月の周期：2026-08-31・6か月・fixedDay・基準日 2027-02-01 の次回請求日は 2027-02-28（該当日が無い月は月末日に丸める）', () => {
    expect(nextBillingDate('2026-08-31', 'semiAnnual', 'fixedDay', '2027-02-01')).toBe('2027-02-28');
  });

  it('No.25 遠い未来の請求日：2030-01-01・毎年・fixedDay・基準日 2026-11-04 の次回請求日は、請求日そのもの', () => {
    expect(nextBillingDate('2030-01-01', 'yearly', 'fixedDay', '2026-11-04')).toBe('2030-01-01');
  });
});

describe('nextBillingDate（次回請求日）', () => {
  it('テストデータ（基準日 2026-11-04）の次回請求日', () => {
    expect(nextBillingDate('2026-10-08', 'monthly', 'fixedDay', '2026-11-04')).toBe('2026-11-08'); // Netflix
    expect(nextBillingDate('2026-09-05', 'monthly', 'fixedDay', '2026-11-04')).toBe('2026-11-05'); // Spotify
    expect(nextBillingDate('2026-10-11', 'monthly', 'fixedDay', '2026-11-04')).toBe('2026-11-11'); // Adobe Creative Cloud
    expect(nextBillingDate('2025-12-01', 'yearly', 'fixedDay', '2026-11-04')).toBe('2026-12-01'); // iCloud+
    expect(nextBillingDate('2026-11-30', 'monthly', 'endOfMonth', '2026-11-04')).toBe('2026-11-30'); // ChatGPT
  });

  it('今日が請求日なら、今日を返す（今日を含む）', () => {
    expect(nextBillingDate('2026-10-05', 'monthly', 'fixedDay', '2026-11-05')).toBe('2026-11-05');
  });

  it('3か月の周期と、長く前の請求日', () => {
    expect(nextBillingDate('2026-01-15', 'quarterly', 'fixedDay', '2026-11-04')).toBe('2027-01-15');
    expect(nextBillingDate('2000-01-31', 'monthly', 'fixedDay', '2100-02-01')).toBe('2100-02-28');
  });

  it('endOfMonth で請求日が月末日でないデータは、その月の末日から数える（請求日より前は作らない）', () => {
    expect(nthBillingDate('2026-11-15', 'monthly', 'endOfMonth', 0)).toBe('2026-11-30');
    expect(nextBillingDate('2026-11-15', 'monthly', 'endOfMonth', '2026-12-01')).toBe('2026-12-31');
  });
});

describe('nthBillingDate（k 回目の請求日）', () => {
  it('0 回目は請求日そのもので、k×周期 か月を足していく', () => {
    expect(nthBillingDate('2026-10-08', 'monthly', 'fixedDay', 0)).toBe('2026-10-08');
    expect(nthBillingDate('2026-10-08', 'monthly', 'fixedDay', 3)).toBe('2027-01-08');
    expect(nthBillingDate('2026-08-31', 'semiAnnual', 'fixedDay', 1)).toBe('2027-02-28');
    expect(nthBillingDate('2026-08-31', 'semiAnnual', 'fixedDay', 2)).toBe('2027-08-31');
    expect(nthBillingDate('2024-02-29', 'yearly', 'fixedDay', 1)).toBe('2025-02-28');
    expect(nthBillingDate('2024-02-29', 'yearly', 'fixedDay', 4)).toBe('2028-02-29');
  });

  it('endOfMonth で3か月以上の周期は、請求がある月の末日', () => {
    expect(nthBillingDate('2026-11-30', 'quarterly', 'endOfMonth', 1)).toBe('2027-02-28');
    expect(nthBillingDate('2026-11-30', 'quarterly', 'endOfMonth', 2)).toBe('2027-05-31');
  });

  it('負・小数の k は RangeError', () => {
    expect(() => nthBillingDate('2026-10-08', 'monthly', 'fixedDay', -1)).toThrow(RangeError);
    expect(() => nthBillingDate('2026-10-08', 'monthly', 'fixedDay', 1.5)).toThrow(RangeError);
  });
});

describe('billingDatesInRange（期間の請求日）', () => {
  it('from・to を含む昇順の配列。請求日より前の請求日は作らない', () => {
    expect(billingDatesInRange('2026-10-08', 'monthly', 'fixedDay', '2026-11-01', '2026-11-30')).toEqual(['2026-11-08']);
    expect(billingDatesInRange('2026-11-20', 'monthly', 'fixedDay', '2026-10-01', '2026-12-31')).toEqual(['2026-11-20', '2026-12-20']);
    expect(billingDatesInRange('2026-10-08', 'monthly', 'fixedDay', '2026-11-08', '2026-11-08')).toEqual(['2026-11-08']);
  });

  it('from が to より後なら空の配列', () => {
    expect(billingDatesInRange('2026-10-08', 'monthly', 'fixedDay', '2026-12-01', '2026-11-01')).toEqual([]);
  });

  it('期間に請求が無ければ空の配列', () => {
    expect(billingDatesInRange('2025-12-01', 'yearly', 'fixedDay', '2026-11-01', '2026-11-30')).toEqual([]);
  });
});

describe('annualAmount・monthlyEquivalentTotal（換算と合計）', () => {
  it('年額換算＝請求額×(12÷周期の月数)', () => {
    expect(annualAmount(980, 'monthly')).toBe(11760);
    expect(annualAmount(3000, 'quarterly')).toBe(12000);
    expect(annualAmount(6000, 'semiAnnual')).toBe(12000);
    expect(annualAmount(12000, 'yearly')).toBe(12000);
  });

  it('月額換算の合計＝(A＋6)÷12 の切り捨て（要件定義書の例：月額980円と年額12,000円 → A＝23,760、1,980円）', () => {
    const total = annualAmount(980, 'monthly') + annualAmount(12000, 'yearly');
    expect(total).toBe(23760);
    expect(monthlyEquivalentTotal(total)).toBe(1980);
  });

  it('テストデータ（5件）の年額換算 156,600 円・月額換算 13,050 円', () => {
    const items: [number, BillingCycle][] = [
      [1590, 'monthly'],
      [980, 'monthly'],
      [6480, 'monthly'],
      [12000, 'yearly'],
      [3000, 'monthly'],
    ];
    const total = items.reduce((sum, [price, cycle]) => sum + annualAmount(price, cycle), 0);
    expect(total).toBe(156600);
    expect(monthlyEquivalentTotal(total)).toBe(13050);
  });

  it('1件分の月額換算は monthlyEquivalentTotal(annualAmount(...))', () => {
    expect(monthlyEquivalentTotal(annualAmount(1590, 'monthly'))).toBe(1590);
    expect(monthlyEquivalentTotal(annualAmount(12000, 'yearly'))).toBe(1000);
  });

  it('数でない金額は RangeError', () => {
    expect(() => annualAmount('980' as unknown as number, 'monthly')).toThrow(RangeError);
    expect(() => annualAmount(Number.NaN, 'monthly')).toThrow(RangeError);
    expect(() => monthlyEquivalentTotal(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('日付の部品', () => {
  it('isValidDate：形が YYYY-MM-DD で実在する日付か（RangeError を投げない）', () => {
    expect(isValidDate('2026-11-04')).toBe(true);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2027-02-29')).toBe(false);
    expect(isValidDate('2100-02-29')).toBe(false); // 2100年はうるう年ではない
    expect(isValidDate('2000-02-29')).toBe(true); // 2000年はうるう年
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-11-4')).toBe(false);
    expect(isValidDate('2026/11/04')).toBe(false);
    expect(isValidDate('')).toBe(false);
    expect(isValidDate(null)).toBe(false);
  });

  it('isEndOfMonth：月末日か', () => {
    expect(isEndOfMonth('2026-11-30')).toBe(true);
    expect(isEndOfMonth('2026-11-29')).toBe(false);
    expect(isEndOfMonth('2028-02-29')).toBe(true);
    expect(isEndOfMonth('2027-02-28')).toBe(true);
  });

  it('addDays：月・年・うるう年をまたぐ。負の n で前へ', () => {
    expect(addDays('2026-11-04', 7)).toBe('2026-11-11');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-11-04', -4)).toBe('2026-10-31');
    expect(addDays('2026-11-04', 0)).toBe('2026-11-04');
  });

  it('daysBetween：a から b までの日数（b が後なら正）', () => {
    expect(daysBetween('2026-11-04', '2026-11-11')).toBe(7);
    expect(daysBetween('2026-11-11', '2026-11-04')).toBe(-7);
    expect(daysBetween('2026-11-04', '2026-11-04')).toBe(0);
    expect(daysBetween('2027-12-31', '2028-12-31')).toBe(366);
  });

  it('daysInMonth：その月の日数（month は 1〜12）', () => {
    expect(daysInMonth(2026, 11)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
  });

  it('weekdayOf：曜日（0 が日曜）', () => {
    expect(weekdayOf('2026-11-04')).toBe(3); // 水曜（サンプルデータの今日）
    expect(weekdayOf('2026-11-08')).toBe(0); // 日曜
    expect(weekdayOf('2026-11-02')).toBe(1); // 月曜
    expect(weekdayOf('1970-01-01')).toBe(4); // 木曜
  });

  it('壊れた日付は RangeError（isValidDate のほか）', () => {
    for (const bad of ['2027-02-29', '2026-11-4', 'abc', '']) {
      expect(() => isEndOfMonth(bad)).toThrow(RangeError);
      expect(() => addDays(bad, 1)).toThrow(RangeError);
      expect(() => daysBetween(bad, '2026-11-04')).toThrow(RangeError);
      expect(() => weekdayOf(bad)).toThrow(RangeError);
      expect(() => nextBillingDate(bad, 'monthly', 'fixedDay', '2026-11-04')).toThrow(RangeError);
      expect(() => nextBillingDate('2026-10-08', 'monthly', 'fixedDay', bad)).toThrow(RangeError);
      expect(() => billingDatesInRange('2026-10-08', 'monthly', 'fixedDay', bad, '2026-11-30')).toThrow(RangeError);
    }
  });

  it('整数でない n・型に無い周期と方式・範囲外の月は RangeError', () => {
    expect(() => addDays('2026-11-04', 1.5)).toThrow(RangeError);
    expect(() => nextBillingDate('2026-10-08', 'weekly' as BillingCycle, 'fixedDay', '2026-11-04')).toThrow(RangeError);
    expect(() => nextBillingDate('2026-10-08', 'monthly', 'lastDay' as 'fixedDay', '2026-11-04')).toThrow(RangeError);
    expect(() => annualAmount(980, 'weekly' as BillingCycle)).toThrow(RangeError);
    expect(() => daysInMonth(2026, 0)).toThrow(RangeError);
    expect(() => daysInMonth(2026, 13)).toThrow(RangeError);
    expect(() => daysInMonth(2026.5, 1)).toThrow(RangeError);
  });
});
