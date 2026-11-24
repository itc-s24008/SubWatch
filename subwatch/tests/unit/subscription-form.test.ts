// lib/subscription-form.ts の単体テスト（04-06）。期待値は要件定義書「共通ルール」の入力項目の表、画面設計書 S-05、
// 機能設計書「API共通仕様」（B15・B17・B20・B63）、テスト一覧 No.1〜3（請求日）・No.65・No.66 のとおり
import { describe, expect, it } from 'vitest';
import {
  canChooseEndOfMonth,
  initialFormValues,
  nextBillingPreview,
  toCreateBody,
  toFormValues,
  toUpdateBody,
  validateForm,
  type FormValues,
} from '@/lib/subscription-form';
import type { SubscriptionDto } from '@/lib/types';

function netflixValues(fields: Partial<FormValues> = {}): FormValues {
  return {
    ...initialFormValues(),
    serviceName: 'Netflix',
    planName: 'スタンダード',
    price: '1590',
    billingCycle: 'monthly',
    firstBillingDate: '2026-10-08',
    category: 'video',
    websiteUrl: 'https://www.netflix.com',
    paymentMethod: 'メインカード',
    ...fields,
  };
}

const NETFLIX: SubscriptionDto = {
  subscriptionId: 'mockSubscription0001',
  serviceName: 'Netflix',
  planName: 'スタンダード',
  price: 1590,
  billingCycle: 'monthly',
  firstBillingDate: '2026-10-08',
  nextBillingDate: '2026-11-08',
  billingDayMode: 'fixedDay',
  category: 'video',
  trialEnabled: false,
  trialEndDate: null,
  websiteUrl: 'https://www.netflix.com',
  cancelUrl: null,
  paymentMethod: 'メインカード',
  memo: null,
  subscriptionNotificationEnabled: true,
  createdAt: '2026-10-01T00:01:00.000Z',
  updatedAt: '2026-10-01T00:01:00.000Z',
};

