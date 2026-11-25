// POST /api/account/bootstrap と GET /api/account（04-05。API一覧 No.1・2、詳細_F-01、API共通仕様 B6・B23・B69、決まりの一覧 C-11）
// テスト一覧の No.16（API の部分）・17・29（GET /api/account の部分）・55・57 と、番号なしの同意の記録（C-11）・pushSubscriptionIds
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/account/route';
import { POST as BOOTSTRAP } from '@/app/api/account/bootstrap/route';
import { bootstrapAccount, getAccount, requireInitialized } from '@/lib/account';
import { HttpError } from '@/lib/errors';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { callRoute, resetEmulators, seedUser, signUpUser } from './helpers';

const TERMS = process.env.NEXT_PUBLIC_TERMS_VERSION ?? '';
const PRIVACY = process.env.NEXT_PUBLIC_PRIVACY_VERSION ?? '';
const OLD = '2000-01-01';

function bootstrapBody(fields: Record<string, unknown> = {}) {
  return { termsAccepted: true, privacyAccepted: true, termsVersion: TERMS, privacyVersion: PRIVACY, ...fields };
}

async function callBootstrap(token: string, body: unknown = bootstrapBody()) {
  return callRoute(BOOTSTRAP, { method: 'POST', token, body, path: '/api/account/bootstrap' });
}

async function userDoc(uid: string) {
  return adminDb().collection('users').doc(uid).get();
}

beforeEach(async () => {
  await resetEmulators();
});

