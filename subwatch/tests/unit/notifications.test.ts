// 通知の判定・決定的ID・文面（04-14。lib/notifications.ts）。期待値は機能設計書「テストデータ」「共通ロジック」「テスト一覧」と、要件定義書「共通ルール」の「通知の文面」のとおり
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { notificationId, notificationText, planNotifications } from '@/lib/notifications';
import type { SubscriptionDoc } from '@/lib/types';

// テストデータの5件（基準日 2026-11-04。機能設計書「テストデータ」）
function sub(fields: Partial<SubscriptionDoc>): SubscriptionDoc {
  return {
    subscriptionId: 'a'.repeat(20),
    uid: 'u1',
    serviceName: 'テスト',
    planName: null,
    price: 1000,
    billingCycle: 'monthly',
    firstBillingDate: '2026-11-04',
    nextBillingDate: '2026-11-04',
    billingDayMode: 'fixedDay',
    category: 'other',
    trialEnabled: false,
    trialEndDate: null,
    websiteUrl: null,
    cancelUrl: null,
    paymentMethod: null,
    memo: null,
    subscriptionNotificationEnabled: true,
    ...fields,
  } as SubscriptionDoc;
}
const NETFLIX = sub({ serviceName: 'Netflix', price: 1590, firstBillingDate: '2026-10-08', nextBillingDate: '2026-11-08' });
const SPOTIFY = sub({ serviceName: 'Spotify', price: 980, firstBillingDate: '2026-09-05', nextBillingDate: '2026-11-05' });
const ADOBE = sub({ serviceName: 'Adobe Creative Cloud', price: 6480, firstBillingDate: '2026-10-11', nextBillingDate: '2026-11-11' });
const ICLOUD = sub({ serviceName: 'iCloud+', price: 12000, billingCycle: 'yearly', firstBillingDate: '2025-12-01', nextBillingDate: '2026-12-01' });
const CHATGPT = sub({
  serviceName: 'ChatGPT',
  price: 3000,
  firstBillingDate: '2026-11-30',
  nextBillingDate: '2026-11-30',
  billingDayMode: 'endOfMonth',
  trialEnabled: true,
  trialEndDate: '2026-11-10',
});