describe('validateForm', () => {
  it('No.8 必須項目が空なら、サービス名・請求額・請求周期・請求日にエラー（請求日方式とカテゴリーは初期値が入っているので出ない）', () => {
    expect(validateForm(initialFormValues())).toEqual({
      serviceName: 'サービス名を入力してください',
      price: '請求額は0〜10,000,000の整数で入力してください',
      billingCycle: '請求周期を選んでください',
      firstBillingDate: '正しい日付を選んでください',
    });
  });

  it('正しい値なら、エラーは無い', () => {
    expect(validateForm(netflixValues())).toEqual({});
  });

  it('サービス名：前後の空白を除いて1〜100文字（空白だけ・101文字は同じ文）', () => {
    expect(validateForm(netflixValues({ serviceName: '　 ' })).serviceName).toBe('サービス名を入力してください');
    expect(validateForm(netflixValues({ serviceName: 'あ'.repeat(101) })).serviceName).toBe('サービス名を入力してください');
    expect(validateForm(netflixValues({ serviceName: ` ${'あ'.repeat(100)} ` })).serviceName).toBeUndefined();
    expect(validateForm(netflixValues({ serviceName: '😀'.repeat(100) })).serviceName).toBeUndefined(); // コードポイントで数える
  });

  it('プラン名は100文字以内', () => {
    expect(validateForm(netflixValues({ planName: 'a'.repeat(100) })).planName).toBeUndefined();
    expect(validateForm(netflixValues({ planName: 'a'.repeat(101) })).planName).toBe('プラン名は100文字以内で入力してください');
  });

  it('請求額：0〜10,000,000の半角の整数だけ（前後の空白は除く。全角数字・小数・カンマ・符号は誤り）', () => {
    for (const ok of ['0', '10000000', ' 980 ']) expect(validateForm(netflixValues({ price: ok })).price, ok).toBeUndefined();
    for (const ng of ['', '10000001', '１５９０', '1.5', '1,590', '-1', '+1', 'abc']) {
      expect(validateForm(netflixValues({ price: ng })).price, ng).toBe('請求額は0〜10,000,000の整数で入力してください');
    }
  });

  it('請求日：2000-01-01〜2100-12-31 の実在する日付', () => {
    expect(validateForm(netflixValues({ firstBillingDate: '2000-01-01' })).firstBillingDate).toBeUndefined();
    expect(validateForm(netflixValues({ firstBillingDate: '2100-12-31' })).firstBillingDate).toBeUndefined();
    for (const ng of ['1999-12-31', '2101-01-01', '2026-02-29', '2026-13-01', '2026/10/08']) {
      expect(validateForm(netflixValues({ firstBillingDate: ng })).firstBillingDate, ng).toBe('正しい日付を選んでください');
    }
  });

  it('『毎月末日』は請求日が月末日のときだけ', () => {
    expect(validateForm(netflixValues({ firstBillingDate: '2026-11-30', billingDayMode: 'endOfMonth' })).billingDayMode).toBeUndefined();
    expect(validateForm(netflixValues({ firstBillingDate: '2026-11-29', billingDayMode: 'endOfMonth' })).billingDayMode).toBe(
      '『毎月末日』は請求日が月末日のときだけ選べます',
    );
    expect(canChooseEndOfMonth('2028-02-29')).toBe(true);
    expect(canChooseEndOfMonth('2026-02-28')).toBe(true);
    expect(canChooseEndOfMonth('2026-10-08')).toBe(false);
    expect(canChooseEndOfMonth('')).toBe(false);
  });

  it('No.65 トライアルがオンで最終無料日が空なら「最終無料日を入力してください」', () => {
    expect(validateForm(netflixValues({ trialEnabled: true, trialEndDate: '' })).trialEndDate).toBe('最終無料日を入力してください');
  });

  it('トライアルがオンなら、最終無料日は請求日より前（同じ日・後は誤り）。不正な日付は「正しい日付を選んでください」', () => {
    const base = { trialEnabled: true, firstBillingDate: '2026-11-30' };
    expect(validateForm(netflixValues({ ...base, trialEndDate: '2026-11-29' })).trialEndDate).toBeUndefined();
    expect(validateForm(netflixValues({ ...base, trialEndDate: '2026-11-30' })).trialEndDate).toBe('最終無料日は請求日より前の日付を入力してください');
    expect(validateForm(netflixValues({ ...base, trialEndDate: '2026-12-01' })).trialEndDate).toBe('最終無料日は請求日より前の日付を入力してください');
    expect(validateForm(netflixValues({ ...base, trialEndDate: '1999-12-31' })).trialEndDate).toBe('正しい日付を選んでください');
  });

  it('トライアルがオフなら、最終無料日は検証しない', () => {
    expect(validateForm(netflixValues({ trialEnabled: false, trialEndDate: '' })).trialEndDate).toBeUndefined();
  });

  it('URL：http:// か https:// で始まる2048文字以内（大文字小文字は問わない）', () => {
    expect(validateForm(netflixValues({ websiteUrl: 'HTTP://example.com' })).websiteUrl).toBeUndefined();
    expect(validateForm(netflixValues({ cancelUrl: 'www.example.com' })).cancelUrl).toBe('http:// か https:// から始まるURLを入力してください');
    expect(validateForm(netflixValues({ websiteUrl: `https://${'a'.repeat(2040)}` })).websiteUrl).toBeUndefined();
    expect(validateForm(netflixValues({ websiteUrl: `https://${'a'.repeat(2040)}b` })).websiteUrl).toBe(
      'http:// か https:// から始まるURLを入力してください',
    );
  });

  it('支払方法：80文字以内。カード番号様の数字（13桁以上。間に空白・ハイフンが1つまで）は拒否', () => {
    expect(validateForm(netflixValues({ paymentMethod: 'a'.repeat(81) })).paymentMethod).toBe('支払方法は80文字以内で入力してください');
    expect(validateForm(netflixValues({ paymentMethod: '4111 1111 1111 1111' })).paymentMethod).toBe('カード番号は入力できません');
    expect(validateForm(netflixValues({ paymentMethod: '4111-1111-1111-1' })).paymentMethod).toBe('カード番号は入力できません');
    expect(validateForm(netflixValues({ paymentMethod: '123456789012' })).paymentMethod).toBeUndefined(); // 12桁
    expect(validateForm(netflixValues({ paymentMethod: '1000円 2000円' })).paymentMethod).toBeUndefined();
  });

  it('メモ：1000文字以内。カード番号様の数字は拒否', () => {
    expect(validateForm(netflixValues({ memo: 'あ'.repeat(1000) })).memo).toBeUndefined();
    expect(validateForm(netflixValues({ memo: 'あ'.repeat(1001) })).memo).toBe('メモは1000文字以内で入力してください');
    expect(validateForm(netflixValues({ memo: 'カード 1234567890123' })).memo).toBe('カード番号は入力できません');
  });
});

