// F-03 の API（04-07）。期待値は機能設計書「テスト一覧」と「API共通仕様」のとおり
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { GET as getOne, PATCH, DELETE } from '@/app/api/subscriptions/[id]/route';
import { GET as getList, POST } from '@/app/api/subscriptions/route';
import { nextBillingDate } from '@/lib/billing';
import { todayJST } from '@/lib/clock';
import { adminDb } from '@/lib/firebase-admin';
import { TEST_DATA_SUBSCRIPTIONS, callRoute, resetEmulators, seedSubscriptions, seedUser, signUpUser } from './helpers';

const BASE = { serviceName: 'Netflix', price: 1590, billingCycle: 'monthly', firstBillingDate: '2026-10-08', billingDayMode: 'fixedDay', category: 'video' };

async function newUser(fields: Record<string, unknown> = {}) {
  const user = await signUpUser();
  await seedUser(user.uid, { email: user.email, ...fields });
  return user;
}

async function userDoc(uid: string) {
  return (await adminDb().collection('users').doc(uid).get()).data() ?? {};
}

async function subscriptionCount(uid: string) {
  return (await adminDb().collection('users').doc(uid).collection('subscriptions').count().get()).data().count;
}

beforeEach(async () => {
  await resetEmulators();
});

afterEach(() => {
  delete process.env.SUBSCRIPTION_LIMIT_OVERRIDE;
});

