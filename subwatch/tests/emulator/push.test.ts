// POST・DELETE /api/push/subscribe（04-12。API一覧 No.12・13、API共通仕様 B6・B23・B91、DB設計書 テーブルNo.4・3.補足設計 B16・B17）
// テスト一覧の No.48・74 と、番号なしの検査の順序・検証・上書き・DELETE・transaction の中の users の確認・Auth の一時障害（503）
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as GET_ACCOUNT } from '@/app/api/account/route';
import { DELETE, POST } from '@/app/api/push/subscribe/route';
import { HttpError } from '@/lib/errors';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { savePushSubscription } from '@/lib/push';
import { callRoute, resetEmulators, seedPushSubscription, seedUser, signUpUser } from './helpers';

const PATH = '/api/push/subscribe';
// UTF-8 で1500バイトの https の URL（日本語を混ぜる。「あ」は3バイト）
const ENDPOINT_1500_BYTES = `https://push.example.com/${'あ'.repeat(100)}${'a'.repeat(1500 - 'https://push.example.com/'.length - 300)}`;

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

let counter = 0;
function newEndpoint(): string {
  counter += 1;
  return `https://fcm.googleapis.com/fcm/send/test-${Date.now()}-${counter}`;
}

function body(fields: Record<string, unknown> = {}) {
  return { endpoint: newEndpoint(), keys: { p256dh: 'BPp256dh-test-key', auth: 'auth-test-secret' }, userAgent: 'Mozilla/5.0 (test)', ...fields };
}

async function initializedUser() {
  const user = await signUpUser();
  await seedUser(user.uid, { email: user.email });
  return user;
}

function subscriptionsOf(uid: string) {
  return adminDb().collection('users').doc(uid).collection('webPushSubscriptions');
}

