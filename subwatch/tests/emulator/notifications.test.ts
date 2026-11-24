// 通知一覧・既読・すべて既読（GET /api/notifications・POST /api/notifications/:id/read・POST /api/notifications/read-all）と
// PATCH /api/account（04-21。API一覧 No.3・14・15・16、詳細_F-12、API共通仕様 B6・B24・B56・B92・B93・B94）
// テスト一覧の No.34・35・49・50・51・72・75（No.33 の画面の部分と No.41 は tests/e2e/notifications.spec.ts）
// route 経由のテストは、実際の現在時刻からの相対の時刻で通知を置く（route は new Date() を使う）。境目のテストは lib の関数に now を渡す
import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { PATCH } from '@/app/api/account/route';
import { POST as READ } from '@/app/api/notifications/[id]/read/route';
import { POST as READ_ALL } from '@/app/api/notifications/read-all/route';
import { GET as LIST } from '@/app/api/notifications/route';
import { adminDb } from '@/lib/firebase-admin';
import { isNotificationVisible, listNotifications, parseNotificationListQuery } from '@/lib/notifications';
import type { NotificationEventDoc } from '@/lib/types';
import { callRoute, resetEmulators, seedNotificationEvents, seedSubscriptions, seedUser, signUpUser } from './helpers';

const DAY_MS = 24 * 60 * 60 * 1000;
const OLD_VERSION = '2000-01-01';

async function callList(token: string | undefined, query = '') {
  return callRoute(LIST, { token, path: `/api/notifications${query}` });
}

async function callRead(token: string | undefined, id: string) {
  return callRoute(READ, { method: 'POST', token, params: { id }, path: `/api/notifications/${id}/read` });
}

async function callReadAll(token: string | undefined) {
  return callRoute(READ_ALL, { method: 'POST', token, path: '/api/notifications/read-all' });
}

async function callPatch(token: string | undefined, body: unknown) {
  return callRoute(PATCH, { method: 'PATCH', token, body, path: '/api/account' });
}

async function notificationDoc(uid: string, id: string) {
  return adminDb().collection('users').doc(uid).collection('notificationEvents').doc(id).get();
}

// 置く通知の項目（決定的IDがぶつからないように、targetDate を通し番号で変える）
function event(index: number, fields: Partial<NotificationEventDoc> = {}): Partial<NotificationEventDoc> {
  return { targetDate: `2026-10-${String(index + 1).padStart(2, '0')}`, ...fields };
}

// 初期設定済みのユーザー
async function initializedUser() {
  const user = await signUpUser();
  await seedUser(user.uid, { email: user.email });
  return user;
}

beforeEach(async () => {
  await resetEmulators();
});

describe('通知一覧の表示の判定（直近90日）', () => {
  it('No.49 createdAt＝now−90日 の通知は表示し、now−90日−1ミリ秒 は表示しない（isNotificationVisible に now を渡す）', () => {
    const now = new Date('2026-11-04T00:00:00.000Z');
    const boundary = now.getTime() - 90 * DAY_MS;
    expect(isNotificationVisible(boundary, now)).toBe(true);
    expect(isNotificationVisible(new Date(boundary), now)).toBe(true);
    expect(isNotificationVisible(boundary - 1, now)).toBe(false);
    expect(isNotificationVisible(now, now)).toBe(true);
  });

  it('No.49 listNotifications に now を渡すと、now−90日 の通知は一覧に出て、now−90日−1ミリ秒 の通知は出ない（unreadCount も同じ境目）', async () => {
    const user = await initializedUser();
    const now = new Date('2026-11-04T00:00:00.000Z');
    const boundary = now.getTime() - 90 * DAY_MS;
    const [inside] = await seedNotificationEvents(user.uid, [
      event(0, { createdAt: Timestamp.fromMillis(boundary), serviceNameAtNotification: '境目ちょうど' }),
      event(1, { createdAt: Timestamp.fromMillis(boundary - 1), serviceNameAtNotification: '1ミリ秒前' }),
    ]);
    const result = await listNotifications(user.uid, parseNotificationListQuery(new URLSearchParams()), { now });
    expect(result.items.map((item) => item.notificationId)).toEqual([inside.notificationId]);
    expect(result.unreadCount).toBe(1);
  });
});

