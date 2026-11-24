// S-06 の計算（lib/subscription-detail.ts）の単体テスト（04-19）
// テスト一覧 No.59（解約案内。lib の関数を直接呼ぶ部分。今日は引数で渡す）と、S-06 の③④換算額
// 期待値は画面設計書 S-06 ①③④⑧、機能設計書 詳細_F-03 の手順10、決まりの一覧 C-14
import { describe, expect, it } from 'vitest';
import {
  annualEquivalentOf,
  cancelGuideOf,
  cancelGuideText,
  hasMemo,
  hasPaymentMethod,
  monthlyEquivalentOf,
} from '@/lib/subscription-detail';
import type { BillingCycle } from '@/lib/types';

const TODAY = '2026-11-04'; // 基準日

function sub(fields: { trialEnabled?: boolean; trialEndDate?: string | null; nextBillingDate: string; price?: number }) {
  return { trialEnabled: false, trialEndDate: null, price: 1590, ...fields };
}

describe('No.59 解約案内：無料トライアル（trialEnabled が true）', () => {
  it('No.59 最終無料日が今日（0日）なら、トライアルの案内を出す（請求日が8日以上先でも）', () => {
    const guide = cancelGuideOf(sub({ trialEnabled: true, trialEndDate: '2026-11-04', nextBillingDate: '2026-11-20' }), TODAY);
    expect(guide).toEqual({ kind: 'trial', date: '2026-11-04' });
    expect(cancelGuideText(guide!)).toEqual({
      lead: '11/04 で無料期間が終わります。',
      body: '続けないなら、その日までに解約を検討しましょう。',
    });
  });

  it('No.59 最終無料日まで7日なら、トライアルの案内を出す（請求日が8日以上先でも）', () => {
    const guide = cancelGuideOf(sub({ trialEnabled: true, trialEndDate: '2026-11-11', nextBillingDate: '2026-12-12' }), TODAY);
    expect(guide).toEqual({ kind: 'trial', date: '2026-11-11' });
    expect(cancelGuideText(guide!).lead).toBe('11/11 で無料期間が終わります。');
  });

  it('No.59 最終無料日まで8日なら、トライアルの案内は出さない（請求日も8日以上先なら案内なし）', () => {
    expect(cancelGuideOf(sub({ trialEnabled: true, trialEndDate: '2026-11-12', nextBillingDate: '2026-11-12' }), TODAY)).toBeNull();
  });

  it('No.59 最終無料日まで8日で、請求日が7日以内なら、請求の案内を出す', () => {
    const guide = cancelGuideOf(sub({ trialEnabled: true, trialEndDate: '2026-11-12', nextBillingDate: '2026-11-08', price: 1590 }), TODAY);
    expect(guide).toEqual({ kind: 'billing', date: '2026-11-08', price: 1590 });
  });

  it('No.59 最終無料日を過ぎた後は、請求日の条件だけで決める（7日以内なら請求の案内、8日以上先なら案内なし）', () => {
    const near = cancelGuideOf(sub({ trialEnabled: true, trialEndDate: '2026-11-03', nextBillingDate: '2026-11-10', price: 980 }), TODAY);
    expect(near).toEqual({ kind: 'billing', date: '2026-11-10', price: 980 });
    expect(cancelGuideText(near!)).toEqual({
      lead: '11/10 に ¥980 の請求予定です。',
      body: '使っていなければ、請求日の前に解約を検討しましょう。',
    });
    expect(cancelGuideOf(sub({ trialEnabled: true, trialEndDate: '2026-11-03', nextBillingDate: '2026-11-12' }), TODAY)).toBeNull();
  });

  it('trialEnabled が false なら、最終無料日の値があっても、請求日の条件だけで決める', () => {
    expect(cancelGuideOf(sub({ trialEnabled: false, trialEndDate: '2026-11-05', nextBillingDate: '2026-11-30' }), TODAY)).toBeNull();
  });
});

