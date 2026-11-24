// F-06 日次 Cron・F-08 のトライアル通知（04-14）。期待値は機能設計書「テスト一覧」「テストデータ」「詳細_F-06」「API共通仕様」のとおり
// route を通すテストでは、通知イベントの webPushStatus を期待値に入れない（11/25 の統合で本物の送信に替わると、購読の無い利用者は skipped になる）。
// 送信の結果を確かめるテストは、runDailyCron に偽の PushSender を渡して行う
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { GET } from '@/app/api/cron/daily/route';
import { todayJST } from '@/lib/clock';
import { runDailyCron } from '@/lib/cron';
import { HttpError } from '@/lib/errors';
import { adminDb } from '@/lib/firebase-admin';
import { notificationId } from '@/lib/notifications';
import type { NotificationEvent, PushResult, PushSender, SubscriptionDoc } from '@/lib/types';
import { TEST_DATA_SUBSCRIPTIONS, callRoute, cronAuthHeaders, resetEmulators, seedNotificationEvents, seedSubscriptions, seedUser } from './helpers';

const DAY_MS = 24 * 60 * 60 * 1000;
const ENV_KEYS = ['CRON_SECRET', 'ALLOW_CRON_RUNDATE_OVERRIDE'] as const;
const savedEnv: Record<string, string | undefined> = {};

function callCron(query = '', headers: Record<string, string> = cronAuthHeaders()) {
  return callRoute(GET, { path: `/api/cron/daily${query}`, headers });
}

async function events(uid: string) {
  const snapshot = await adminDb().collection('users').doc(uid).collection('notificationEvents').get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Record<string, any>); // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function cronRun(runDate: string) {
  const snapshot = await adminDb().collection('cronRuns').doc(runDate).get();
  return snapshot.exists ? (snapshot.data() as Record<string, any>) : null; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function subscription(uid: string, id: string) {
  return (await adminDb().collection('users').doc(uid).collection('subscriptions').doc(id).get()).data() as SubscriptionDoc;
}

// 送った通知イベントを記録し、results を順に返す偽の PushSender（送信も保存もしない）
function fakeSender(results: PushResult['status'][] = []) {
  const calls: { uid: string; event: NotificationEvent }[] = [];
  const sender: PushSender = async (uid, event) => {
    calls.push({ uid, event });
    return { status: results[calls.length - 1] ?? 'skipped', deliveredIds: event.webPushDeliveredIds, lastErrorCode: null };
  };
  return { sender, calls };
}

// 請求日が runDate の翌日になる毎月のサブスク（No.20 の Spotify と同じ形）
const BILLING_TOMORROW: Partial<SubscriptionDoc> = { serviceName: 'Spotify', price: 980, firstBillingDate: '2026-09-05', nextBillingDate: '2026-11-05' };