describe('GET /api/notifications', () => {
  it('No.34 91日前に作られた通知は、S-08 の一覧（GET /api/notifications）に出ない', async () => {
    const user = await initializedUser();
    const now = Date.now();
    const [recent] = await seedNotificationEvents(user.uid, [
      event(0, { createdAt: Timestamp.fromMillis(now - 1000), serviceNameAtNotification: '今日の通知' }),
      event(1, { createdAt: Timestamp.fromMillis(now - 91 * DAY_MS), serviceNameAtNotification: '91日前の通知' }),
    ]);
    const res = await callList(user.token);
    expect(res.status).toBe(200);
    expect(res.body?.data.items.map((item: { notificationId: string }) => item.notificationId)).toEqual([recent.notificationId]);
    expect(res.body?.data.unreadCount).toBe(1);
    expect(res.body?.data.nextCursor).toBeNull();
  });

  it('応答の形：items（新しい順。subscriptionExists・viewedAt・createdAt は ISO の文字列）、nextCursor、unreadCount。uid・expireAt などの保存の項目は返さない', async () => {
    const user = await initializedUser();
    const base = Date.now() - 60_000;
    const [older, newer] = await seedNotificationEvents(user.uid, [
      event(0, { createdAt: Timestamp.fromMillis(base), viewedAt: Timestamp.fromMillis(base + 10) }),
      event(1, {
        createdAt: Timestamp.fromMillis(base + 1),
        notificationType: 'trial_end',
        daysBefore: 7,
        title: '無料トライアル終了まであと7日',
        body: '最終無料日は11/10です',
        priceAtNotification: null,
        serviceNameAtNotification: 'ChatGPT',
      }),
    ]);
    const res = await callList(user.token);
    expect(res.status).toBe(200);
    expect(res.body?.data).toEqual({
      items: [
        {
          notificationId: newer.notificationId,
          subscriptionId: 'a'.repeat(20),
          serviceNameAtNotification: 'ChatGPT',
          notificationType: 'trial_end',
          daysBefore: 7,
          targetDate: newer.targetDate,
          title: '無料トライアル終了まであと7日',
          body: '最終無料日は11/10です',
          priceAtNotification: null,
          subscriptionExists: false,
          viewedAt: null,
          webPushStatus: 'pending',
          createdAt: new Date(base + 1).toISOString(),
        },
        {
          notificationId: older.notificationId,
          subscriptionId: 'a'.repeat(20),
          serviceNameAtNotification: 'テストのサブスク',
          notificationType: 'billing',
          daysBefore: 1,
          targetDate: older.targetDate,
          title: '請求日まであと1日',
          body: '11/05・¥980 の請求予定',
          priceAtNotification: 980,
          subscriptionExists: false,
          viewedAt: new Date(base + 10).toISOString(),
          webPushStatus: 'pending',
          createdAt: new Date(base).toISOString(),
        },
      ],
      nextCursor: null,
      unreadCount: 1,
    });
  });

  it('No.50 フィルター4種と cursor：limit=2 で続きを最後まで読むと、どのフィルターでも重複・欠落なく新しい順にそろう（同じミリ秒は通知IDの降順）', async () => {
    const user = await initializedUser();
    const base = Date.now() - 10 * 60_000;
    // 9件：billing／trial_end、未読／既読を混ぜる。2件は同じミリ秒
    const specs: { type: 'billing' | 'trial_end'; read: boolean; offset: number }[] = [
      { type: 'billing', read: false, offset: 0 },
      { type: 'trial_end', read: false, offset: 1 },
      { type: 'billing', read: true, offset: 2 },
      { type: 'billing', read: false, offset: 3 },
      { type: 'trial_end', read: true, offset: 4 },
      { type: 'billing', read: false, offset: 5 },
      { type: 'billing', read: false, offset: 5 }, // 1つ前と同じミリ秒
      { type: 'trial_end', read: false, offset: 7 },
      { type: 'billing', read: true, offset: 8 },
    ];
    const docs = await seedNotificationEvents(
      user.uid,
      specs.map((spec, index) =>
        event(index, {
          notificationType: spec.type,
          createdAt: Timestamp.fromMillis(base + spec.offset),
          viewedAt: spec.read ? Timestamp.fromMillis(base + 100) : null,
        }),
      ),
    );
    const sorted = [...docs].sort((a, b) => {
      const diff = b.createdAt.toMillis() - a.createdAt.toMillis();
      if (diff !== 0) return diff;
      return a.notificationId < b.notificationId ? 1 : -1; // 同じミリ秒は通知IDの降順
    });
    const expected: Record<string, string[]> = {
      all: sorted.map((doc) => doc.notificationId),
      unread: sorted.filter((doc) => doc.viewedAt === null).map((doc) => doc.notificationId),
      billing: sorted.filter((doc) => doc.notificationType === 'billing').map((doc) => doc.notificationId),
      trial_end: sorted.filter((doc) => doc.notificationType === 'trial_end').map((doc) => doc.notificationId),
    };

    for (const filter of ['all', 'unread', 'billing', 'trial_end']) {
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 10; page += 1) {
        const query: string = `?filter=${filter}&limit=2${cursor ? `&cursor=${cursor}` : ''}`;
        const res = await callList(user.token, query);
        expect(res.status, `${filter} ${query}`).toBe(200);
        const ids = res.body?.data.items.map((item: { notificationId: string }) => item.notificationId) as string[];
        expect(ids.length).toBeLessThanOrEqual(2);
        seen.push(...ids);
        expect(res.body?.data.unreadCount).toBe(expected.unread.length); // filter・cursor に関係なく未読の全体
        cursor = res.body?.data.nextCursor ?? null;
        if (cursor === null) break;
        expect(cursor).toMatch(/^\d{1,16}_[A-Za-z0-9]{1,128}$/);
      }
      expect(seen, filter).toEqual(expected[filter]);
    }
  });

  it('No.50 省略すると filter=all・limit=20（21件目があれば nextCursor を返す）', async () => {
    const user = await initializedUser();
    const base = Date.now() - 60_000;
    await seedNotificationEvents(
      user.uid,
      Array.from({ length: 21 }, (_, index) => event(index, { createdAt: Timestamp.fromMillis(base + index) })),
    );
    const first = await callList(user.token);
    expect(first.body?.data.items).toHaveLength(20);
    expect(first.body?.data.nextCursor).not.toBeNull();
    const second = await callList(user.token, `?cursor=${first.body?.data.nextCursor}`);
    expect(second.body?.data.items).toHaveLength(1);
    expect(second.body?.data.nextCursor).toBeNull();
  });

  it('No.50 cursor が不正なら 400 VALIDATION_ERROR（field=cursor）。形が正しければ、その通知が無くても200でその位置より古い側を返す', async () => {
    const user = await initializedUser();
    const now = Date.now();
    const [older, newer] = await seedNotificationEvents(user.uid, [
      event(0, { createdAt: Timestamp.fromMillis(now - 2000) }),
      event(1, { createdAt: Timestamp.fromMillis(now - 1000) }),
    ]);
    for (const cursor of ['abc', '123', '_abc', '123_', '12345678901234567_abc', '253402300799001_abc', '123_ab-c', '', '1.5_abc', ` 123_abc`]) {
      const res = await callList(user.token, `?cursor=${encodeURIComponent(cursor)}`);
      expect(res.status, cursor).toBe(400);
      expect(res.body?.error).toMatchObject({ code: 'VALIDATION_ERROR', field: 'cursor', message: '入力内容を確認してください' });
    }
    const between = await callList(user.token, `?cursor=${now - 1000}_zzzz`);
    expect(between.status).toBe(200);
    // 同じミリ秒の 'zzzz' より通知IDが小さい newer も「古い側」に入る
    expect(between.body?.data.items.map((item: { notificationId: string }) => item.notificationId)).toEqual([newer.notificationId, older.notificationId]);
    const max = await callList(user.token, '?cursor=253402300799000_a');
    expect(max.status).toBe(200);
  });

  it('No.50 filter・limit が不正なら 400。誤りが複数なら filter・limit・cursor の順に details に入れ、field は最初の項目', async () => {
    const user = await initializedUser();
    const bad = [
      ['?filter=read', 'filter'],
      ['?filter=', 'filter'],
      ['?filter=ALL', 'filter'],
      ['?limit=0', 'limit'],
      ['?limit=51', 'limit'],
      ['?limit=', 'limit'],
      ['?limit=05', 'limit'],
      ['?limit=1.0', 'limit'],
      ['?limit=1e1', 'limit'],
      ['?limit=%201', 'limit'],
      ['?limit=-1', 'limit'],
    ];
    for (const [query, field] of bad) {
      const res = await callList(user.token, query);
      expect(res.status, query).toBe(400);
      expect(res.body?.error).toMatchObject({ code: 'VALIDATION_ERROR', field });
    }
    const multi = await callList(user.token, '?cursor=x&limit=99&filter=x');
    expect(multi.status).toBe(400);
    expect(multi.body?.error.field).toBe('filter');
    expect(multi.body?.error.details.map((d: { field: string }) => d.field)).toEqual(['filter', 'limit', 'cursor']);
    expect((await callList(user.token, '?limit=1')).status).toBe(200);
    expect((await callList(user.token, '?limit=50')).status).toBe(200);
  });

  it('No.51 サブスクを削除した後の通知は subscriptionExists=false で、通知を作ったときのサービス名（serviceNameAtNotification）を返す', async () => {
    const user = await initializedUser();
    const [kept, removed] = await seedSubscriptions(user.uid, [{ serviceName: 'Spotify' }, { serviceName: 'Netflix（改名後）' }]);
    const now = Date.now();
    const [forKept, forRemoved, broken] = await seedNotificationEvents(user.uid, [
      event(0, { subscriptionId: kept.subscriptionId, serviceNameAtNotification: 'Spotify', createdAt: Timestamp.fromMillis(now - 3000) }),
      event(1, { subscriptionId: removed.subscriptionId, serviceNameAtNotification: 'Netflix', createdAt: Timestamp.fromMillis(now - 2000) }),
      event(2, { subscriptionId: 'bad/id', serviceNameAtNotification: '形の違うID', createdAt: Timestamp.fromMillis(now - 1000) }),
    ]);
    await adminDb().collection('users').doc(user.uid).collection('subscriptions').doc(removed.subscriptionId).delete();
    const res = await callList(user.token);
    const byId = new Map(
      (res.body?.data.items as { notificationId: string; subscriptionExists: boolean; serviceNameAtNotification: string }[]).map((item) => [item.notificationId, item]),
    );
    expect(byId.get(forKept.notificationId)).toMatchObject({ subscriptionExists: true, serviceNameAtNotification: 'Spotify' });
    expect(byId.get(forRemoved.notificationId)).toMatchObject({ subscriptionExists: false, serviceNameAtNotification: 'Netflix' });
    expect(byId.get(broken.notificationId)).toMatchObject({ subscriptionExists: false });
  });

  it('ログインしていなければ、クエリが不正でも 401。users が無ければ 409 ACCOUNT_NOT_INITIALIZED、規約の版が古ければ 409 TERMS_RECONSENT_REQUIRED（クエリの検査より先）', async () => {
    expect((await callList(undefined, '?filter=x')).status).toBe(401);
    const noUsers = await signUpUser();
    const res = await callList(noUsers.token, '?filter=x');
    expect(res.status).toBe(409);
    expect(res.body?.error.code).toBe('ACCOUNT_NOT_INITIALIZED');
    const old = await signUpUser();
    await seedUser(old.uid, { termsVersion: OLD_VERSION });
    const oldRes = await callList(old.token, '?filter=x');
    expect(oldRes.status).toBe(409);
    expect(oldRes.body?.error.code).toBe('TERMS_RECONSENT_REQUIRED');
  });

  it('他人の通知は一覧に出ない', async () => {
    const me = await initializedUser();
    const other = await initializedUser();
    await seedNotificationEvents(other.uid, [event(0)]);
    const res = await callList(me.token);
    expect(res.body?.data).toEqual({ items: [], nextCursor: null, unreadCount: 0 });
  });
});