describe('toCreateBody', () => {
  it('任意の項目が空なら null、トライアルがオフなら trialEndDate は null、confirmDuplicate は入れない（No.66）', () => {
    const body = toCreateBody(netflixValues({ planName: '', websiteUrl: '', paymentMethod: '', trialEndDate: '2026-11-10' }));
    expect(body).toEqual({
      serviceName: 'Netflix',
      planName: null,
      price: 1590,
      billingCycle: 'monthly',
      firstBillingDate: '2026-10-08',
      billingDayMode: 'fixedDay',
      category: 'video',
      trialEnabled: false,
      trialEndDate: null,
      websiteUrl: null,
      cancelUrl: null,
      paymentMethod: null,
      memo: null,
      subscriptionNotificationEnabled: true,
    });
    expect('confirmDuplicate' in body).toBe(false);
  });

  it('サービス名と請求額は前後の空白を除く。トライアルがオンなら最終無料日を送る', () => {
    const body = toCreateBody(netflixValues({ serviceName: ' Netflix　', price: ' 980 ', trialEnabled: true, trialEndDate: '2026-10-01' }));
    expect(body.serviceName).toBe('Netflix');
    expect(body.price).toBe(980);
    expect(body.trialEndDate).toBe('2026-10-01');
  });
});

describe('toFormValues と toUpdateBody', () => {
  it('API の値をフォームの値にする（null は空の欄）', () => {
    expect(toFormValues(NETFLIX)).toEqual(netflixValues());
  });

  it('変更が無ければ空のオブジェクト', () => {
    expect(toUpdateBody(NETFLIX, toFormValues(NETFLIX))).toEqual({});
  });

  it('変更した項目だけを送る（空にした任意の項目は null）', () => {
    const after = { ...toFormValues(NETFLIX), price: '1890', paymentMethod: '', memo: '家族で分担' };
    expect(toUpdateBody(NETFLIX, after)).toEqual({ price: 1890, paymentMethod: null, memo: '家族で分担' });
  });

  it('トライアルをオンにすると、trialEnabled と trialEndDate を一緒に送る。オフに戻すと trialEndDate は null', () => {
    const on = { ...toFormValues(NETFLIX), trialEnabled: true, trialEndDate: '2026-10-01' };
    expect(toUpdateBody(NETFLIX, on)).toEqual({ trialEnabled: true, trialEndDate: '2026-10-01' });
    const trial: SubscriptionDto = { ...NETFLIX, trialEnabled: true, trialEndDate: '2026-10-01' };
    expect(toUpdateBody(trial, { ...toFormValues(trial), trialEnabled: false })).toEqual({ trialEnabled: false, trialEndDate: null });
  });
});

describe('nextBillingPreview（⑧）', () => {
  it('図の例：2026-10-08・毎月・¥1,590 は、基準日 2026-11-04 で「11/08（¥1,590）」', () => {
    expect(nextBillingPreview(netflixValues(), '2026-11-04')).toBe('11/08（¥1,590）');
  });

  it('図の例：2026-11-30・毎月・毎月末日・¥3,000 は「11/30（¥3,000）」', () => {
    const values = netflixValues({ price: '3000', firstBillingDate: '2026-11-30', billingDayMode: 'endOfMonth' });
    expect(nextBillingPreview(values, '2026-11-04')).toBe('11/30（¥3,000）');
  });

  it('No.1〜3 と同じ計算（月末の丸め・うるう年・毎月末日）', () => {
    expect(nextBillingPreview(netflixValues({ firstBillingDate: '2027-01-31', price: '' }), '2027-02-01')).toBe('02/28');
    expect(nextBillingPreview(netflixValues({ firstBillingDate: '2027-01-31', price: '' }), '2027-03-01')).toBe('03/31');
    expect(nextBillingPreview(netflixValues({ firstBillingDate: '2028-01-31', price: '' }), '2028-02-01')).toBe('02/29');
    const eom = netflixValues({ firstBillingDate: '2026-11-30', billingDayMode: 'endOfMonth', price: '' });
    expect(nextBillingPreview(eom, '2026-12-01')).toBe('12/31');
    expect(nextBillingPreview(eom, '2027-02-01')).toBe('02/28');
  });

  it('3か月・6か月・毎年', () => {
    expect(nextBillingPreview(netflixValues({ billingCycle: 'quarterly', price: '' }), '2026-11-04')).toBe('01/08');
    expect(nextBillingPreview(netflixValues({ billingCycle: 'semiAnnual', price: '' }), '2026-11-04')).toBe('04/08');
    expect(nextBillingPreview(netflixValues({ billingCycle: 'yearly', firstBillingDate: '2025-12-01', price: '' }), '2026-11-04')).toBe('12/01');
  });

  it('請求額が正しくないときは日付だけ、計算できないときは「―」', () => {
    expect(nextBillingPreview(netflixValues({ price: '1.5' }), '2026-11-04')).toBe('11/08');
    expect(nextBillingPreview(netflixValues({ billingCycle: '' }), '2026-11-04')).toBe('―');
    expect(nextBillingPreview(netflixValues({ firstBillingDate: '' }), '2026-11-04')).toBe('―');
    expect(nextBillingPreview(netflixValues({ firstBillingDate: '2026-10-08', billingDayMode: 'endOfMonth' }), '2026-11-04')).toBe('―');
  });
});
