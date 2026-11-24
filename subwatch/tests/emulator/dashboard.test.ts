// GET /api/dashboard（04-09。API一覧 No.10、詳細_F-04、API共通仕様 B75・B79）
// route 経由のテストは、実際の今日からの相対日付で書く（API共通仕様 B55）。基準日 2026-11-04 の期待値は、getDashboard に today を渡して確かめる
//
// 仮：サブスクを置く処理（seedTestSubscription）とテストデータの5件（TEST_DATA）は、04-07 の seedSubscriptions・TEST_DATA_SUBSCRIPTIONS が
// このブランチにまだ無いので、このファイルの中に仮に書いた。統合①で 04-07 のもの（tests/emulator/helpers.ts）にそろえる
import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/dashboard/route';
import { addDays } from '@/lib/billing';
import { todayJST } from '@/lib/clock';
import { getDashboard } from '@/lib/dashboard';
import { adminDb } from '@/lib/firebase-admin';
import { callRoute, resetEmulators, seedUser, signUpUser } from './helpers';

let createdSeq = 0;

// 仮：users/{uid}/subscriptions に1件置く（保存の形。DB設計書 No.2）。作成日時は呼んだ順に1ミリ秒ずつ進める
async function seedTestSubscription(uid: string, fields: Record<string, unknown>): Promise<string> {
  createdSeq += 1;
  const ref = adminDb().collection('users').doc(uid).collection('subscriptions').doc();
  const createdAt = Timestamp.fromMillis(Date.UTC(2026, 9, 1) + createdSeq);
  await ref.set({
    subscriptionId: ref.id,
    uid,
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
    createdAt,
    updatedAt: createdAt,
    ...fields,
  });
  return ref.id;
}

// 仮：機能設計書「テストデータ」の5件（登録の順は表の行の順）
const TEST_DATA: Record<string, unknown>[] = [
  { serviceName: 'Netflix', price: 1590, billingCycle: 'monthly', firstBillingDate: '2026-10-08', billingDayMode: 'fixedDay', category: 'video', nextBillingDate: '2026-11-08', websiteUrl: 'https://www.netflix.com' },
  { serviceName: 'Spotify', price: 980, billingCycle: 'monthly', firstBillingDate: '2026-09-05', billingDayMode: 'fixedDay', category: 'music', nextBillingDate: '2026-11-05' },
  { serviceName: 'Adobe Creative Cloud', price: 6480, billingCycle: 'monthly', firstBillingDate: '2026-10-11', billingDayMode: 'fixedDay', category: 'cloud', nextBillingDate: '2026-11-11' },
  { serviceName: 'iCloud+', price: 12000, billingCycle: 'yearly', firstBillingDate: '2025-12-01', billingDayMode: 'fixedDay', category: 'cloud', nextBillingDate: '2026-12-01' },
  { serviceName: 'ChatGPT', price: 3000, billingCycle: 'monthly', firstBillingDate: '2026-11-30', billingDayMode: 'endOfMonth', category: 'ai', nextBillingDate: '2026-11-30', trialEnabled: true, trialEndDate: '2026-11-10' },
];

async function seedNotification(uid: string, id: string, createdAt: Date, viewedAt: Date | null): Promise<void> {
  await adminDb()
    .collection('users')
    .doc(uid)
    .collection('notificationEvents')
    .doc(id)
    .set({ notificationId: id, uid, createdAt: Timestamp.fromDate(createdAt), viewedAt: viewedAt ? Timestamp.fromDate(viewedAt) : null });
}

async function callDashboard(token?: string) {
  return callRoute(GET, { token, path: '/api/dashboard' });
}

beforeEach(async () => {
  await resetEmulators();
});