describe('No.59 解約案内：請求', () => {
  it('No.59 次回請求日が今日（0日）・7日後なら請求の案内を出し、8日後なら出さない', () => {
    expect(cancelGuideOf(sub({ nextBillingDate: '2026-11-04' }), TODAY)).toEqual({ kind: 'billing', date: '2026-11-04', price: 1590 });
    expect(cancelGuideOf(sub({ nextBillingDate: '2026-11-11' }), TODAY)).toEqual({ kind: 'billing', date: '2026-11-11', price: 1590 });
    expect(cancelGuideOf(sub({ nextBillingDate: '2026-11-12' }), TODAY)).toBeNull();
  });

  it('No.59 0円のサブスクも同じ条件で出す（文は ¥0）', () => {
    const guide = cancelGuideOf(sub({ nextBillingDate: '2026-11-05', price: 0 }), TODAY);
    expect(cancelGuideText(guide!).lead).toBe('11/05 に ¥0 の請求予定です。');
  });

  it('テストデータ（基準日 2026-11-04）：Netflix 11/08・Adobe 11/11 は出し、Spotify 12/05・iCloud+ 12/01・ChatGPT 11/30 は出さない', () => {
    expect(cancelGuideText(cancelGuideOf(sub({ nextBillingDate: '2026-11-08', price: 1590 }), TODAY)!).lead).toBe('11/08 に ¥1,590 の請求予定です。');
    expect(cancelGuideText(cancelGuideOf(sub({ nextBillingDate: '2026-11-11', price: 6480 }), TODAY)!).lead).toBe('11/11 に ¥6,480 の請求予定です。');
    for (const date of ['2026-12-05', '2026-12-01', '2026-11-30']) {
      expect(cancelGuideOf(sub({ nextBillingDate: date }), TODAY)).toBeNull();
    }
  });

  it('次回請求日が今日より前（-1日）・壊れた日付なら出さない（例外を投げない）', () => {
    expect(cancelGuideOf(sub({ nextBillingDate: '2026-11-03' }), TODAY)).toBeNull();
    expect(cancelGuideOf(sub({ nextBillingDate: '2026-02-30' }), TODAY)).toBeNull();
    expect(cancelGuideOf(sub({ trialEnabled: true, trialEndDate: 'broken', nextBillingDate: '2026-11-05' }), TODAY)).toEqual({
      kind: 'billing',
      date: '2026-11-05',
      price: 1590,
    });
  });

  it('月をまたぐ・年をまたぐ日数も数える', () => {
    expect(cancelGuideOf(sub({ nextBillingDate: '2027-01-02' }), '2026-12-26')).not.toBeNull(); // 7日
    expect(cancelGuideOf(sub({ nextBillingDate: '2027-01-03' }), '2026-12-26')).toBeNull(); // 8日
  });
});

describe('S-06 ③月額換算・④年額換算（1件分）', () => {
  const cases: [number, BillingCycle, number, number][] = [
    [1590, 'monthly', 1590, 19080], // Netflix（図 S-06）
    [6480, 'monthly', 6480, 77760], // Adobe（図 S-06_サービス詳細_Adobe）
    [12000, 'yearly', 1000, 12000], // iCloud+
    [10000, 'yearly', 833, 10000], // 833.33… → 833
    [1000, 'semiAnnual', 167, 2000], // 166.66… → 167
    [3000, 'quarterly', 1000, 12000],
    [0, 'monthly', 0, 0],
    [6, 'yearly', 1, 6], // 0.5 → 1（四捨五入）
  ];
  for (const [price, cycle, monthly, annual] of cases) {
    it(`${price}円・${cycle} → 月額 ${monthly}・年額 ${annual}`, () => {
      expect(monthlyEquivalentOf(price, cycle)).toBe(monthly);
      expect(annualEquivalentOf(price, cycle)).toBe(annual);
    });
  }

  it('計算できない（型に無い周期・数でない金額）ときは null（画面は「―」）', () => {
    expect(monthlyEquivalentOf(1000, 'weekly' as BillingCycle)).toBeNull();
    expect(annualEquivalentOf(Number.NaN, 'monthly')).toBeNull();
  });
});

describe('S-06 ②支払方法・⑧メモを出すか', () => {
  it('未入力・空白だけなら出さない', () => {
    expect(hasMemo(null)).toBe(false);
    expect(hasMemo('')).toBe(false);
    expect(hasMemo(' 　\n ')).toBe(false);
    expect(hasMemo('家族と分担')).toBe(true);
    expect(hasPaymentMethod(null)).toBe(false);
    expect(hasPaymentMethod('')).toBe(false);
    expect(hasPaymentMethod('メインカード')).toBe(true);
  });
});
