// lib/validation.ts の単体テスト（期待値は機能設計書「API共通仕様」と要件定義書「共通ルール」）
import { describe, expect, it } from 'vitest';
import {
  duplicateKey,
  hasCardLikeNumber,
  hasHttpScheme,
  isSubscriptionId,
  validateSubscriptionCrossFields,
  validateSubscriptionFields,
} from '@/lib/validation';

const VALID = { serviceName: 'Netflix', price: 1590, billingCycle: 'monthly', firstBillingDate: '2026-10-08', billingDayMode: 'fixedDay', category: 'video' };

describe('部品', () => {
  it('hasCardLikeNumber：半角数字13桁以上（間に半角空白・全角空白・半角ハイフンが1つまで）', () => {
    expect(hasCardLikeNumber('4111111111111')).toBe(true); // 13桁
    expect(hasCardLikeNumber('411111111111')).toBe(false); // 12桁
    expect(hasCardLikeNumber('4111-1111-1111-1111')).toBe(true);
    expect(hasCardLikeNumber('4111 1111　1111 1111')).toBe(true);
    expect(hasCardLikeNumber('4111--1111-1111-1111')).toBe(false); // 間に2つ
    expect(hasCardLikeNumber('1000円 2000円')).toBe(false);
    expect(hasCardLikeNumber('４１１１１１１１１１１１１')).toBe(false); // 全角数字は対象外
    expect(hasCardLikeNumber('12345678901234567890123')).toBe(true); // 20桁以上も拒否
  });

  it('hasHttpScheme：http:// か https:// で始まるか（大文字小文字を区別しない）', () => {
    expect(hasHttpScheme('https://www.netflix.com')).toBe(true);
    expect(hasHttpScheme('HTTP://example.com')).toBe(true);
    expect(hasHttpScheme('javascript:alert(1)')).toBe(false);
    expect(hasHttpScheme('www.netflix.com')).toBe(false);
  });

  it('duplicateKey：前後の空白（全角を含む）を除き、英字だけを小文字にする', () => {
    expect(duplicateKey(' Netflix　')).toBe('netflix');
    expect(duplicateKey('netflix')).toBe(duplicateKey('Netflix '));
    expect(duplicateKey('ＮＥＴＦＬＩＸ')).toBe('ＮＥＴＦＬＩＸ'); // 全角英字は正規化しない
  });

  it('isSubscriptionId：英数字20文字', () => {
    expect(isSubscriptionId('abcdefghijKLMNOPQR12')).toBe(true);
    expect(isSubscriptionId('abc')).toBe(false);
    expect(isSubscriptionId('abcdefghijKLMNOPQR1_')).toBe(false);
    expect(isSubscriptionId(null)).toBe(false);
  });
});