describe('POST /api/notifications/:id/read', () => {
  it('No.72 他人の通知は404で何も書かない。2回目の read は保存済みの viewedAt を返し、未読に戻らない。1件を既読にすると unreadCount=2、filter=unread も2件', async () => {
    const me = await initializedUser();
    const other = await initializedUser();
    const now = Date.now();
    const mine = await seedNotificationEvents(me.uid, [
      event(0, { createdAt: Timestamp.fromMillis(now - 3000) }),
      event(1, { createdAt: Timestamp.fromMillis(now - 2000) }),
      event(2, { createdAt: Timestamp.fromMillis(now - 1000) }),
    ]);
    const [others] = await seedNotificationEvents(other.uid, [event(0, { subscriptionId: 'b'.repeat(20) })]);
    const othersBefore = (await notificationDoc(other.uid, others.notificationId)).data();

    const forbidden = await callRead(me.token, others.notificationId);
    expect(forbidden.status).toBe(404);
    expect(forbidden.body?.error.code).toBe('NOT_FOUND');
    const othersAfter = await notificationDoc(other.uid, others.notificationId);
    expect(othersAfter.data()).toEqual(othersBefore);
    expect(othersAfter.get('viewedAt')).toBeNull();

    const first = await callRead(me.token, mine[0].notificationId);
    expect(first.status).toBe(200);
    const viewedAt = first.body?.data.viewedAt as string;
    expect(new Date(viewedAt).toISOString()).toBe(viewedAt);
    const saved = await notificationDoc(me.uid, mine[0].notificationId);
    expect((saved.get('viewedAt') as Timestamp).toDate().toISOString()).toBe(viewedAt);
    expect((saved.get('updatedAt') as Timestamp).toDate().toISOString()).toBe(viewedAt);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await callRead(me.token, mine[0].notificationId);
    expect(second.status).toBe(200);
    expect(second.body?.data).toEqual({ viewedAt }); // 保存済みの値（書き直さない）
    const afterSecond = await notificationDoc(me.uid, mine[0].notificationId);
    expect(afterSecond.updateTime!.isEqual(saved.updateTime!)).toBe(true); // 2回目は何も書かない
    expect((afterSecond.get('updatedAt') as Timestamp).toDate().toISOString()).toBe(viewedAt);

    const all = await callList(me.token);
    expect(all.body?.data.unreadCount).toBe(2);
    const unread = await callList(me.token, '?filter=unread');
    expect(unread.body?.data.items).toHaveLength(2);
    expect(unread.body?.data.unreadCount).toBe(2);
    // 未読に戻す方法（API）は無い：既読の通知はどの呼び出しでも viewedAt が残る
    await callReadAll(me.token);
    expect(((await notificationDoc(me.uid, mine[0].notificationId)).get('viewedAt') as Timestamp).toDate().toISOString()).toBe(viewedAt);
  });

  it('通知IDが64桁の小文字16進でなければ404（大文字・短い・記号）。存在しない通知も404', async () => {
    const user = await initializedUser();
    const [doc] = await seedNotificationEvents(user.uid, [event(0)]);
    for (const id of [doc.notificationId.toUpperCase(), doc.notificationId.slice(1), 'abc', `${doc.notificationId.slice(1)}g`, '.']) {
      const res = await callRead(user.token, id);
      expect(res.status, id).toBe(404);
      expect(res.body?.error.code).toBe('NOT_FOUND');
    }
    expect((await callRead(user.token, 'f'.repeat(64))).status).toBe(404);
  });

  it('90日より古い通知も既読にできる', async () => {
    const user = await initializedUser();
    const [doc] = await seedNotificationEvents(user.uid, [event(0, { createdAt: Timestamp.fromMillis(Date.now() - 91 * DAY_MS) })]);
    const res = await callRead(user.token, doc.notificationId);
    expect(res.status).toBe(200);
    expect((await notificationDoc(user.uid, doc.notificationId)).get('viewedAt')).toBeInstanceOf(Timestamp);
  });

  it('401・409 ACCOUNT_NOT_INITIALIZED・409 TERMS_RECONSENT_REQUIRED は、通知IDを確かめる前に返す', async () => {
    expect((await callRead(undefined, 'abc')).status).toBe(401);
    const noUsers = await signUpUser();
    expect((await callRead(noUsers.token, 'abc')).body?.error.code).toBe('ACCOUNT_NOT_INITIALIZED');
    const old = await signUpUser();
    await seedUser(old.uid, { termsVersion: OLD_VERSION });
    expect((await callRead(old.token, 'abc')).body?.error.code).toBe('TERMS_RECONSENT_REQUIRED');
  });
});