beforeEach(async () => {
  await resetEmulators();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/push/subscribe', () => {
  it('テストの値の確認：ENDPOINT_1500_BYTES は UTF-8 で1500バイト', () => {
    expect(Buffer.byteLength(ENDPOINT_1500_BYTES, 'utf8')).toBe(1500);
  });

  it('200 {enabled:true}。ID は sha256(endpoint)、項目は DB設計書 No4 のとおり', async () => {
    const user = await initializedUser();
    const input = body();
    const res = await callRoute(POST, { method: 'POST', token: user.token, body: input, path: PATH });
    expect(res.status).toBe(200);
    expect(res.body?.data).toEqual({ enabled: true });
    const snapshot = await subscriptionsOf(user.uid).get();
    expect(snapshot.size).toBe(1);
    const doc = snapshot.docs[0];
    expect(doc.id).toBe(sha256(input.endpoint));
    expect(doc.data()).toMatchObject({
      webPushId: sha256(input.endpoint),
      uid: user.uid,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: input.userAgent,
    });
    expect(doc.get('createdAt')).toBeInstanceOf(Timestamp);
    expect(doc.get('lastSeenAt')).toBeInstanceOf(Timestamp);
  });

  it('同じ endpoint を2回登録しても1件。createdAt は変えず、p256dh・auth・userAgent・lastSeenAt を新しくする', async () => {
    const user = await initializedUser();
    const old = await seedPushSubscription(user.uid, {
      createdAt: Timestamp.fromMillis(1_000),
      lastSeenAt: Timestamp.fromMillis(2_000),
    });
    const res = await callRoute(POST, {
      method: 'POST',
      token: user.token,
      body: { endpoint: old.endpoint, keys: { p256dh: 'new-p256dh', auth: 'new-auth' }, userAgent: 'new agent' },
      path: PATH,
    });
    expect(res.status).toBe(200);
    const snapshot = await subscriptionsOf(user.uid).get();
    expect(snapshot.size).toBe(1);
    const data = snapshot.docs[0].data();
    expect(data).toMatchObject({ p256dh: 'new-p256dh', auth: 'new-auth', userAgent: 'new agent' });
    expect((data.createdAt as Timestamp).toMillis()).toBe(1_000);
    expect((data.lastSeenAt as Timestamp).toMillis()).toBeGreaterThan(2_000);
  });

  it('No.48 同じ endpoint を別の uid が登録済みなら、古い購読を削除して新しい持ち主に登録する', async () => {
    const before = await initializedUser();
    const after = await initializedUser();
    const old = await seedPushSubscription(before.uid);
    const res = await callRoute(POST, {
      method: 'POST',
      token: after.token,
      body: { endpoint: old.endpoint, keys: { p256dh: 'p', auth: 'a' } },
      path: PATH,
    });
    expect(res.status).toBe(200);
    expect((await subscriptionsOf(before.uid).get()).size).toBe(0);
    const mine = await subscriptionsOf(after.uid).get();
    expect(mine.docs.map((d) => d.id)).toEqual([old.webPushId]);
    expect(mine.docs[0].get('uid')).toBe(after.uid);
  });

  it.each([
    ['http の URL', 'http://push.example.com/a'],
    ['IPv4 アドレス', 'https://192.168.0.1/a'],
    ['localhost', 'https://localhost/a'],
    ['UTF-8 で1500バイト', ENDPOINT_1500_BYTES],
  ])('No.74 endpoint が %s なら 400 VALIDATION_ERROR（field=endpoint）で保存しない', async (_name, endpoint) => {
    const user = await initializedUser();
    const res = await callRoute(POST, { method: 'POST', token: user.token, body: body({ endpoint }), path: PATH });
    expect(res.status).toBe(400);
    expect(res.body?.error).toMatchObject({ code: 'VALIDATION_ERROR', field: 'endpoint', message: '入力内容を確認してください' });
    expect((await subscriptionsOf(user.uid).get()).size).toBe(0);
  });

  it('No.74 UTF-8 でちょうど1499バイトの https の URL は登録できる', async () => {
    const user = await initializedUser();
    const prefix = 'https://push.example.com/';
    const endpoint = prefix + 'b'.repeat(1499 - prefix.length);
    expect(Buffer.byteLength(endpoint)).toBe(1499);
    const res = await callRoute(POST, { method: 'POST', token: user.token, body: body({ endpoint }), path: PATH });
    expect(res.status).toBe(200);
  });

  it('No.74 lastSeenAt の違う10端末が登録済みで11台目を登録すると、lastSeenAt が最も古い1件が消えて10件のまま', async () => {
    const user = await initializedUser();
    const seeded = [];
    for (let i = 0; i < 10; i += 1) {
      // 置く順と lastSeenAt の順をずらす（最も古いのは5番目に置いたもの）
      const minutes = i === 4 ? 0 : 100 + i;
      seeded.push(await seedPushSubscription(user.uid, { lastSeenAt: Timestamp.fromMillis(Date.UTC(2026, 10, 1, 0, minutes)) }));
    }
    const input = body();
    const res = await callRoute(POST, { method: 'POST', token: user.token, body: input, path: PATH });
    expect(res.status).toBe(200);
    const ids = (await subscriptionsOf(user.uid).get()).docs.map((d) => d.id);
    expect(ids).toHaveLength(10);
    expect(ids).not.toContain(seeded[4].webPushId);
    expect(ids).toContain(sha256(input.endpoint));
  });

  it('No.74 10端末が登録済みでも、同じ endpoint の上書きでは消さない', async () => {
    const user = await initializedUser();
    const seeded = [];
    for (let i = 0; i < 10; i += 1) {
      seeded.push(await seedPushSubscription(user.uid, { lastSeenAt: Timestamp.fromMillis(Date.UTC(2026, 10, 1, 0, i)) }));
    }
    const res = await callRoute(POST, {
      method: 'POST',
      token: user.token,
      body: { endpoint: seeded[9].endpoint, keys: { p256dh: 'p', auth: 'a' } },
      path: PATH,
    });
    expect(res.status).toBe(200);
    const ids = (await subscriptionsOf(user.uid).get()).docs.map((d) => d.id).sort();
    expect(ids).toEqual(seeded.map((s) => s.webPushId).sort());
  });

  it('11件あるとき（まれな場合）の新しい登録は、9件になるまで古い順に消してから保存する（lastSeenAt が無いものが最も古い。同じときは ID の昇順）', async () => {
    const user = await initializedUser();
    const same = Timestamp.fromMillis(Date.UTC(2026, 10, 1));
    const seeded = [];
    seeded.push(await seedPushSubscription(user.uid, { lastSeenAt: null }));
    for (let i = 0; i < 10; i += 1) seeded.push(await seedPushSubscription(user.uid, { lastSeenAt: i < 3 ? same : Timestamp.fromMillis(Date.UTC(2026, 10, 2, 0, i)) }));
    const sameIds = seeded.slice(1, 4).map((s) => s.webPushId).sort();
    const res = await callRoute(POST, { method: 'POST', token: user.token, body: body(), path: PATH });
    expect(res.status).toBe(200);
    const ids = (await subscriptionsOf(user.uid).get()).docs.map((d) => d.id);
    expect(ids).toHaveLength(10);
    expect(ids).not.toContain(seeded[0].webPushId); // lastSeenAt が無い
    expect(ids).not.toContain(sameIds[0]); // 同じ時刻の中で ID がいちばん小さい
    expect(ids).toContain(sameIds[1]);
  });

  it('項目の誤りはすべて details に入れ、順は endpoint → keys.p256dh → keys.auth → userAgent', async () => {
    const user = await initializedUser();
    const res = await callRoute(POST, {
      method: 'POST',
      token: user.token,
      body: { endpoint: 'ftp://push.example.com/a', keys: { p256dh: '', auth: 'x'.repeat(513) }, userAgent: 'u'.repeat(513) },
      path: PATH,
    });
    expect(res.status).toBe(400);
    expect(res.body?.error.code).toBe('VALIDATION_ERROR');
    expect(res.body?.error.field).toBe('endpoint');
    expect(res.body?.error.details.map((d: { field: string }) => d.field)).toEqual(['endpoint', 'keys.p256dh', 'keys.auth', 'userAgent']);
  });

  it('keys がオブジェクトでないときは field=keys', async () => {
    const user = await initializedUser();
    const res = await callRoute(POST, { method: 'POST', token: user.token, body: body({ keys: 'abc' }), path: PATH });
    expect(res.status).toBe(400);
    expect(res.body?.error).toMatchObject({ code: 'VALIDATION_ERROR', field: 'keys' });
  });

  it('p256dh・auth・userAgent は512文字まで受け付け、userAgent の空文字・省略は null', async () => {
    const user = await initializedUser();
    const a = body({ keys: { p256dh: 'p'.repeat(512), auth: 'a'.repeat(512) }, userAgent: 'u'.repeat(512) });
    expect((await callRoute(POST, { method: 'POST', token: user.token, body: a, path: PATH })).status).toBe(200);
    const b = body({ userAgent: '' });
    expect((await callRoute(POST, { method: 'POST', token: user.token, body: b, path: PATH })).status).toBe(200);
    const c = body();
    delete (c as Record<string, unknown>).userAgent;
    expect((await callRoute(POST, { method: 'POST', token: user.token, body: c, path: PATH })).status).toBe(200);
    expect((await subscriptionsOf(user.uid).doc(sha256(b.endpoint)).get()).get('userAgent')).toBeNull();
    expect((await subscriptionsOf(user.uid).doc(sha256(c.endpoint)).get()).get('userAgent')).toBeNull();
  });

  it('未知のキーは 400 UNKNOWN_FIELD（keys の中は field が「keys.名前」。toJSON() の expirationTime も未知のキー）', async () => {
    const user = await initializedUser();
    const res = await callRoute(POST, {
      method: 'POST',
      token: user.token,
      body: { ...body(), expirationTime: null, keys: { p256dh: 'p', auth: 'a', extra: 'x' } },
      path: PATH,
    });
    expect(res.status).toBe(400);
    expect(res.body?.error.code).toBe('UNKNOWN_FIELD');
    expect(res.body?.error.details.map((d: { field: string }) => d.field).sort()).toEqual(['expirationTime', 'keys.extra']);
    expect((await subscriptionsOf(user.uid).get()).size).toBe(0);
  });

  it('検査の順序：token が無ければ本文が不正でも 401、users が無ければ 409 ACCOUNT_NOT_INITIALIZED、版が古ければ 409 TERMS_RECONSENT_REQUIRED', async () => {
    const noToken = await callRoute(POST, { method: 'POST', body: { bad: true }, path: PATH });
    expect(noToken.status).toBe(401);
    expect(noToken.body?.error.code).toBe('UNAUTHENTICATED');

    const noUsers = await signUpUser();
    const res1 = await callRoute(POST, { method: 'POST', token: noUsers.token, body: { bad: true }, path: PATH });
    expect(res1.status).toBe(409);
    expect(res1.body?.error.code).toBe('ACCOUNT_NOT_INITIALIZED');

    const oldTerms = await signUpUser();
    await seedUser(oldTerms.uid, { termsVersion: '2000-01-01' });
    const res2 = await callRoute(POST, { method: 'POST', token: oldTerms.token, body: body(), path: PATH });
    expect(res2.status).toBe(409);
    expect(res2.body?.error.code).toBe('TERMS_RECONSENT_REQUIRED');
    expect((await subscriptionsOf(oldTerms.uid).get()).size).toBe(0);
  });

  it('JSON でない本文は 400 VALIDATION_ERROR', async () => {
    const user = await initializedUser();
    const res = await callRoute(POST, { method: 'POST', token: user.token, rawBody: 'not json', headers: { 'Content-Type': 'application/json' }, path: PATH });
    expect(res.status).toBe(400);
    expect(res.body?.error.code).toBe('VALIDATION_ERROR');
  });

  it('保存の transaction の中で users/{uid} が無くなっていたら 409 ACCOUNT_NOT_INITIALIZED にして保存しない', async () => {
    const user = await signUpUser(); // users を作らない（route の検査の後に削除された場合と同じ）
    await expect(
      savePushSubscription(user.uid, { endpoint: newEndpoint(), keys: { p256dh: 'p', auth: 'a' }, userAgent: null }),
    ).rejects.toMatchObject({ status: 409, code: 'ACCOUNT_NOT_INITIALIZED' } satisfies Partial<HttpError>);
    expect((await subscriptionsOf(user.uid).get()).size).toBe(0);
  });

  it('Auth の一時障害（verifyIdToken が auth/internal-error）では 503 TEMPORARILY_UNAVAILABLE', async () => {
    const user = await initializedUser();
    vi.spyOn(adminAuth(), 'verifyIdToken').mockRejectedValue(Object.assign(new Error('internal'), { code: 'auth/internal-error' }));
    const res = await callRoute(POST, { method: 'POST', token: user.token, body: body(), path: PATH });
    expect(res.status).toBe(503);
    expect(res.body?.error.code).toBe('TEMPORARILY_UNAVAILABLE');
  });

  it('登録した ID は GET /api/account の pushSubscriptionIds に webPushId の昇順で入る', async () => {
    const user = await initializedUser();
    const a = body();
    const b = body();
    await callRoute(POST, { method: 'POST', token: user.token, body: a, path: PATH });
    await callRoute(POST, { method: 'POST', token: user.token, body: b, path: PATH });
    const res = await callRoute(GET_ACCOUNT, { token: user.token, path: '/api/account' });
    expect(res.body?.data.pushSubscriptionIds).toEqual([sha256(a.endpoint), sha256(b.endpoint)].sort());
    expect(res.body?.data.pushSubscriptionCount).toBe(2);
  });
});