beforeEach(async () => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  await resetEmulators();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('GET /api/cron/daily（通知の作成）', () => {
  it('No.20 基準日 2026-11-04 のテストデータ5件で、Spotify の請求1日前と Adobe Creative Cloud の請求7日前の2件が作られる', async () => {
    await seedUser('u1');
    const subs = await seedSubscriptions('u1', TEST_DATA_SUBSCRIPTIONS);
    const res = await callCron('?runDate=2026-11-04');
    expect(res.status).toBe(200);
    expect(res.body?.data).toEqual({ status: 'completed', createdCount: 2, sentCount: 0, failedCount: 0 });
    expect(res.body?.error).toBeNull();

    const list = await events('u1');
    expect(list).toHaveLength(2);
    const spotify = list.find((e) => e.serviceNameAtNotification === 'Spotify');
    const adobe = list.find((e) => e.serviceNameAtNotification === 'Adobe Creative Cloud');
    const spotifyId = subs[1].subscriptionId;
    expect(spotify).toMatchObject({
      id: notificationId('u1', spotifyId, 'billing', 1, '2026-11-04'),
      notificationId: notificationId('u1', spotifyId, 'billing', 1, '2026-11-04'),
      uid: 'u1',
      subscriptionId: spotifyId,
      notificationType: 'billing',
      daysBefore: 1,
      targetDate: '2026-11-04',
      title: '請求日まであと1日',
      body: '11/05・¥980 の請求予定',
      priceAtNotification: 980,
      viewedAt: null,
      webPushDeliveredIds: [],
    });
    expect(adobe).toMatchObject({
      subscriptionId: subs[2].subscriptionId,
      notificationType: 'billing',
      daysBefore: 7,
      targetDate: '2026-11-04',
      title: '請求日まであと7日',
      body: '11/11・¥6,480 の請求予定',
      priceAtNotification: 6480,
    });
    // createdAt はミリ秒精度、updatedAt は createdAt と同じ、expireAt は createdAt の90日後
    for (const e of list) {
      expect(e.updatedAt.toMillis()).toBe(e.createdAt.toMillis());
      expect(e.expireAt.toMillis() - e.createdAt.toMillis()).toBe(90 * DAY_MS);
    }

    const run = await cronRun('2026-11-04');
    expect(run).toMatchObject({ runDate: '2026-11-04', status: 'completed', createdCount: 2, sentCount: 0, failedCount: 0, errorCode: null });
    expect(run?.finishedAt).toBeInstanceOf(Timestamp);
    expect(run?.expireAt.toMillis() - run?.startedAt.toMillis()).toBe(90 * DAY_MS);
  });

  it('No.20 あわせて：同じデータで 11/04 を実行していない状態から ?runDate=2026-11-05 で実行すると、通知は1件も作られない', async () => {
    await seedUser('u1');
    await seedSubscriptions('u1', TEST_DATA_SUBSCRIPTIONS);
    const res = await callCron('?runDate=2026-11-05');
    expect(res.status).toBe(200);
    expect(res.body?.data).toEqual({ status: 'completed', createdCount: 0, sentCount: 0, failedCount: 0 });
    expect(await events('u1')).toHaveLength(0);
  });

  it('No.21 同じ日に2回実行すると、2回目は 200 noop で通知は増えない', async () => {
    await seedUser('u1');
    await seedSubscriptions('u1', TEST_DATA_SUBSCRIPTIONS);
    expect((await callCron('?runDate=2026-11-04')).body?.data.createdCount).toBe(2);
    const second = await callCron('?runDate=2026-11-04');
    expect(second.status).toBe(200);
    expect(second.body?.data).toEqual({ status: 'noop', createdCount: 0, sentCount: 0, failedCount: 0 });
    expect(await events('u1')).toHaveLength(2);
    expect(await cronRun('2026-11-04')).toMatchObject({ status: 'completed', createdCount: 2 });
  });

  it('cronRuns を消して（--reset）同じ日にもう一度実行しても、すでにある通知は作り直さない（createdCount は 0）', async () => {
    await seedUser('u1');
    await seedSubscriptions('u1', TEST_DATA_SUBSCRIPTIONS);
    await callCron('?runDate=2026-11-04');
    await adminDb().collection('cronRuns').doc('2026-11-04').delete();
    const res = await callCron('?runDate=2026-11-04');
    expect(res.body?.data).toEqual({ status: 'completed', createdCount: 0, sentCount: 0, failedCount: 0 });
    expect(await events('u1')).toHaveLength(2);
  });

  it('No.22 accountNotificationEnabled=false の利用者には通知が作られない', async () => {
    await seedUser('u1', { accountNotificationEnabled: false });
    await seedSubscriptions('u1', TEST_DATA_SUBSCRIPTIONS);
    const res = await callCron('?runDate=2026-11-04');
    expect(res.body?.data).toEqual({ status: 'completed', createdCount: 0, sentCount: 0, failedCount: 0 });
    expect(await events('u1')).toHaveLength(0);
  });

  it('No.23 price=0 のサブスクは、請求7日前の Cron で billing 通知が作られない', async () => {
    await seedUser('u1');
    await seedSubscriptions('u1', [{ serviceName: '無料プラン', price: 0, firstBillingDate: '2026-10-11', nextBillingDate: '2026-11-11' }]);
    const res = await callCron('?runDate=2026-11-04');
    expect(res.body?.data.createdCount).toBe(0);
    expect(await events('u1')).toHaveLength(0);
  });

  it('No.46 trialEnabled=true・最終無料日 11/10・請求日 11/16・料金980円で 11/09 の Cron：trial_end（1日前）だけが作られる', async () => {
    await seedUser('u1');
    await seedSubscriptions('u1', [{ serviceName: 'お試し', price: 980, firstBillingDate: '2026-11-16', trialEnabled: true, trialEndDate: '2026-11-10' }]);
    const res = await callCron('?runDate=2026-11-09');
    expect(res.body?.data.createdCount).toBe(1);
    const list = await events('u1');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      notificationType: 'trial_end',
      daysBefore: 1,
      targetDate: '2026-11-09',
      title: '無料トライアル終了まであと1日',
      body: '最終無料日は11/10です',
      priceAtNotification: null,
    });
  });

  it('No.67 最終無料日 2026-11-11・請求日 2026-11-20・980円：11/04 は trial_end（7日前）が1件だけ、11/10 は trial_end（1日前）、11/11（当日）は何も作られない', async () => {
    await seedUser('u1');
    await seedSubscriptions('u1', [
      { serviceName: 'お試し', price: 980, billingCycle: 'monthly', billingDayMode: 'fixedDay', firstBillingDate: '2026-11-20', trialEnabled: true, trialEndDate: '2026-11-11' },
    ]);
    const first = await callCron('?runDate=2026-11-04');
    expect(first.body?.data.createdCount).toBe(1);
    let list = await events('u1');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      notificationType: 'trial_end',
      daysBefore: 7,
      targetDate: '2026-11-04',
      priceAtNotification: null,
      title: '無料トライアル終了まであと7日',
      body: '最終無料日は11/11です',
    });
    expect(list.filter((e) => e.notificationType === 'billing')).toHaveLength(0);

    expect((await callCron('?runDate=2026-11-10')).body?.data.createdCount).toBe(1);
    list = await events('u1');
    expect(list.find((e) => e.targetDate === '2026-11-10')).toMatchObject({ notificationType: 'trial_end', daysBefore: 1, body: '最終無料日は11/11です' });

    expect((await callCron('?runDate=2026-11-11')).body?.data.createdCount).toBe(0);
    expect(await events('u1')).toHaveLength(2);
  });

  it('No.68 Spotify だけ subscriptionNotificationEnabled=false：Spotify の通知は作られず、Adobe Creative Cloud の請求7日前の1件だけ', async () => {
    await seedUser('u1');
    await seedSubscriptions(
      'u1',
      TEST_DATA_SUBSCRIPTIONS.map((s) => (s.serviceName === 'Spotify' ? { ...s, subscriptionNotificationEnabled: false } : s)),
    );
    const res = await callCron('?runDate=2026-11-04');
    expect(res.body?.data.createdCount).toBe(1);
    const list = await events('u1');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ serviceNameAtNotification: 'Adobe Creative Cloud', daysBefore: 7, notificationType: 'billing' });
  });

  it('users が無い uid のサブスクには通知を作らない（ほかの人の分は作る）', async () => {
    await seedUser('u1');
    await seedSubscriptions('u1', [BILLING_TOMORROW]);
    await seedSubscriptions('ghost', [BILLING_TOMORROW]); // users/ghost は無い
    const res = await callCron('?runDate=2026-11-04');
    expect(res.body?.data.createdCount).toBe(1);
    expect(await events('u1')).toHaveLength(1);
    expect(await events('ghost')).toHaveLength(0);
  });

  it('通知を作る直前に users/{uid} が消えたら作らない（作成は users を読む transaction の中）', async () => {
    await seedUser('u1');
    await seedSubscriptions('u1', [BILLING_TOMORROW]);
    const result = await runDailyCron({
      runDate: '2026-11-04',
      pushSender: fakeSender().sender,
      hooks: {
        beforeCreateEvent: async (uid) => {
          await adminDb().collection('users').doc(uid).delete();
        },
      },
    });
    expect(result).toEqual({ status: 'completed', createdCount: 0, sentCount: 0, failedCount: 0 });
    expect(await events('u1')).toHaveLength(0);
  });
});