describe('POST /api/notifications/read-all', () => {
  it('No.35 未読3件で「すべて既読」を呼ぶと updatedCount=3、未読数0。2回目は updatedCount=0（結果は同じ）', async () => {
    const user = await initializedUser();
    const now = Date.now();
    const docs = await seedNotificationEvents(user.uid, [
      event(0, { createdAt: Timestamp.fromMillis(now - 3000) }),
      event(1, { createdAt: Timestamp.fromMillis(now - 2000) }),
      event(2, { createdAt: Timestamp.fromMillis(now - 1000) }),
      event(3, { createdAt: Timestamp.fromMillis(now - 500), viewedAt: Timestamp.fromMillis(now - 400) }),
    ]);
    expect((await callList(user.token)).body?.data.unreadCount).toBe(3);
    const res = await callReadAll(user.token);
    expect(res.status).toBe(200);
    expect(res.body?.data).toEqual({ updatedCount: 3 });
    expect((await callList(user.token)).body?.data.unreadCount).toBe(0);
    expect((await callList(user.token, '?filter=unread')).body?.data.items).toEqual([]);
    // 既読だった1件の viewedAt は変えない
    expect(((await notificationDoc(user.uid, docs[3].notificationId)).get('viewedAt') as Timestamp).toMillis()).toBe(now - 400);
    const again = await callReadAll(user.token);
    expect(again.body?.data).toEqual({ updatedCount: 0 });
  });

  it('直近90日の未読だけを既読にする（91日前の未読は残す）。401件は400件ずつ2回で全部既読にする', async () => {
    const user = await initializedUser();
    const now = Date.now();
    const docs = await seedNotificationEvents(
      user.uid,
      Array.from({ length: 401 }, (_, index) =>
        event(0, { targetDate: `2026-01-01`, subscriptionId: `s${String(index).padStart(19, '0')}`, createdAt: Timestamp.fromMillis(now - 10_000 + index) }),
      ),
    );
    const [old] = await seedNotificationEvents(user.uid, [event(5, { createdAt: Timestamp.fromMillis(now - 91 * DAY_MS) })]);
    const res = await callReadAll(user.token);
    expect(res.body?.data).toEqual({ updatedCount: 401 });
    expect((await notificationDoc(user.uid, docs[400].notificationId)).get('viewedAt')).toBeInstanceOf(Timestamp);
    expect((await notificationDoc(user.uid, old.notificationId)).get('viewedAt')).toBeNull();
  });

  it('401・409 ACCOUNT_NOT_INITIALIZED', async () => {
    expect((await callReadAll(undefined)).status).toBe(401);
    const noUsers = await signUpUser();
    const res = await callReadAll(noUsers.token);
    expect(res.status).toBe(409);
    expect(res.body?.error.code).toBe('ACCOUNT_NOT_INITIALIZED');
  });
});