describe('DELETE /api/push/subscribe', () => {
  it('この端末の購読だけを消して 204。対象が無くても 204', async () => {
    const user = await initializedUser();
    const mine = await seedPushSubscription(user.uid);
    const other = await seedPushSubscription(user.uid);
    const res = await callRoute(DELETE, { method: 'DELETE', token: user.token, body: { endpoint: mine.endpoint }, path: PATH });
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
    expect((await subscriptionsOf(user.uid).get()).docs.map((d) => d.id)).toEqual([other.webPushId]);
    const again = await callRoute(DELETE, { method: 'DELETE', token: user.token, body: { endpoint: mine.endpoint }, path: PATH });
    expect(again.status).toBe(204);
  });

  it('規約の版は調べない（版が古くても 204 で消せる）', async () => {
    const user = await signUpUser();
    await seedUser(user.uid, { termsVersion: '2000-01-01', privacyVersion: '2000-01-01' });
    const mine = await seedPushSubscription(user.uid);
    const res = await callRoute(DELETE, { method: 'DELETE', token: user.token, body: { endpoint: mine.endpoint }, path: PATH });
    expect(res.status).toBe(204);
    expect((await subscriptionsOf(user.uid).get()).size).toBe(0);
  });

  it('users が無ければ 409 ACCOUNT_NOT_INITIALIZED、token が無ければ 401', async () => {
    const user = await signUpUser();
    const res = await callRoute(DELETE, { method: 'DELETE', token: user.token, body: { endpoint: newEndpoint() }, path: PATH });
    expect(res.status).toBe(409);
    expect(res.body?.error.code).toBe('ACCOUNT_NOT_INITIALIZED');
    const noToken = await callRoute(DELETE, { method: 'DELETE', body: { endpoint: newEndpoint() }, path: PATH });
    expect(noToken.status).toBe(401);
  });

  it.each([
    ['無い', {}],
    ['文字列でない', { endpoint: 123 }],
    ['空文字', { endpoint: '' }],
  ])('endpoint が%sときは 400 VALIDATION_ERROR（field=endpoint）', async (_name, input) => {
    const user = await initializedUser();
    const res = await callRoute(DELETE, { method: 'DELETE', token: user.token, body: input, path: PATH });
    expect(res.status).toBe(400);
    expect(res.body?.error).toMatchObject({ code: 'VALIDATION_ERROR', field: 'endpoint' });
  });

  it('https でない endpoint も検証せずに受け付ける（204）。未知のキーは 400 UNKNOWN_FIELD', async () => {
    const user = await initializedUser();
    const res = await callRoute(DELETE, { method: 'DELETE', token: user.token, body: { endpoint: 'http://localhost/a' }, path: PATH });
    expect(res.status).toBe(204);
    const unknown = await callRoute(DELETE, { method: 'DELETE', token: user.token, body: { endpoint: newEndpoint(), keys: {} }, path: PATH });
    expect(unknown.status).toBe(400);
    expect(unknown.body?.error).toMatchObject({ code: 'UNKNOWN_FIELD', field: 'keys' });
  });
});