describe('GET /api/cron/daily（認証・runDate・二重起動）', () => {
  it('No.31 CRON_SECRET が無い・違う呼び出しは 401 INVALID_CRON_SECRET（何も書かない）', async () => {
    const none = await callCron('?runDate=2026-11-04', {});
    expect(none.status).toBe(401);
    expect(none.body?.error).toMatchObject({ code: 'INVALID_CRON_SECRET', message: '認証に失敗しました' });
    const wrong = await callCron('?runDate=2026-11-04', { Authorization: 'Bearer wrong-secret' });
    expect(wrong.status).toBe(401);
    const noBearer = await callCron('?runDate=2026-11-04', { Authorization: process.env.CRON_SECRET ?? '' });
    expect(noBearer.status).toBe(401);
    expect(await cronRun('2026-11-04')).toBeNull();
  });

  it('No.31 CRON_SECRET が未設定なら、どんなヘッダーでも 401', async () => {
    delete process.env.CRON_SECRET;
    expect((await callCron('?runDate=2026-11-04', { Authorization: 'Bearer ' })).status).toBe(401);
    expect((await callCron('?runDate=2026-11-04', { Authorization: 'Bearer undefined' })).status).toBe(401);
  });

  it('認証が先：CRON_SECRET が違えば、runDate が不正でも 401', async () => {
    const res = await callCron('?runDate=2026-13-01', {});
    expect(res.status).toBe(401);
  });

  it('No.42 running で開始から10分未満の別の Cron は 409 CRON_ALREADY_RUNNING。10分以上たった running は再開する', async () => {
    const now = Date.now();
    const running = {
      runDate: '2026-11-04',
      status: 'running',
      startedAt: Timestamp.fromMillis(now - 5 * 60 * 1000),
      finishedAt: null,
      createdCount: 0,
      sentCount: 0,
      failedCount: 0,
      errorCode: null,
      expireAt: Timestamp.fromMillis(now + 90 * DAY_MS),
      updatedAt: Timestamp.fromMillis(now - 5 * 60 * 1000),
    };
    await adminDb().collection('cronRuns').doc('2026-11-04').set(running);
    const res = await callCron('?runDate=2026-11-04');
    expect(res.status).toBe(409);
    expect(res.body?.error).toMatchObject({ code: 'CRON_ALREADY_RUNNING', message: 'すでに実行中です' });
    expect(await cronRun('2026-11-04')).toMatchObject({ status: 'running' });

    await adminDb()
      .collection('cronRuns')
      .doc('2026-11-04')
      .set({ ...running, startedAt: Timestamp.fromMillis(now - 11 * 60 * 1000) });
    const restarted = await callCron('?runDate=2026-11-04');
    expect(restarted.status).toBe(200);
    expect(restarted.body?.data.status).toBe('completed');
    const run = await cronRun('2026-11-04');
    expect(run?.status).toBe('completed');
    expect(run?.startedAt.toMillis()).toBeGreaterThanOrEqual(now); // 再開始のたびに今の時刻
  });

  it('No.44 ALLOW_CRON_RUNDATE_OVERRIDE=true なら ?runDate=2026-11-04 の日として実行される（false のときは無視して今日）', async () => {
    process.env.ALLOW_CRON_RUNDATE_OVERRIDE = 'true';
    expect((await callCron('?runDate=2026-11-04')).status).toBe(200);
    expect(await cronRun('2026-11-04')).toMatchObject({ runDate: '2026-11-04', status: 'completed' });

    await resetEmulators();
    const today = todayJST();
    for (const value of ['false', 'TRUE', '1']) {
      process.env.ALLOW_CRON_RUNDATE_OVERRIDE = value;
      await adminDb().collection('cronRuns').doc(today).delete();
      const res = await callCron('?runDate=2026-11-04');
      expect(res.status).toBe(200);
      expect(await cronRun('2026-11-04')).toBeNull();
      expect(await cronRun(today)).toMatchObject({ runDate: today, status: 'completed' });
    }
    // 不正な runDate も、無視されるときは 400 にしない
    process.env.ALLOW_CRON_RUNDATE_OVERRIDE = 'false';
    expect((await callCron('?runDate=2026-13-01')).status).toBe(200);
  });

  it('No.44 あわせて：不正な runDate（空・形が違う・実在しない・範囲外）は 400 INVALID_DATE（field=runDate）。runDate 以外のクエリ（slot）は無視する', async () => {
    process.env.ALLOW_CRON_RUNDATE_OVERRIDE = 'true';
    for (const value of ['', '2026-13-01', '2026-02-30', '20261104', 'abc', '1999-12-31', '2101-01-01']) {
      const res = await callCron(`?runDate=${value}`);
      expect(res.status).toBe(400);
      expect(res.body?.error).toMatchObject({ code: 'INVALID_DATE', field: 'runDate', message: '正しい日付を選んでください' });
    }
    expect(await cronRun('2026-11-04')).toBeNull();
    const slot = await callCron('?slot=2&runDate=2026-11-04');
    expect(slot.status).toBe(200);
    expect(await cronRun('2026-11-04')).toMatchObject({ status: 'completed' });
  });
});