describe('notificationId（決定的ID）', () => {
  it('sha256(uid|subscriptionId|notificationType|daysBefore|targetDate) の小文字16進（64文字）', () => {
    const id = notificationId('u1', 'sub1', 'billing', 1, '2026-11-04');
    expect(id).toBe(createHash('sha256').update('u1|sub1|billing|1|2026-11-04').digest('hex'));
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('同じ入力は同じID。どれか1つでも違えば別のID', () => {
    const id = notificationId('u1', 'sub1', 'billing', 1, '2026-11-04');
    expect(notificationId('u1', 'sub1', 'billing', 1, '2026-11-04')).toBe(id);
    const others = [
      notificationId('u2', 'sub1', 'billing', 1, '2026-11-04'),
      notificationId('u1', 'sub2', 'billing', 1, '2026-11-04'),
      notificationId('u1', 'sub1', 'trial_end', 1, '2026-11-04'),
      notificationId('u1', 'sub1', 'billing', 7, '2026-11-04'),
      notificationId('u1', 'sub1', 'billing', 1, '2026-11-05'),
    ];
    expect(new Set([id, ...others]).size).toBe(6);
  });
});

describe('notificationText（通知の文面）', () => {
  it('billing：title「請求日まであと{N}日」・body「{MM/DD}・¥{請求額} の請求予定」（3桁区切り）', () => {
    expect(notificationText('billing', 1, '2026-11-05', 980)).toEqual({ title: '請求日まであと1日', body: '11/05・¥980 の請求予定' });
    expect(notificationText('billing', 7, '2026-11-11', 6480)).toEqual({ title: '請求日まであと7日', body: '11/11・¥6,480 の請求予定' });
  });

  it('trial_end：title「無料トライアル終了まであと{N}日」・body「最終無料日は{MM/DD}です」', () => {
    expect(notificationText('trial_end', 7, '2026-11-11', null)).toEqual({ title: '無料トライアル終了まであと7日', body: '最終無料日は11/11です' });
    expect(notificationText('trial_end', 1, '2026-11-10', null)).toEqual({ title: '無料トライアル終了まであと1日', body: '最終無料日は11/10です' });
  });
});

describe('planNotifications（今日作る通知の判定）', () => {
  it('No.20 基準日 2026-11-04 のテストデータ5件：Spotify の請求1日前と Adobe Creative Cloud の請求7日前の2件だけ', () => {
    const today = '2026-11-04';
    expect(planNotifications(NETFLIX, today)).toEqual([]);
    expect(planNotifications(SPOTIFY, today)).toEqual([
      {
        notificationType: 'billing',
        daysBefore: 1,
        targetDate: '2026-11-04',
        title: '請求日まであと1日',
        body: '11/05・¥980 の請求予定',
        serviceNameAtNotification: 'Spotify',
        priceAtNotification: 980,
      },
    ]);
    expect(planNotifications(ADOBE, today)).toEqual([
      {
        notificationType: 'billing',
        daysBefore: 7,
        targetDate: '2026-11-04',
        title: '請求日まであと7日',
        body: '11/11・¥6,480 の請求予定',
        serviceNameAtNotification: 'Adobe Creative Cloud',
        priceAtNotification: 6480,
      },
    ]);
    expect(planNotifications(ICLOUD, today)).toEqual([]);
    // ChatGPT のトライアル通知は、7日前は過去、1日前は 11/09 なので今日は作られない
    expect(planNotifications(CHATGPT, today)).toEqual([]);
  });

  it('テストデータの ChatGPT は 2026-11-09 に trial_end（1日前）が作られる', () => {
    expect(planNotifications(CHATGPT, '2026-11-09')).toEqual([
      expect.objectContaining({ notificationType: 'trial_end', daysBefore: 1, targetDate: '2026-11-09', priceAtNotification: null, body: '最終無料日は11/10です' }),
    ]);
  });

  it('No.23 price=0 のサブスクは、請求7日前でも billing 通知を作らない', () => {
    expect(planNotifications(sub({ price: 0, firstBillingDate: '2026-11-11' }), '2026-11-04')).toEqual([]);
  });

  it('料金が数でない・0より小さいときも billing を作らない', () => {
    expect(planNotifications(sub({ price: '980' as unknown as number, firstBillingDate: '2026-11-11' }), '2026-11-04')).toEqual([]);
    expect(planNotifications(sub({ price: -1, firstBillingDate: '2026-11-11' }), '2026-11-04')).toEqual([]);
  });

  it('No.46 trialEnabled=true・最終無料日 11/10・請求日 11/16・料金980円で 11/09：trial_end（1日前）だけ（請求日の7日前が重なっても billing は作らない）', () => {
    const plans = planNotifications(sub({ price: 980, firstBillingDate: '2026-11-16', trialEnabled: true, trialEndDate: '2026-11-10' }), '2026-11-09');
    expect(plans).toEqual([expect.objectContaining({ notificationType: 'trial_end', daysBefore: 1 })]);
  });

  it('No.67 trialEnabled=true・最終無料日 2026-11-11・請求日 2026-11-20・980円：11/04 は trial_end（7日前）、11/10 は trial_end（1日前）、11/11（当日）は何も作らない', () => {
    const s = sub({ price: 980, firstBillingDate: '2026-11-20', trialEnabled: true, trialEndDate: '2026-11-11' });
    expect(planNotifications(s, '2026-11-04')).toEqual([
      expect.objectContaining({
        notificationType: 'trial_end',
        daysBefore: 7,
        targetDate: '2026-11-04',
        priceAtNotification: null,
        title: '無料トライアル終了まであと7日',
        body: '最終無料日は11/11です',
      }),
    ]);
    expect(planNotifications(s, '2026-11-10')).toEqual([expect.objectContaining({ notificationType: 'trial_end', daysBefore: 1 })]);
    expect(planNotifications(s, '2026-11-11')).toEqual([]);
  });

  it('No.68 subscriptionNotificationEnabled=false のサブスクは通知を作らない', () => {
    expect(planNotifications({ ...SPOTIFY, subscriptionNotificationEnabled: false }, '2026-11-04')).toEqual([]);
  });

  it('trialEnabled=false なら、trialEndDate が残っていても trial_end は作らない（billing の判定だけ）', () => {
    const s = sub({ price: 980, firstBillingDate: '2026-11-30', trialEnabled: false, trialEndDate: '2026-11-11' });
    expect(planNotifications(s, '2026-11-04')).toEqual([]);
    expect(planNotifications({ ...s, firstBillingDate: '2026-11-11' }, '2026-11-04')).toEqual([
      expect.objectContaining({ notificationType: 'billing', daysBefore: 7 }),
    ]);
  });

  it('判定には保存された nextBillingDate ではなく、請求日と周期から計算し直した次回請求日を使う', () => {
    expect(planNotifications({ ...SPOTIFY, nextBillingDate: '2026-11-11' }, '2026-11-04')).toEqual([
      expect.objectContaining({ notificationType: 'billing', daysBefore: 1, body: '11/05・¥980 の請求予定' }),
    ]);
  });

  it('請求日・周期・請求日方式のどれかが壊れていたら、billing も trial_end も作らない', () => {
    const trial = { trialEnabled: true, trialEndDate: '2026-11-11' };
    expect(planNotifications(sub({ ...trial, firstBillingDate: '2026-13-01' }), '2026-11-04')).toEqual([]);
    expect(planNotifications(sub({ ...trial, billingCycle: 'weekly' as never }), '2026-11-04')).toEqual([]);
    expect(planNotifications(sub({ ...trial, billingDayMode: 'x' as never }), '2026-11-04')).toEqual([]);
  });

  it('当日（0日前）と、7日・1日以外の日は作らない', () => {
    expect(planNotifications(sub({ firstBillingDate: '2026-11-04' }), '2026-11-04')).toEqual([]);
    expect(planNotifications(sub({ firstBillingDate: '2026-11-06' }), '2026-11-04')).toEqual([]);
  });
});