describe('GET /api/dashboard', () => {
  it('No.4 テストデータ5件を置き、基準日 2026-11-04 で集計すると、今週2件2,570円・今月4件12,050円・月額換算13,050円・年額換算156,600円', async () => {
    const user = await signUpUser();
    await seedUser(user.uid);
    for (const item of TEST_DATA) await seedTestSubscription(user.uid, item);
    const result = await getDashboard(user.uid, { today: '2026-11-04', now: new Date('2026-11-04T00:00:00.000Z') });
    expect(result).toMatchObject({
      weekTotal: { count: 2, amountJPY: 2570 },
      monthTotal: { count: 4, amountJPY: 12050 },
      monthlyEquivalentJPY: 13050,
      yearlyEquivalentJPY: 156600,
      subscriptionCount: 5,
      unreadCount: 0,
    });
    expect(result.nextBills.map((b) => [b.serviceName, b.daysLeft])).toEqual([
      ['Spotify', 1],
      ['Netflix', 4],
      ['Adobe Creative Cloud', 7],
    ]);
    expect(result.nextBills[1].websiteUrl).toBe('https://www.netflix.com');
  });

  it('0件：200 で金額・件数は0、nextBills は空', async () => {
    const user = await signUpUser();
    await seedUser(user.uid);
    const res = await callDashboard(user.token);
    expect(res.status).toBe(200);
    expect(res.body?.data).toEqual({
      weekTotal: { count: 0, amountJPY: 0 },
      monthTotal: { count: 0, amountJPY: 0 },
      monthlyEquivalentJPY: 0,
      yearlyEquivalentJPY: 0,
      subscriptionCount: 0,
      unreadCount: 0,
      nextBills: [],
    });
  });

  it('実際の今日から：今日・7日後は nextBills に入り（daysLeft 0・7）、8日後は入らない。同じ日は登録の古い順', async () => {
    const user = await signUpUser();
    await seedUser(user.uid);
    const today = todayJST();
    const in7 = addDays(today, 7);
    const in8 = addDays(today, 8);
    await seedTestSubscription(user.uid, { serviceName: '8日後', firstBillingDate: in8, nextBillingDate: in8 });
    const older = await seedTestSubscription(user.uid, { serviceName: '7日後A', firstBillingDate: in7, nextBillingDate: in7 });
    await seedTestSubscription(user.uid, { serviceName: '今日', firstBillingDate: today, nextBillingDate: today, websiteUrl: 'https://example.com' });
    const newer = await seedTestSubscription(user.uid, { serviceName: '7日後B', firstBillingDate: in7, nextBillingDate: in7 });
    const res = await callDashboard(user.token);
    expect(res.status).toBe(200);
    expect(res.body?.data.subscriptionCount).toBe(4);
    expect(res.body?.data.nextBills).toEqual([
      expect.objectContaining({ serviceName: '今日', date: today, daysLeft: 0, priceJPY: 1000, websiteUrl: 'https://example.com' }),
      { subscriptionId: older, serviceName: '7日後A', websiteUrl: null, date: in7, priceJPY: 1000, daysLeft: 7 },
      { subscriptionId: newer, serviceName: '7日後B', websiteUrl: null, date: in7, priceJPY: 1000, daysLeft: 7 },
    ]);
  });

  it('壊れた日付・料金のサブスクがあっても 500 にせず、登録数にだけ数える', async () => {
    const user = await signUpUser();
    await seedUser(user.uid);
    await seedTestSubscription(user.uid, { firstBillingDate: 'broken' });
    await seedTestSubscription(user.uid, { price: 'x' });
    await seedTestSubscription(user.uid, { billingCycle: 'weekly' });
    const res = await callDashboard(user.token);
    expect(res.status).toBe(200);
    expect(res.body?.data).toMatchObject({ subscriptionCount: 3, yearlyEquivalentJPY: 0, monthlyEquivalentJPY: 0, nextBills: [] });
  });

  it('登録数は読み取った実件数（users.subscriptionCount ではない）。他人のサブスクは数えない', async () => {
    const user = await signUpUser();
    const other = await signUpUser();
    await seedUser(user.uid, { subscriptionCount: 99 });
    await seedUser(other.uid);
    await seedTestSubscription(user.uid, {});
    await seedTestSubscription(user.uid, {});
    await seedTestSubscription(other.uid, {});
    const res = await callDashboard(user.token);
    expect(res.body?.data.subscriptionCount).toBe(2);
  });

  it('未読の数：viewedAt が null で、作成が直近90日のものだけ（既読・90日より前は数えない）', async () => {
    const user = await signUpUser();
    await seedUser(user.uid);
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    await seedNotification(user.uid, 'a', new Date(now - day), null);
    await seedNotification(user.uid, 'b', new Date(now - 89 * day), null);
    await seedNotification(user.uid, 'c', new Date(now - 2 * day), new Date(now - day)); // 既読
    await seedNotification(user.uid, 'd', new Date(now - 91 * day), null); // 90日より前
    const res = await callDashboard(user.token);
    expect(res.body?.data.unreadCount).toBe(2);
  });

  it('token が無ければ 401 UNAUTHENTICATED', async () => {
    const res = await callDashboard();
    expect(res.status).toBe(401);
    expect(res.body?.error.code).toBe('UNAUTHENTICATED');
  });

  it('users が無ければ 409 ACCOUNT_NOT_INITIALIZED、規約の版が古ければ 409 TERMS_RECONSENT_REQUIRED', async () => {
    const user = await signUpUser();
    expect((await callDashboard(user.token)).body?.error.code).toBe('ACCOUNT_NOT_INITIALIZED');
    await seedUser(user.uid, { termsVersion: '2000-01-01' });
    const res = await callDashboard(user.token);
    expect(res.status).toBe(409);
    expect(res.body?.error.code).toBe('TERMS_RECONSENT_REQUIRED');
  });
});