describe('refresh_stale（古い nextBillingDate の更新）', () => {
  it('No.45 nextBillingDate が今日より前のサブスクは、更新されて次回請求日が正しくなる（その日の通知も作られる）', async () => {
    await seedUser('u1');
    const [stale, yearly] = await seedSubscriptions('u1', [
      { ...BILLING_TOMORROW, nextBillingDate: '2026-10-05' },
      { serviceName: '年額', price: 5000, billingCycle: 'yearly', firstBillingDate: '2024-03-15', nextBillingDate: '2025-03-15' },
    ]);
    const res = await callCron('?runDate=2026-11-04');
    expect(res.body?.data).toEqual({ status: 'completed', createdCount: 1, sentCount: 0, failedCount: 0 });
    expect((await subscription('u1', stale.subscriptionId)).nextBillingDate).toBe('2026-11-05');
    expect((await subscription('u1', yearly.subscriptionId)).nextBillingDate).toBe('2027-03-15');
    expect((await events('u1'))[0]).toMatchObject({ subscriptionId: stale.subscriptionId, daysBefore: 1 });
  });

  it('No.45 壊れたデータは更新せず failedCount に数え、無限に繰り返さない（completed で終わる）', async () => {
    await seedUser('u1');
    const [broken, ok] = await seedSubscriptions('u1', [
      { serviceName: '壊れた', firstBillingDate: 'broken', nextBillingDate: '2026-01-01' },
      { ...BILLING_TOMORROW, nextBillingDate: '2026-10-05' },
    ]);
    const res = await callCron('?runDate=2026-11-04');
    expect(res.status).toBe(200);
    expect(res.body?.data).toEqual({ status: 'completed', createdCount: 1, sentCount: 0, failedCount: 1 });
    expect((await subscription('u1', broken.subscriptionId)).nextBillingDate).toBe('2026-01-01');
    expect((await subscription('u1', ok.subscriptionId)).nextBillingDate).toBe('2026-11-05');
    expect(await cronRun('2026-11-04')).toMatchObject({ status: 'completed', failedCount: 1 });
  });

  it('refresh_stale の打ち切り：決まった回数で終わらなければ partial。次の実行で続きから更新する', async () => {
    await seedUser('u1');
    const subs = await seedSubscriptions(
      'u1',
      Array.from({ length: 5 }, (_, i) => ({ serviceName: `古い${i}`, firstBillingDate: '2026-01-20', nextBillingDate: `2026-0${i + 1}-20` })),
    );
    const limits = { refreshBatchSize: 2, refreshMaxRounds: 2 };
    const first = await runDailyCron({ runDate: '2026-11-04', pushSender: fakeSender().sender, limits });
    expect(first.status).toBe('partial');
    const after = await Promise.all(subs.map((s) => subscription('u1', s.subscriptionId)));
    expect(after.filter((s) => s.nextBillingDate === '2026-11-20')).toHaveLength(4);
    expect(await cronRun('2026-11-04')).toMatchObject({ status: 'partial' });

    const second = await runDailyCron({ runDate: '2026-11-04', pushSender: fakeSender().sender, limits });
    expect(second.status).toBe('completed');
    const done = await Promise.all(subs.map((s) => subscription('u1', s.subscriptionId)));
    expect(done.every((s) => s.nextBillingDate === '2026-11-20')).toBe(true);
  });

  it('refresh_stale の打ち切り：先頭から取得した分がすべて更新できないときは、更新をやめて次の段階へ進み completed（後ろのデータは残る）', async () => {
    await seedUser('u1');
    const [, , behind] = await seedSubscriptions('u1', [
      { serviceName: '壊れた1', firstBillingDate: 'broken', nextBillingDate: '2026-01-01' },
      { serviceName: '壊れた2', billingCycle: 'weekly' as never, nextBillingDate: '2026-01-02' },
      { ...BILLING_TOMORROW, nextBillingDate: '2026-10-05' },
    ]);
    const result = await runDailyCron({ runDate: '2026-11-04', pushSender: fakeSender().sender, limits: { refreshBatchSize: 2 } });
    expect(result).toEqual({ status: 'completed', createdCount: 0, sentCount: 0, failedCount: 2 });
    expect((await subscription('u1', behind.subscriptionId)).nextBillingDate).toBe('2026-10-05');
  });
});