describe('validateSubscriptionFields', () => {
  it('正しい本文は誤りが無く、省いた任意の項目に既定の値が入る。サービス名は前後の空白を除く', () => {
    const { values, errors } = validateSubscriptionFields({ ...VALID, serviceName: '  Netflix ' }, 'create');
    expect(errors).toEqual([]);
    expect(values).toMatchObject({ serviceName: 'Netflix', planName: null, trialEnabled: false, trialEndDate: null, subscriptionNotificationEnabled: true });
  });

  it('必須項目が無いときは、その項目の誤り（表の順）', () => {
    const { errors } = validateSubscriptionFields({}, 'create');
    expect(errors.map((e) => e.field)).toEqual(['serviceName', 'price', 'billingCycle', 'firstBillingDate', 'billingDayMode', 'category']);
    expect(errors.find((e) => e.field === 'category')?.message).toBe('カテゴリーを選んでください');
  });

  it('価格は 0〜10,000,000 の整数（小数・範囲外・文字列は誤り）', () => {
    for (const price of [-1, 10_000_001, 1.5, '100']) {
      const { errors } = validateSubscriptionFields({ ...VALID, price }, 'create');
      expect(errors).toEqual([{ field: 'price', code: 'VALIDATION_ERROR', message: '請求額は0〜10,000,000の整数で入力してください' }]);
    }
    expect(validateSubscriptionFields({ ...VALID, price: 0 }, 'create').errors).toEqual([]);
    expect(validateSubscriptionFields({ ...VALID, price: 10_000_000 }, 'create').errors).toEqual([]);
  });

  it('日付：文字列でない・null は VALIDATION_ERROR、空文字・不正・範囲外は INVALID_DATE（文はどちらも「正しい日付を選んでください」）', () => {
    expect(validateSubscriptionFields({ ...VALID, firstBillingDate: 20261008 }, 'create').errors[0]).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(validateSubscriptionFields({ ...VALID, firstBillingDate: null }, 'create').errors[0]).toMatchObject({ code: 'VALIDATION_ERROR' });
    for (const date of ['', '2026-02-30', '1999-12-31', '2101-01-01', '2026/10/08']) {
      expect(validateSubscriptionFields({ ...VALID, firstBillingDate: date }, 'create').errors[0]).toEqual({
        field: 'firstBillingDate',
        code: 'INVALID_DATE',
        message: '正しい日付を選んでください',
      });
    }
  });

  it('1つの項目は、型 → 長さ → カード番号様の順で最初の1件だけ', () => {
    const long = '4111111111111' + 'あ'.repeat(80);
    expect(validateSubscriptionFields({ ...VALID, paymentMethod: long }, 'create').errors).toEqual([
      { field: 'paymentMethod', code: 'VALIDATION_ERROR', message: '支払方法は80文字以内で入力してください' },
    ]);
    expect(validateSubscriptionFields({ ...VALID, memo: 'カード 4111111111111' }, 'create').errors).toEqual([
      { field: 'memo', code: 'CARD_LIKE_VALUE', message: 'カード番号は入力できません' },
    ]);
  });

  it('文字数はコードポイントで数える（絵文字1つで1文字）', () => {
    expect(validateSubscriptionFields({ ...VALID, serviceName: '😀'.repeat(100) }, 'create').errors).toEqual([]);
    expect(validateSubscriptionFields({ ...VALID, serviceName: '😀'.repeat(101) }, 'create').errors[0].field).toBe('serviceName');
  });

  it('URL は http・https で始まる 2048 文字以内。null・空文字は null', () => {
    expect(validateSubscriptionFields({ ...VALID, cancelUrl: 'ftp://x' }, 'create').errors[0]).toMatchObject({
      field: 'cancelUrl',
      message: 'http:// か https:// から始まるURLを入力してください',
    });
    expect(validateSubscriptionFields({ ...VALID, websiteUrl: '' }, 'create').values.websiteUrl).toBeNull();
  });

  it('真偽値の項目に null や文字列を送ると誤り', () => {
    expect(validateSubscriptionFields({ ...VALID, trialEnabled: null }, 'create').errors[0]).toMatchObject({ field: 'trialEnabled', message: '入力内容を確認してください' });
    expect(validateSubscriptionFields({ ...VALID, subscriptionNotificationEnabled: 'true' }, 'create').errors[0].field).toBe('subscriptionNotificationEnabled');
  });

  it('update は送られた項目だけを調べる', () => {
    expect(validateSubscriptionFields({ price: 500 }, 'update')).toEqual({ values: { price: 500 }, errors: [] });
    expect(validateSubscriptionFields({ serviceName: null }, 'update').errors[0].field).toBe('serviceName');
  });
});

describe('validateSubscriptionCrossFields（項目の間）', () => {
  it('endOfMonth なのに請求日が月末日でない', () => {
    expect(validateSubscriptionCrossFields({ firstBillingDate: '2026-11-15', billingDayMode: 'endOfMonth', trialEnabled: false, trialEndDate: null })).toEqual([
      { field: 'billingDayMode', code: 'VALIDATION_ERROR', message: '『毎月末日』は請求日が月末日のときだけ選べます' },
    ]);
  });

  it('トライアル中で、最終無料日が無い・請求日以後。両方の誤りがあれば表の順で全部', () => {
    expect(validateSubscriptionCrossFields({ firstBillingDate: '2026-11-30', billingDayMode: 'fixedDay', trialEnabled: true, trialEndDate: null })[0].message).toBe(
      '最終無料日を入力してください',
    );
    expect(validateSubscriptionCrossFields({ firstBillingDate: '2026-11-30', billingDayMode: 'fixedDay', trialEnabled: true, trialEndDate: '2026-11-30' })[0].message).toBe(
      '最終無料日は請求日より前の日付を入力してください',
    );
    expect(
      validateSubscriptionCrossFields({ firstBillingDate: '2026-11-15', billingDayMode: 'endOfMonth', trialEnabled: true, trialEndDate: '2026-12-01' }).map((e) => e.field),
    ).toEqual(['billingDayMode', 'trialEndDate']);
  });
});