describe('PATCH /api/account', () => {
  it('No.75 {accountNotificationEnabled:false} で200、users の値と updatedAt が変わる。同じ値は何も書かず200（updatedAt も変えない）', async () => {
    const user = await signUpUser();
    const before = Timestamp.fromMillis(Date.now() - 60_000);
    await seedUser(user.uid, { email: user.email, accountNotificationEnabled: true, updatedAt: before });
    const ref = adminDb().collection('users').doc(user.uid);
    const snapshotBefore = await ref.get();

    const res = await callPatch(user.token, { accountNotificationEnabled: false });
    expect(res.status).toBe(200);
    expect(res.body?.data).toEqual({ accountNotificationEnabled: false });
    const changed = await ref.get();
    expect(changed.get('accountNotificationEnabled')).toBe(false);
    expect((changed.get('updatedAt') as Timestamp).toMillis()).toBeGreaterThan(before.toMillis());
    // 書くのは accountNotificationEnabled と updatedAt だけ
    const { accountNotificationEnabled: _a, updatedAt: _u, ...restBefore } = snapshotBefore.data()!;
    const { accountNotificationEnabled: _b, updatedAt: _v, ...restAfter } = changed.data()!;
    void _a;
    void _u;
    void _b;
    void _v;
    expect(restAfter).toEqual(restBefore);

    const same = await callPatch(user.token, { accountNotificationEnabled: false });
    expect(same.status).toBe(200);
    expect(same.body?.data).toEqual({ accountNotificationEnabled: false });
    const unchanged = await ref.get();
    expect((unchanged.get('updatedAt') as Timestamp).isEqual(changed.get('updatedAt') as Timestamp)).toBe(true);
    expect(unchanged.updateTime?.isEqual(changed.updateTime!)).toBe(true); // ドキュメントを書いていない

    const back = await callPatch(user.token, { accountNotificationEnabled: true });
    expect(back.body?.data).toEqual({ accountNotificationEnabled: true });
    expect((await ref.get()).get('accountNotificationEnabled')).toBe(true);
  });

  it('No.75 値が真偽値でない本文は 400 VALIDATION_ERROR、未知のキーは 400 UNKNOWN_FIELD（どちらも何も書かない）', async () => {
    const user = await initializedUser();
    const ref = adminDb().collection('users').doc(user.uid);
    const before = (await ref.get()).updateTime!;
    for (const body of [{ accountNotificationEnabled: 'false' }, { accountNotificationEnabled: null }, { accountNotificationEnabled: 0 }, {}]) {
      const res = await callPatch(user.token, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body?.error).toMatchObject({ code: 'VALIDATION_ERROR', field: 'accountNotificationEnabled' });
    }
    const unknown = await callPatch(user.token, { accountNotificationEnabled: false, email: 'x@example.com' });
    expect(unknown.status).toBe(400);
    expect(unknown.body?.error).toMatchObject({ code: 'UNKNOWN_FIELD', field: 'email' });
    const notJson = await callRoute(PATCH, { method: 'PATCH', token: user.token, rawBody: 'false', headers: { 'Content-Type': 'text/plain' }, path: '/api/account' });
    expect(notJson.status).toBe(400);
    expect(notJson.body?.error.code).toBe('VALIDATION_ERROR');
    expect((await ref.get()).updateTime!.isEqual(before)).toBe(true);
    expect((await ref.get()).get('accountNotificationEnabled')).toBe(true);
  });

  it('No.75 users が無いと 409 ACCOUNT_NOT_INITIALIZED で、users を作らない', async () => {
    const user = await signUpUser();
    const res = await callPatch(user.token, { accountNotificationEnabled: false });
    expect(res.status).toBe(409);
    expect(res.body?.error.code).toBe('ACCOUNT_NOT_INITIALIZED');
    expect((await adminDb().collection('users').doc(user.uid).get()).exists).toBe(false);
  });

  it('ログインしていなければ 401、規約の版が古ければ 409 TERMS_RECONSENT_REQUIRED（本文の検査より先）', async () => {
    expect((await callPatch(undefined, { accountNotificationEnabled: 'x' })).status).toBe(401);
    const old = await signUpUser();
    await seedUser(old.uid, { termsVersion: OLD_VERSION });
    const res = await callPatch(old.token, { accountNotificationEnabled: 'x' });
    expect(res.status).toBe(409);
    expect(res.body?.error.code).toBe('TERMS_RECONSENT_REQUIRED');
  });

  it('項目が無い users（古いドキュメント）は true として比べる：true を送っても書かず、false を送ると書く', async () => {
    const user = await initializedUser();
    const ref = adminDb().collection('users').doc(user.uid);
    const { accountNotificationEnabled: _ignored, ...rest } = (await ref.get()).data()!;
    void _ignored;
    await ref.set(rest);
    const before = (await ref.get()).updateTime!;
    expect((await callPatch(user.token, { accountNotificationEnabled: true })).body?.data).toEqual({ accountNotificationEnabled: true });
    expect((await ref.get()).updateTime!.isEqual(before)).toBe(true);
    expect((await ref.get()).get('accountNotificationEnabled')).toBeUndefined();
    expect((await callPatch(user.token, { accountNotificationEnabled: false })).status).toBe(200);
    expect((await ref.get()).get('accountNotificationEnabled')).toBe(false);
  });
});