describe('push（偽の PushSender で、Cron の分担を確かめる）', () => {
  it('No.33 Push を使えない利用者（購読なし＝skipped）でも、アプリ内通知は作られる（S-08 に出る未読の通知）', async () => {
    await seedUser('u1');
    await seedSubscriptions('u1', [BILLING_TOMORROW]);
    const fake = fakeSender(['skipped']);
    const result = await runDailyCron({ runDate: '2026-11-04', pushSender: fake.sender });
    expect(result).toEqual({ status: 'completed', createdCount: 1, sentCount: 0, failedCount: 0 });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].uid).toBe('u1');
    expect(fake.calls[0].event).toMatchObject({ uid: 'u1', targetDate: '2026-11-04', webPushStatus: 'pending', webPushDeliveredIds: [], title: '請求日まであと1日' });
    const list = await events('u1');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ viewedAt: null, title: '請求日まであと1日', body: '11/05・¥980 の請求予定' });
    expect(Date.now() - list[0].createdAt.toMillis()).toBeLessThan(90 * DAY_MS); // 直近90日の通知（一覧に出る範囲）
  });

  it('sentCount は sent・partially_sent の数、failedCount は failed の数（skipped は数えない）。Push の結果の保存は Cron では行わない', async () => {
    await seedUser('u1');
    await seedSubscriptions(
      'u1',
      Array.from({ length: 4 }, (_, i) => ({ ...BILLING_TOMORROW, serviceName: `サービス${i}` })),
    );
    const fake = fakeSender(['sent', 'partially_sent', 'failed', 'skipped']);
    const result = await runDailyCron({ runDate: '2026-11-04', pushSender: fake.sender });
    expect(result).toEqual({ status: 'completed', createdCount: 4, sentCount: 2, failedCount: 1 });
    expect(fake.calls).toHaveLength(4);
    expect(await cronRun('2026-11-04')).toMatchObject({ status: 'completed', createdCount: 4, sentCount: 2, failedCount: 1 });
    // webPushStatus などは PushSender（04-15）が保存する。Cron は書かない
    expect((await events('u1')).every((e) => e.webPushStatus === 'pending' && e.webPushSentAt === null)).toBe(true);
  });

  it('PushSender が例外を投げたら、その実行は failed（errorCode を記録し 500）。同じ日の次の実行で続きから送る', async () => {
    await seedUser('u1');
    await seedSubscriptions('u1', [BILLING_TOMORROW]);
    const throwing: PushSender = async () => {
      throw new Error('push failed');
    };
    const error = await runDailyCron({ runDate: '2026-11-04', pushSender: throwing }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    const failed = await cronRun('2026-11-04');
    expect(failed).toMatchObject({ status: 'failed', errorCode: 'INTERNAL_ERROR', createdCount: 1 });
    expect(failed?.finishedAt).toBeInstanceOf(Timestamp);

    const fake = fakeSender(['sent']);
    const result = await runDailyCron({ runDate: '2026-11-04', pushSender: fake.sender });
    expect(result).toEqual({ status: 'completed', createdCount: 1, sentCount: 1, failedCount: 0 });
    expect(fake.calls).toHaveLength(1);
    expect(await cronRun('2026-11-04')).toMatchObject({ status: 'completed', errorCode: null });
  });

  it('判定を通らなかったサブスクの pending は送らない（前の実行の後に通知をオフにした）', async () => {
    await seedUser('u1');
    const [sub] = await seedSubscriptions('u1', [BILLING_TOMORROW]);
    await runDailyCron({
      runDate: '2026-11-04',
      pushSender: async () => {
        throw new Error('push failed');
      },
    }).catch(() => undefined);
    expect(await events('u1')).toHaveLength(1);
    await adminDb().collection('users').doc('u1').collection('subscriptions').doc(sub.subscriptionId).update({ subscriptionNotificationEnabled: false });
    const fake = fakeSender(['sent']);
    const result = await runDailyCron({ runDate: '2026-11-04', pushSender: fake.sender });
    expect(result.status).toBe('completed');
    expect(fake.calls).toHaveLength(0);
  });

  it('No.43 Push の途中で締切（partial）→ 同じ日に再実行すると続きから処理され、送信済みの通知イベントへは送らない', async () => {
    await seedUser('u1');
    await seedUser('u2');
    await seedSubscriptions('u1', [BILLING_TOMORROW]);
    await seedSubscriptions('u2', [BILLING_TOMORROW]);

    // 偽の PushSender：04-15 の代わりに結果（sent と送り終えた端末）を保存し、1件目を送った後に時計を締切の後へ進める
    let offset = 0;
    const now = () => new Date(Date.now() + offset);
    const sentIds: string[][] = [[], []];
    let runIndex = 0;
    const sender: PushSender = async (uid, event) => {
      sentIds[runIndex].push(event.notificationId);
      await adminDb()
        .collection('users')
        .doc(uid)
        .collection('notificationEvents')
        .doc(event.notificationId)
        .update({ webPushStatus: 'sent', webPushDeliveredIds: ['device-1'], webPushSentAt: Timestamp.now() });
      offset = 241_000; // 締切（240秒）を過ぎる
      return { status: 'sent', deliveredIds: ['device-1'], lastErrorCode: null };
    };

    const first = await runDailyCron({ runDate: '2026-11-04', pushSender: sender, now });
    expect(first).toEqual({ status: 'partial', createdCount: 2, sentCount: 1, failedCount: 0 });
    expect(sentIds[0]).toHaveLength(1);
    expect(await cronRun('2026-11-04')).toMatchObject({ status: 'partial', createdCount: 2, sentCount: 1 });

    offset = 0;
    runIndex = 1;
    const second = await runDailyCron({ runDate: '2026-11-04', pushSender: sender, now });
    // 件数は同じ日の再実行で加算する（作成済みの通知は数えない）
    expect(second).toEqual({ status: 'completed', createdCount: 2, sentCount: 2, failedCount: 0 });
    expect(sentIds[1]).toHaveLength(1);
    expect(sentIds[1][0]).not.toBe(sentIds[0][0]); // 送信済みの通知イベントには送らない
    const all = [...(await events('u1')), ...(await events('u2'))];
    expect(all).toHaveLength(2);
    expect(all.map((e) => e.id).sort()).toEqual([...sentIds[0], ...sentIds[1]].sort());
  });

  it('始める時点で締切を過ぎていたら、何もせず partial で終わる（次の実行で続きから作る）', async () => {
    await seedUser('u1');
    await seedSubscriptions('u1', [BILLING_TOMORROW]);
    const partial = await runDailyCron({ runDate: '2026-11-04', pushSender: fakeSender().sender, deadlineAt: 0 });
    expect(partial).toEqual({ status: 'partial', createdCount: 0, sentCount: 0, failedCount: 0 });
    expect(await events('u1')).toHaveLength(0);
    const next = await runDailyCron({ runDate: '2026-11-04', pushSender: fakeSender().sender });
    expect(next).toMatchObject({ status: 'completed', createdCount: 1 });
  });
});