describe('POST /api/account/bootstrap', () => {
  it('users を作り、200 {uid, initialized:true}。項目は DB設計書 No1 のとおり（email は ID token から）', async () => {
    const user = await signUpUser();
    const res = await callBootstrap(user.token);
    expect(res.status).toBe(200);
    expect(res.body?.data).toEqual({ uid: user.uid, initialized: true });
    const doc = (await userDoc(user.uid)).data()!;
    expect(doc).toMatchObject({
      uid: user.uid,
      email: user.email,
      subscriptionCount: 0,
      accountNotificationEnabled: true,
      termsVersion: TERMS,
      privacyVersion: PRIVACY,
    });
    expect(doc.termsAcceptedAt).toBeInstanceOf(Timestamp);
    expect(doc.createdAt).toBeInstanceOf(Timestamp);
    expect(doc.updatedAt).toBeInstanceOf(Timestamp);
  });

  it('作成の後、consentHistory は1件で kind が create（C-11）', async () => {
    const user = await signUpUser();
    await callBootstrap(user.token);
    const doc = (await userDoc(user.uid)).data()!;
    expect(doc.consentHistory).toHaveLength(1);
    expect(doc.consentHistory[0]).toMatchObject({ termsVersion: TERMS, privacyVersion: PRIVACY, kind: 'create' });
  });

  it('acceptedAt と termsAcceptedAt が同じ値（C-11）', async () => {
    const user = await signUpUser();
    await callBootstrap(user.token);
    const doc = (await userDoc(user.uid)).data()!;
    expect((doc.consentHistory[0].acceptedAt as Timestamp).isEqual(doc.termsAcceptedAt as Timestamp)).toBe(true);
  });

  it('版を古くして呼ぶと、版と同意日時を更新し、consentHistory に kind reconsent を足す（email と subscriptionCount は変えない）', async () => {
    const user = await signUpUser();
    const before = Timestamp.fromMillis(Date.UTC(2026, 0, 1));
    await seedUser(user.uid, {
      email: 'old@example.com',
      subscriptionCount: 3,
      termsVersion: OLD,
      privacyVersion: OLD,
      termsAcceptedAt: before,
      consentHistory: [{ termsVersion: OLD, privacyVersion: OLD, acceptedAt: before, kind: 'create' }],
    });
    const res = await callBootstrap(user.token);
    expect(res.status).toBe(200);
    const doc = (await userDoc(user.uid)).data()!;
    expect(doc).toMatchObject({ termsVersion: TERMS, privacyVersion: PRIVACY, email: 'old@example.com', subscriptionCount: 3 });
    expect(doc.consentHistory).toHaveLength(2);
    expect(doc.consentHistory[1]).toMatchObject({ termsVersion: TERMS, privacyVersion: PRIVACY, kind: 'reconsent' });
    expect((doc.consentHistory[1].acceptedAt as Timestamp).isEqual(doc.termsAcceptedAt as Timestamp)).toBe(true);
    expect((doc.termsAcceptedAt as Timestamp).toMillis()).toBeGreaterThan(before.toMillis());
  });

  it('20件ある人が再同意すると、21件目で最も古いものが消えて20件のまま（C-11）', async () => {
    const user = await signUpUser();
    const history = Array.from({ length: 20 }, (_, i) => ({
      termsVersion: `v${i}`,
      privacyVersion: `v${i}`,
      acceptedAt: Timestamp.fromMillis(Date.UTC(2026, 0, 1 + i)),
      kind: i === 0 ? 'create' : 'reconsent',
    }));
    await seedUser(user.uid, { termsVersion: OLD, privacyVersion: OLD, consentHistory: history });
    await callBootstrap(user.token);
    const doc = (await userDoc(user.uid)).data()!;
    expect(doc.consentHistory).toHaveLength(20);
    expect(doc.consentHistory[0].termsVersion).toBe('v1'); // 最も古い v0 が消えた
    expect(doc.consentHistory[19]).toMatchObject({ termsVersion: TERMS, kind: 'reconsent' });
  });

  it('版が同じなら何もしない（consentHistory も updatedAt も変えない）', async () => {
    const user = await signUpUser();
    await callBootstrap(user.token);
    const first = (await userDoc(user.uid)).data()!;
    const res = await callBootstrap(user.token);
    expect(res.status).toBe(200);
    expect(res.body?.data).toEqual({ uid: user.uid, initialized: true });
    const second = (await userDoc(user.uid)).data()!;
    expect(second.consentHistory).toHaveLength(1);
    expect((second.updatedAt as Timestamp).isEqual(first.updatedAt as Timestamp)).toBe(true);
  });

  it('No.17 bootstrap を同時に2回呼ぶと、users は1件、subscriptionCount は0、consentHistory は1件のまま', async () => {
    const user = await signUpUser();
    const [a, b] = await Promise.all([callBootstrap(user.token), callBootstrap(user.token)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const users = await adminDb().collection('users').get();
    expect(users.size).toBe(1);
    const doc = (await userDoc(user.uid)).data()!;
    expect(doc.subscriptionCount).toBe(0);
    expect(doc.consentHistory).toHaveLength(1);
    expect((doc.consentHistory[0].acceptedAt as Timestamp).isEqual(doc.termsAcceptedAt as Timestamp)).toBe(true);
  });

  it('No.17 サブスクが3件ある利用者で bootstrap をもう一度呼んでも、subscriptionCount は3のまま', async () => {
    const user = await signUpUser();
    await seedUser(user.uid, { subscriptionCount: 3 });
    const res = await callBootstrap(user.token);
    expect(res.status).toBe(200);
    expect((await userDoc(user.uid)).data()!.subscriptionCount).toBe(3);
    // 版が古い人の再同意でも変えない
    await adminDb().collection('users').doc(user.uid).update({ termsVersion: OLD });
    await callBootstrap(user.token);
    expect((await userDoc(user.uid)).data()!.subscriptionCount).toBe(3);
  });

  it('No.16 同意が無い（termsAccepted・privacyAccepted が true でない）と 400 VALIDATION_ERROR で、users を作らない', async () => {
    const user = await signUpUser();
    const res = await callBootstrap(user.token, bootstrapBody({ termsAccepted: false, privacyAccepted: 'yes' }));
    expect(res.status).toBe(400);
    expect(res.body?.error).toMatchObject({ code: 'VALIDATION_ERROR', field: 'termsAccepted', message: '入力内容を確認してください' });
    expect(res.body?.error.details.map((d: { field: string }) => d.field)).toEqual(['termsAccepted', 'privacyAccepted']);
    expect((await userDoc(user.uid)).exists).toBe(false);
  });

  it('版が無い・文字列でないときは 400（details は termsAccepted → privacyAccepted → termsVersion → privacyVersion の順）', async () => {
    const user = await signUpUser();
    const res = await callBootstrap(user.token, { termsAccepted: false, privacyAccepted: true, privacyVersion: 20261104 });
    expect(res.status).toBe(400);
    expect(res.body?.error.details.map((d: { field: string }) => d.field)).toEqual(['termsAccepted', 'termsVersion', 'privacyVersion']);
  });

  it('送られた版が現行と違う（空文字を含む）と 409 TERMS_RECONSENT_REQUIRED で、users を作らない', async () => {
    const user = await signUpUser();
    for (const body of [bootstrapBody({ termsVersion: OLD }), bootstrapBody({ privacyVersion: '' })]) {
      const res = await callBootstrap(user.token, body);
      expect(res.status).toBe(409);
      expect(res.body?.error).toMatchObject({ code: 'TERMS_RECONSENT_REQUIRED', message: '利用規約が更新されました。もう一度同意してください' });
    }
    expect((await userDoc(user.uid)).exists).toBe(false);
  });

  it('本文の検査（400）が版の一致（409）より先', async () => {
    const user = await signUpUser();
    const res = await callBootstrap(user.token, bootstrapBody({ termsAccepted: false, termsVersion: OLD }));
    expect(res.status).toBe(400);
  });

  it('未知のキー（uid・kind など）は 400 UNKNOWN_FIELD（画面から kind・uid は受け取らない）', async () => {
    const user = await signUpUser();
    const res = await callBootstrap(user.token, bootstrapBody({ kind: 'reconsent', uid: 'someone-else' }));
    expect(res.status).toBe(400);
    expect(res.body?.error).toMatchObject({ code: 'UNKNOWN_FIELD', field: 'kind' });
    expect((await userDoc(user.uid)).exists).toBe(false);
  });

  it('token が無ければ 401 UNAUTHENTICATED。uid は token から取る（他人の users は作れない）', async () => {
    const res = await callRoute(BOOTSTRAP, { method: 'POST', body: bootstrapBody() });
    expect(res.status).toBe(401);
    expect(res.body?.error.code).toBe('UNAUTHENTICATED');
    const a = await signUpUser();
    const b = await signUpUser();
    await callBootstrap(a.token);
    expect((await userDoc(a.uid)).exists).toBe(true);
    expect((await userDoc(b.uid)).exists).toBe(false);
  });

  it('No.55 削除済みアカウントの ID token で bootstrap を呼ぶと 401 で、users は作り直されない', async () => {
    const user = await signUpUser();
    await adminAuth().deleteUser(user.uid);
    const res = await callBootstrap(user.token);
    expect(res.status).toBe(401);
    expect(res.body?.error.code).toBe('UNAUTHENTICATED');
    expect((await userDoc(user.uid)).exists).toBe(false);
  });
});

describe('GET /api/account', () => {
  it('users の値と、Push 購読の件数・ID を返す（規約の版は調べない）', async () => {
    const user = await signUpUser();
    await seedUser(user.uid, { email: user.email, accountNotificationEnabled: false });
    const res = await callRoute(GET, { token: user.token, path: '/api/account' });
    expect(res.status).toBe(200);
    expect(res.body?.data).toEqual({
      email: user.email,
      accountNotificationEnabled: false,
      termsVersion: TERMS,
      privacyVersion: PRIVACY,
      pushSubscriptionCount: 0,
      pushSubscriptionIds: [],
    });
  });

  it('pushSubscriptionIds は webPushSubscriptions のドキュメントID の昇順（0件は空の配列。読んだ全部）', async () => {
    const user = await signUpUser();
    await seedUser(user.uid);
    const ids = ['c'.repeat(64), 'a'.repeat(64), 'b'.repeat(64)];
    const subs = adminDb().collection('users').doc(user.uid).collection('webPushSubscriptions');
    for (const id of ids) await subs.doc(id).set({ endpoint: `https://push.example.com/${id}`, p256dh: 'p', auth: 'a' });
    const res = await callRoute(GET, { token: user.token, path: '/api/account' });
    expect(res.status).toBe(200);
    expect(res.body?.data.pushSubscriptionIds).toEqual(['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)]);
    expect(res.body?.data.pushSubscriptionCount).toBe(3);
    expect(res.body?.data).not.toHaveProperty('endpoint');
  });

  it('accountNotificationEnabled の項目が無い users は true として返す', async () => {
    const user = await signUpUser();
    await seedUser(user.uid);
    await adminDb().collection('users').doc(user.uid).update({ accountNotificationEnabled: FieldValue.delete() });
    const res = await callRoute(GET, { token: user.token, path: '/api/account' });
    expect(res.body?.data.accountNotificationEnabled).toBe(true);
  });

  it('No.29 users/{uid} が無いと GET /api/account は 404 NOT_FOUND', async () => {
    const user = await signUpUser();
    const res = await callRoute(GET, { token: user.token, path: '/api/account' });
    expect(res.status).toBe(404);
    expect(res.body?.error.code).toBe('NOT_FOUND');
  });

  it('token が無ければ 401 UNAUTHENTICATED', async () => {
    const res = await callRoute(GET, { path: '/api/account' });
    expect(res.status).toBe(401);
    expect(res.body?.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('No.57 保存された規約・ポリシーの版が現行と違う（lib/account.ts の関数を直接呼ぶ）', () => {
  it('No.57 requireInitialized（bootstrap・GET /api/account・DELETE 以外の API の検査）は 409 TERMS_RECONSENT_REQUIRED', async () => {
    const user = await signUpUser();
    await seedUser(user.uid, { termsVersion: OLD });
    await expect(requireInitialized(user.uid)).rejects.toMatchObject({ status: 409, code: 'TERMS_RECONSENT_REQUIRED' });
    await adminDb().collection('users').doc(user.uid).update({ termsVersion: TERMS, privacyVersion: OLD });
    await expect(requireInitialized(user.uid)).rejects.toBeInstanceOf(HttpError);
    await expect(requireInitialized(user.uid)).rejects.toMatchObject({ status: 409, code: 'TERMS_RECONSENT_REQUIRED' });
  });

  it('No.57 版を調べない所（checkTerms: false・getAccount・bootstrapAccount）は 409 にならない', async () => {
    const user = await signUpUser();
    await seedUser(user.uid, { termsVersion: OLD, privacyVersion: OLD });
    await expect(requireInitialized(user.uid, { checkTerms: false })).resolves.toMatchObject({ uid: user.uid });
    await expect(getAccount(user.uid)).resolves.toMatchObject({ termsVersion: OLD, privacyVersion: OLD });
    await expect(bootstrapAccount(user.uid, user.email, { termsVersion: TERMS, privacyVersion: PRIVACY })).resolves.toEqual({
      uid: user.uid,
      initialized: true,
    });
    await expect(requireInitialized(user.uid)).resolves.toMatchObject({ termsVersion: TERMS, privacyVersion: PRIVACY });
  });

  it('No.57 版が現行と同じなら requireInitialized は users を返す。users が無ければ 409 ACCOUNT_NOT_INITIALIZED', async () => {
    const user = await signUpUser();
    await expect(requireInitialized(user.uid)).rejects.toMatchObject({ status: 409, code: 'ACCOUNT_NOT_INITIALIZED' });
    await seedUser(user.uid);
    await expect(requireInitialized(user.uid)).resolves.toMatchObject({ uid: user.uid });
  });
});

// ===== C-19：ログインは Google だけ =====
describe('Google 以外でログインした token（決まりの一覧 C-19）', () => {
  it('メールとパスワードでログインした token は、bootstrap も GET /api/account も 401 UNAUTHENTICATED（users を作らない）', async () => {
    const res = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `password${Date.now()}@example.com`, password: 'password1234', returnSecureToken: true }),
    });
    const { localId, idToken } = (await res.json()) as { localId: string; idToken: string };
    const bootstrap = await callBootstrap(idToken);
    expect(bootstrap.status).toBe(401);
    expect(bootstrap.body?.error?.code).toBe('UNAUTHENTICATED');
    expect((await userDoc(localId)).exists).toBe(false);
    const account = await callRoute(GET, { token: idToken, path: '/api/account' });
    expect(account.status).toBe(401);
    expect(account.body?.error?.code).toBe('UNAUTHENTICATED');
  });

  it('Google でログインした token は通る（signUpUser は Google のアカウント）', async () => {
    const user = await signUpUser();
    expect((await callBootstrap(user.token)).status).toBe(200);
  });
});