describe('POST /api/subscriptions（保存）', () => {
  it('201 で保存し、nextBillingDate はサーバーが計算する。subscriptionCount は実際の件数+1', async () => {
    const user = await newUser();
    const res = await callRoute(POST, { method: 'POST', token: user.token, body: BASE });
    expect(res.status).toBe(201);
    const sub = res.body?.data.subscription;
    expect(sub).toMatchObject({ serviceName: 'Netflix', price: 1590, planName: null, trialEnabled: false, trialEndDate: null, subscriptionNotificationEnabled: true });
    expect(sub.nextBillingDate).toBe(nextBillingDate('2026-10-08', 'monthly', 'fixedDay', todayJST()));
    expect(sub.subscriptionId).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(sub).not.toHaveProperty('uid');
    expect((await userDoc(user.uid)).subscriptionCount).toBe(1);
  });

  it('No.10 199件登録済みで2件を同時に追加すると、201 が1件、もう1件は 409 SUBSCRIPTION_LIMIT_REACHED（200件を超えない）', async () => {
    const user = await newUser();
    await seedSubscriptions(
      user.uid,
      Array.from({ length: 199 }, (_, i) => ({ serviceName: `サービス${i}` })),
    );
    const results = await Promise.all([
      callRoute(POST, { method: 'POST', token: user.token, body: { ...BASE, serviceName: '追加A' } }),
      callRoute(POST, { method: 'POST', token: user.token, body: { ...BASE, serviceName: '追加B' } }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body?.error).toMatchObject({ code: 'SUBSCRIPTION_LIMIT_REACHED', message: '登録できるサブスクは200件までです' });
    expect(await subscriptionCount(user.uid)).toBe(200);
  });

  it('No.10 200件登録済みのときは、2件とも 409 SUBSCRIPTION_LIMIT_REACHED', async () => {
    const user = await newUser();
    await seedSubscriptions(
      user.uid,
      Array.from({ length: 200 }, (_, i) => ({ serviceName: `サービス${i}` })),
    );
    const results = await Promise.all([
      callRoute(POST, { method: 'POST', token: user.token, body: { ...BASE, serviceName: '追加A' } }),
      callRoute(POST, { method: 'POST', token: user.token, body: { ...BASE, serviceName: '追加B' } }),
    ]);
    expect(results.map((r) => r.status)).toEqual([409, 409]);
    expect(results.every((r) => r.body?.error.code === 'SUBSCRIPTION_LIMIT_REACHED')).toBe(true);
    expect(await subscriptionCount(user.uid)).toBe(200);
  });

  it('SUBSCRIPTION_LIMIT_OVERRIDE で上限を小さくして確かめられる（message は200件のまま）', async () => {
    process.env.SUBSCRIPTION_LIMIT_OVERRIDE = '2';
    const user = await newUser();
    await seedSubscriptions(user.uid, [{ serviceName: 'A' }, { serviceName: 'B' }]);
    const res = await callRoute(POST, { method: 'POST', token: user.token, body: BASE });
    expect(res.status).toBe(409);
    expect(res.body?.error).toMatchObject({ code: 'SUBSCRIPTION_LIMIT_REACHED', message: '登録できるサブスクは200件までです' });
  });

  it('No.11 「Netflix」が登録済みで「netflix」と「Netflix 」を登録すると 409 の警告。confirmDuplicate=true で登録できる', async () => {
    const user = await newUser();
    const [netflix] = await seedSubscriptions(user.uid, [{ serviceName: 'Netflix' }]);
    for (const name of ['netflix', 'Netflix ']) {
      const res = await callRoute(POST, { method: 'POST', token: user.token, body: { ...BASE, serviceName: name } });
      expect(res.status).toBe(409);
      expect(res.body?.error).toMatchObject({
        code: 'DUPLICATE_CANDIDATE',
        message: `『${name.trim()}』はすでに登録されています。別の契約として登録しますか？`,
        candidates: [{ subscriptionId: netflix.subscriptionId, serviceName: 'Netflix' }],
      });
    }
    expect(await subscriptionCount(user.uid)).toBe(1);
    const ok = await callRoute(POST, { method: 'POST', token: user.token, body: { ...BASE, serviceName: 'Netflix ', confirmDuplicate: true } });
    expect(ok.status).toBe(201);
    expect(ok.body?.data.subscription.serviceName).toBe('Netflix');
    expect(await subscriptionCount(user.uid)).toBe(2);
  });

  it('同じ POST が同時に2件届くと、201 が1件、もう1件は同名の 409', async () => {
    const user = await newUser();
    const results = await Promise.all([
      callRoute(POST, { method: 'POST', token: user.token, body: BASE }),
      callRoute(POST, { method: 'POST', token: user.token, body: BASE }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body?.error.code).toBe('DUPLICATE_CANDIDATE');
    expect(await subscriptionCount(user.uid)).toBe(1);
  });

  it('No.15 paymentMethod にカード番号様の数字（13桁以上）を入れると 400 CARD_LIKE_VALUE', async () => {
    const user = await newUser();
    const res = await callRoute(POST, { method: 'POST', token: user.token, body: { ...BASE, paymentMethod: '4111 1111 1111 1111' } });
    expect(res.status).toBe(400);
    expect(res.body?.error).toMatchObject({ code: 'CARD_LIKE_VALUE', field: 'paymentMethod', message: 'カード番号は入力できません' });
    expect(await subscriptionCount(user.uid)).toBe(0);
  });

  it('No.24 最終無料日が請求日以後なら 400（最終無料日は請求日より前）', async () => {
    const user = await newUser();
    const res = await callRoute(POST, {
      method: 'POST',
      token: user.token,
      body: { ...BASE, firstBillingDate: '2026-11-30', trialEnabled: true, trialEndDate: '2026-11-30' },
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toMatchObject({ code: 'VALIDATION_ERROR', field: 'trialEndDate', message: '最終無料日は請求日より前の日付を入力してください' });
  });

  it('No.26 category を省略すると 400 VALIDATION_ERROR（details に category）', async () => {
    const user = await newUser();
    const { category: _omit, ...withoutCategory } = BASE;
    void _omit;
    const res = await callRoute(POST, { method: 'POST', token: user.token, body: withoutCategory });
    expect(res.status).toBe(400);
    expect(res.body?.error.code).toBe('VALIDATION_ERROR');
    expect(res.body?.error.details).toContainEqual({ field: 'category', code: 'VALIDATION_ERROR', message: 'カテゴリーを選んでください' });
  });

  it('No.27 nextBillingDate を送ると 400 UNKNOWN_FIELD（POST）', async () => {
    const user = await newUser();
    const res = await callRoute(POST, { method: 'POST', token: user.token, body: { ...BASE, nextBillingDate: '2026-11-08' } });
    expect(res.status).toBe(400);
    expect(res.body?.error).toMatchObject({ code: 'UNKNOWN_FIELD', field: 'nextBillingDate' });
  });

  it('No.28 複数の項目が誤りなら、details にすべての誤りが入り、field は最初の項目', async () => {
    const user = await newUser();
    const res = await callRoute(POST, {
      method: 'POST',
      token: user.token,
      body: { serviceName: '', price: -1, billingCycle: 'weekly', firstBillingDate: '2026-02-30', billingDayMode: 'fixedDay', category: 'video', memo: '4111111111111' },
    });
    expect(res.status).toBe(400);
    expect(res.body?.error.field).toBe('serviceName');
    expect(res.body?.error.code).toBe('VALIDATION_ERROR');
    expect(res.body?.error.details.map((d: { field: string }) => d.field)).toEqual(['serviceName', 'price', 'billingCycle', 'firstBillingDate', 'memo']);
    expect(res.body?.error.details.find((d: { field: string }) => d.field === 'firstBillingDate').code).toBe('INVALID_DATE');
  });

  it('No.29 users/{uid} が無いと 409 ACCOUNT_NOT_INITIALIZED', async () => {
    const user = await signUpUser();
    const res = await callRoute(POST, { method: 'POST', token: user.token, body: BASE });
    expect(res.status).toBe(409);
    expect(res.body?.error.code).toBe('ACCOUNT_NOT_INITIALIZED');
  });

  it('No.30 subscriptionCount が実際の件数とずれていても、実際の件数で上限を判定し、count を実際の件数+1 にする。409 のときは書き換えない', async () => {
    process.env.SUBSCRIPTION_LIMIT_OVERRIDE = '3';
    const user = await newUser({ subscriptionCount: 50 });
    await seedSubscriptions(user.uid, [{ serviceName: 'A' }, { serviceName: 'B' }]);
    const ok = await callRoute(POST, { method: 'POST', token: user.token, body: { ...BASE, serviceName: 'C' } });
    expect(ok.status).toBe(201);
    expect((await userDoc(user.uid)).subscriptionCount).toBe(3);

    await adminDb().collection('users').doc(user.uid).update({ subscriptionCount: 0 });
    const limit = await callRoute(POST, { method: 'POST', token: user.token, body: { ...BASE, serviceName: 'D' } });
    expect(limit.status).toBe(409);
    expect((await userDoc(user.uid)).subscriptionCount).toBe(0); // 409 のときは何も書かない
    const dup = await callRoute(POST, { method: 'POST', token: user.token, body: { ...BASE, serviceName: 'A' } });
    expect(dup.status).toBe(409);
    expect((await userDoc(user.uid)).subscriptionCount).toBe(0);
  });

  it('No.65 trialEnabled=true で最終無料日が空（null・省略）だと 400（field=trialEndDate、「最終無料日を入力してください」）で、何も保存しない', async () => {
    const user = await newUser();
    for (const extra of [{ trialEndDate: null }, {}, { trialEndDate: '' }]) {
      const res = await callRoute(POST, { method: 'POST', token: user.token, body: { ...BASE, trialEnabled: true, ...extra } });
      expect(res.status).toBe(400);
      expect(res.body?.error).toMatchObject({ code: 'VALIDATION_ERROR', field: 'trialEndDate', message: '最終無料日を入力してください' });
    }
    expect(await subscriptionCount(user.uid)).toBe(0);
  });

  it('No.66 trialEnabled=false で trialEndDate=2026-11-10 を送ると 201 で、保存された trialEndDate は null。形式が不正（2026-13-01）なら 400 INVALID_DATE', async () => {
    const user = await newUser();
    const res = await callRoute(POST, {
      method: 'POST',
      token: user.token,
      body: { ...BASE, firstBillingDate: '2026-11-30', trialEnabled: false, trialEndDate: '2026-11-10' },
    });
    expect(res.status).toBe(201);
    expect(res.body?.data.subscription.trialEndDate).toBeNull();
    const saved = (await adminDb().collection('users').doc(user.uid).collection('subscriptions').doc(res.body?.data.subscription.subscriptionId).get()).data();
    expect(saved?.trialEndDate).toBeNull();

    const bad = await callRoute(POST, { method: 'POST', token: user.token, body: { ...BASE, trialEnabled: false, trialEndDate: '2026-13-01' } });
    expect(bad.status).toBe(400);
    expect(bad.body?.error).toMatchObject({ code: 'INVALID_DATE', field: 'trialEndDate' });
  });
});

describe('GET /api/subscriptions（一覧）・GET /api/subscriptions/:id', () => {
  it('全件を作成日時の昇順で返す。totalCount は items の件数。nextBillingDate は計算し直した値', async () => {
    const user = await newUser();
    const seeded = await seedSubscriptions(user.uid, TEST_DATA_SUBSCRIPTIONS);
    const res = await callRoute(getList, { token: user.token });
    expect(res.status).toBe(200);
    const items = res.body?.data.items;
    expect(items.map((s: { serviceName: string }) => s.serviceName)).toEqual(['Netflix', 'Spotify', 'Adobe Creative Cloud', 'iCloud+', 'ChatGPT']);
    expect(res.body?.data.totalCount).toBe(5);
    const today = todayJST();
    seeded.forEach((doc, i) => {
      expect(items[i].nextBillingDate).toBe(nextBillingDate(doc.firstBillingDate, doc.billingCycle, doc.billingDayMode, today));
      expect(items[i]).not.toHaveProperty('uid');
    });
  });

  it('請求日が壊れているサブスクは、500 にせず保存値の nextBillingDate を返す', async () => {
    const user = await newUser();
    await seedSubscriptions(user.uid, [{ serviceName: '壊れた', firstBillingDate: 'broken', nextBillingDate: '2026-11-08' }]);
    const res = await callRoute(getList, { token: user.token });
    expect(res.status).toBe(200);
    expect(res.body?.data.items[0].nextBillingDate).toBe('2026-11-08');
  });

  it('1件を返す。形の違う ID・存在しない ID は 404「サブスクが見つかりません」', async () => {
    const user = await newUser();
    const [doc] = await seedSubscriptions(user.uid, [{ serviceName: 'Netflix' }]);
    const res = await callRoute(getOne, { token: user.token, params: { id: doc.subscriptionId } });
    expect(res.status).toBe(200);
    expect(res.body?.data.subscription.subscriptionId).toBe(doc.subscriptionId);
    for (const id of ['bad-id', 'aaaaaaaaaaaaaaaaaaaa']) {
      const missing = await callRoute(getOne, { token: user.token, params: { id } });
      expect(missing.status).toBe(404);
      expect(missing.body?.error).toMatchObject({ code: 'NOT_FOUND', message: 'サブスクが見つかりません' });
    }
  });
});

describe('PATCH /api/subscriptions/:id（更新）', () => {
  it('No.12 firstBillingDate を変えると nextBillingDate が再計算される', async () => {
    const user = await newUser();
    const [doc] = await seedSubscriptions(user.uid, [{ serviceName: 'Netflix', firstBillingDate: '2026-10-08', nextBillingDate: '2026-11-08' }]);
    const res = await callRoute(PATCH, { method: 'PATCH', token: user.token, params: { id: doc.subscriptionId }, body: { firstBillingDate: '2030-01-15' } });
    expect(res.status).toBe(200);
    expect(res.body?.data.subscription).toMatchObject({ firstBillingDate: '2030-01-15', nextBillingDate: '2030-01-15' });
    const saved = (await adminDb().collection('users').doc(user.uid).collection('subscriptions').doc(doc.subscriptionId).get()).data();
    expect(saved?.nextBillingDate).toBe('2030-01-15');
  });

  it('No.27 nextBillingDate を送ると 400 UNKNOWN_FIELD（PATCH）。confirmDuplicate も受け付けない', async () => {
    const user = await newUser();
    const [doc] = await seedSubscriptions(user.uid, [{ serviceName: 'Netflix' }]);
    for (const body of [{ nextBillingDate: '2026-12-08' }, { confirmDuplicate: true }]) {
      const res = await callRoute(PATCH, { method: 'PATCH', token: user.token, params: { id: doc.subscriptionId }, body });
      expect(res.status).toBe(400);
      expect(res.body?.error.code).toBe('UNKNOWN_FIELD');
    }
  });

  it('空のオブジェクトは 400', async () => {
    const user = await newUser();
    const [doc] = await seedSubscriptions(user.uid, [{ serviceName: 'Netflix' }]);
    const res = await callRoute(PATCH, { method: 'PATCH', token: user.token, params: { id: doc.subscriptionId }, body: {} });
    expect(res.status).toBe(400);
    expect(res.body?.error.code).toBe('VALIDATION_ERROR');
  });

  it('No.65 PATCH で trialEnabled を true に変えて trialEndDate を送らないと 400（最終無料日を入力してください）で、何も保存しない', async () => {
    const user = await newUser();
    const [doc] = await seedSubscriptions(user.uid, [{ serviceName: 'ChatGPT', firstBillingDate: '2026-11-30' }]);
    const res = await callRoute(PATCH, { method: 'PATCH', token: user.token, params: { id: doc.subscriptionId }, body: { trialEnabled: true } });
    expect(res.status).toBe(400);
    expect(res.body?.error).toMatchObject({ field: 'trialEndDate', message: '最終無料日を入力してください' });
    const saved = (await adminDb().collection('users').doc(user.uid).collection('subscriptions').doc(doc.subscriptionId).get()).data();
    expect(saved?.trialEnabled).toBe(false);
  });

  it('No.66 PATCH で trialEnabled を false に変えると、保存される trialEndDate は null（200）', async () => {
    const user = await newUser();
    const [doc] = await seedSubscriptions(user.uid, [{ serviceName: 'ChatGPT', firstBillingDate: '2026-11-30', trialEnabled: true, trialEndDate: '2026-11-10' }]);
    const res = await callRoute(PATCH, {
      method: 'PATCH',
      token: user.token,
      params: { id: doc.subscriptionId },
      body: { trialEnabled: false, trialEndDate: '2026-11-10' },
    });
    expect(res.status).toBe(200);
    expect(res.body?.data.subscription.trialEndDate).toBeNull();
    const saved = (await adminDb().collection('users').doc(user.uid).collection('subscriptions').doc(doc.subscriptionId).get()).data();
    expect(saved?.trialEndDate).toBeNull();
  });

  it('保存済みが endOfMonth で、請求日を月末日でない日に変えるときは billingDayMode=fixedDay が要る（無ければ 400、field=billingDayMode）', async () => {
    const user = await newUser();
    const [doc] = await seedSubscriptions(user.uid, [{ serviceName: 'ChatGPT', firstBillingDate: '2026-11-30', billingDayMode: 'endOfMonth' }]);
    const bad = await callRoute(PATCH, { method: 'PATCH', token: user.token, params: { id: doc.subscriptionId }, body: { firstBillingDate: '2026-11-15' } });
    expect(bad.status).toBe(400);
    expect(bad.body?.error.field).toBe('billingDayMode');
    const good = await callRoute(PATCH, {
      method: 'PATCH',
      token: user.token,
      params: { id: doc.subscriptionId },
      body: { firstBillingDate: '2026-11-15', billingDayMode: 'fixedDay' },
    });
    expect(good.status).toBe(200);
  });

  it('保存済みの請求日が壊れていて、今回の変更で直らないときは 400（その項目の誤り）', async () => {
    const user = await newUser();
    const [doc] = await seedSubscriptions(user.uid, [{ serviceName: '壊れた', firstBillingDate: 'broken' }]);
    const res = await callRoute(PATCH, { method: 'PATCH', token: user.token, params: { id: doc.subscriptionId }, body: { price: 500 } });
    expect(res.status).toBe(400);
    expect(res.body?.error.field).toBe('firstBillingDate');
    const fixed = await callRoute(PATCH, { method: 'PATCH', token: user.token, params: { id: doc.subscriptionId }, body: { firstBillingDate: '2026-11-04' } });
    expect(fixed.status).toBe(200);
  });
});

describe('DELETE /api/subscriptions/:id（削除）', () => {
  it('No.13 削除すると subscriptionCount-1、通知履歴は残る', async () => {
    const user = await newUser({ subscriptionCount: 2 });
    const [doc] = await seedSubscriptions(user.uid, [{ serviceName: 'Spotify' }, { serviceName: 'Netflix' }]);
    const eventRef = adminDb().collection('users').doc(user.uid).collection('notificationEvents').doc('e'.repeat(64));
    await eventRef.set({ subscriptionId: doc.subscriptionId, serviceNameAtNotification: 'Spotify', createdAt: Timestamp.now() });
    const res = await callRoute(DELETE, { method: 'DELETE', token: user.token, params: { id: doc.subscriptionId } });
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
    expect((await userDoc(user.uid)).subscriptionCount).toBe(1);
    expect(await subscriptionCount(user.uid)).toBe(1);
    expect((await eventRef.get()).exists).toBe(true);
  });

  it('DELETE を2回呼ぶと、2回目は 404。subscriptionCount を二重に減らさない。0 未満にしない', async () => {
    const user = await newUser({ subscriptionCount: 0 });
    const [doc] = await seedSubscriptions(user.uid, [{ serviceName: 'Spotify' }]);
    const first = await callRoute(DELETE, { method: 'DELETE', token: user.token, params: { id: doc.subscriptionId } });
    const second = await callRoute(DELETE, { method: 'DELETE', token: user.token, params: { id: doc.subscriptionId } });
    expect([first.status, second.status]).toEqual([204, 404]);
    expect((await userDoc(user.uid)).subscriptionCount).toBe(0);
  });
});

describe('他人のデータ', () => {
  it('No.14 他人の subscriptionId に GET・PATCH・DELETE すると 404（他人のサブスクは変わらない）', async () => {
    const owner = await newUser();
    const [doc] = await seedSubscriptions(owner.uid, [{ serviceName: 'Netflix', price: 1590 }]);
    const other = await newUser();
    const params = { id: doc.subscriptionId };
    expect((await callRoute(getOne, { token: other.token, params })).status).toBe(404);
    expect((await callRoute(PATCH, { method: 'PATCH', token: other.token, params, body: { price: 1 } })).status).toBe(404);
    expect((await callRoute(DELETE, { method: 'DELETE', token: other.token, params })).status).toBe(404);
    const saved = (await adminDb().collection('users').doc(owner.uid).collection('subscriptions').doc(doc.subscriptionId).get()).data();
    expect(saved?.price).toBe(1590);
    const list = await callRoute(getList, { token: other.token });
    expect(list.body?.data.items).toEqual([]);
  });
});