describe('cleanup（期限切れの削除）', () => {
  async function seedExpired() {
    const old = Timestamp.fromMillis(Date.now() - 91 * DAY_MS);
    const expiredAt = Timestamp.fromMillis(Date.now() - DAY_MS);
    await seedUser('u1');
    await seedNotificationEvents(
      'u1',
      Array.from({ length: 5 }, (_, i) => ({ targetDate: `2026-08-0${i + 1}`, createdAt: old, expireAt: expiredAt })),
    );
    await seedNotificationEvents('u1', [{ targetDate: '2026-11-01' }]); // 期限は未来
    await seedNotificationEvents('u2', [{ targetDate: '2026-08-10', createdAt: old, expireAt: expiredAt }]); // ほかの人（users なし）でも消す
    const run = (runDate: string, expireAt: Timestamp) => ({
      runDate,
      status: 'completed',
      startedAt: old,
      finishedAt: old,
      createdCount: 0,
      sentCount: 0,
      failedCount: 0,
      errorCode: null,
      expireAt,
      updatedAt: old,
    });
    for (const [date, expireAt] of [
      ['2026-08-01', expiredAt],
      ['2026-08-02', expiredAt],
      ['2026-08-03', expiredAt],
      ['2026-11-01', Timestamp.fromMillis(Date.now() + DAY_MS)],
    ] as const) {
      await adminDb().collection('cronRuns').doc(date).set(run(date, expireAt));
    }
  }

  it('No.56 期限（expireAt）が過ぎた通知イベントと cronRuns は削除され、期限が未来のものは残る（500件ずつの繰り返しは、上限を小さくして確かめる）', async () => {
    await seedExpired();
    const result = await runDailyCron({ runDate: '2026-11-04', pushSender: fakeSender().sender, limits: { cleanupBatchSize: 2 } });
    expect(result.status).toBe('completed');
    const left = await events('u1');
    expect(left.map((e) => e.targetDate)).toEqual(['2026-11-01']);
    expect(await events('u2')).toHaveLength(0);
    const runs = (await adminDb().collection('cronRuns').get()).docs.map((d) => d.id).sort();
    expect(runs).toEqual(['2026-11-01', '2026-11-04']);
  });

  it('No.56 既定（500件・最大10回）でも、期限切れだけを削除する', async () => {
    await seedExpired();
    const res = await callCron('?runDate=2026-11-04');
    expect(res.body?.data.status).toBe('completed');
    expect(await events('u1')).toHaveLength(1);
    expect((await adminDb().collection('cronRuns').get()).size).toBe(2);
  });

  it('No.56 partial のときは削除しない', async () => {
    await seedExpired();
    const result = await runDailyCron({ runDate: '2026-11-04', pushSender: fakeSender().sender, deadlineAt: 0 });
    expect(result.status).toBe('partial');
    expect(await events('u1')).toHaveLength(6);
    expect((await adminDb().collection('cronRuns').get()).size).toBe(5);
  });

  it('cleanup を始める時点で締切を過ぎていたら削除しない（status は completed のまま）', async () => {
    await seedExpired();
    // 通知を作る段階まで（push の後）は締切の前、cleanup の時点では締切の後になるように、時計を進める
    let calls = 0;
    const base = Date.now();
    const now = () => new Date(base + (calls++ >= 4 ? 300_000 : 0));
    const result = await runDailyCron({ runDate: '2026-11-04', pushSender: fakeSender().sender, now });
    expect(result.status).toBe('completed');
    expect(await events('u1')).toHaveLength(6);
  });
});
