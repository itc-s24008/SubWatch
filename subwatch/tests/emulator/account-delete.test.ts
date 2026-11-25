// DELETE /api/account（04-17。API一覧 No.4、詳細_F-07、API共通仕様 B101〜B104、DB設計書 3.補足設計 B15）
// テスト一覧の No.36・38（API の部分）・53・54 と、番号なしの：他人のデータが消えない・削除の途中に書き込まれたデータが残らない（後片づけ）・
// 本文の検査（5分以内なら auth_time の確認を通り、本文の誤りの 400 で止まる。削除まで進めない）・users が無くても・規約の版が古くても削除できる
// 削除を伴うので偽の時刻（Date の差し替え）は使わない（0.実装構成 B18）。No.37（5分を過ぎた）は tests/unit/account-delete.test.ts
import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { DELETE } from '@/app/api/account/route';
import { deleteAccount, deleteAuthUser, deleteUserTree } from '@/lib/account-delete';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { callRoute, resetEmulators, seedSubscriptions, seedUser, signInWithGoogleEmulator, signUpUser } from './helpers';


function callDelete(token: string | undefined, body: unknown = { confirmation: 'DELETE' }) {
  return callRoute(DELETE, { method: 'DELETE', token, body, path: '/api/account' });
}

function userRef(uid: string) {
  return adminDb().collection('users').doc(uid);
}

// 配下の3つのコレクションに1件ずつ置く（Push 購読・通知の道具は 04-12・04-14 が作るので、ここでは Firestore に直接置く）
async function seedChildren(uid: string): Promise<void> {
  await seedSubscriptions(uid, [{ serviceName: 'Netflix' }, { serviceName: 'Spotify' }]);
  const now = Timestamp.now();
  await userRef(uid).collection('notificationEvents').doc('event0001').set({ uid, notificationType: 'billing', createdAt: now });
  await userRef(uid).collection('webPushSubscriptions').doc('push0001').set({ uid, endpoint: 'https://push.example.com/1', createdAt: now });
}

// users/{uid} の文書と配下の件数（文書が無くても配下を数える）
async function remaining(uid: string): Promise<{ userDoc: boolean; children: number }> {
  const userDoc = (await userRef(uid).get()).exists;
  let children = 0;
  for (const collection of await userRef(uid).listCollections()) {
    children += (await collection.get()).size;
  }
  return { userDoc, children };
}

async function authExists(uid: string): Promise<boolean> {
  try {
    await adminAuth().getUser(uid);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  await resetEmulators();
});

describe('DELETE /api/account', () => {
  it('No.36 再認証が5分以内なら削除でき、uid 配下のデータと Auth が消え、同じ Google アカウントで登録し直せる', async () => {
    const user = await signUpUser();
    await seedUser(user.uid, { email: user.email });
    await seedChildren(user.uid);
    expect(await remaining(user.uid)).toEqual({ userDoc: true, children: 4 });

    const res = await callDelete(user.token);
    expect(res.status).toBe(200);
    expect(res.body?.data).toEqual({ status: 'deleted' });
    expect(res.body?.error).toBeNull();

    expect(await remaining(user.uid)).toEqual({ userDoc: false, children: 0 });
    expect(await authExists(user.uid)).toBe(false);

    const again = await signInWithGoogleEmulator(user.email);
    expect(again.ok).toBe(true);
    expect(again.uid).not.toBe(user.uid);
  });

  it('No.36 users/{uid} が無くても（S-13 の「アカウントを削除する」から）削除でき、残っていた配下も消える', async () => {
    const user = await signUpUser();
    await seedChildren(user.uid); // users の文書は無く、配下だけある（前回の途中失敗の続き）
    const res = await callDelete(user.token);
    expect(res.status).toBe(200);
    expect(res.body?.data).toEqual({ status: 'deleted' });
    expect(await remaining(user.uid)).toEqual({ userDoc: false, children: 0 });
    expect(await authExists(user.uid)).toBe(false);
  });

  it('規約の版が古い users でも削除できる（版を調べない）', async () => {
    const user = await signUpUser();
    await seedUser(user.uid, { termsVersion: '2000-01-01', privacyVersion: '2000-01-01' });
    const res = await callDelete(user.token);
    expect(res.status).toBe(200);
    expect(await remaining(user.uid)).toEqual({ userDoc: false, children: 0 });
  });

  it('他人のデータと Auth は消えない', async () => {
    const me = await signUpUser();
    const other = await signUpUser();
    await seedUser(me.uid);
    await seedChildren(me.uid);
    await seedUser(other.uid);
    await seedChildren(other.uid);

    const res = await callDelete(me.token);
    expect(res.status).toBe(200);
    expect(await remaining(me.uid)).toEqual({ userDoc: false, children: 0 });
    expect(await remaining(other.uid)).toEqual({ userDoc: true, children: 4 });
    expect(await authExists(other.uid)).toBe(true);
  });

  it('No.38 削除の途中で失敗すると 500 DELETE_FAILED（Auth は消さない）。もう一度呼ぶと最初から実行されて完了する', async () => {
    const user = await signUpUser();
    await seedUser(user.uid);
    await seedChildren(user.uid);

    // 1回目：サブスクだけ消したところで失敗させる
    const failing = deleteAccount(user.uid, {
      deleteUserTree: async (uid) => {
        await adminDb().recursiveDelete(userRef(uid).collection('subscriptions'));
        throw new Error('途中で失敗');
      },
    });
    await expect(failing).rejects.toMatchObject({ status: 500, code: 'DELETE_FAILED' });
    expect(await authExists(user.uid)).toBe(true);
    expect(await remaining(user.uid)).toEqual({ userDoc: true, children: 2 });

    // 2回目：同じ token でもう一度（すでに消えたデータは無視して続ける）
    const res = await callDelete(user.token);
    expect(res.status).toBe(200);
    expect(res.body?.data).toEqual({ status: 'deleted' });
    expect(await remaining(user.uid)).toEqual({ userDoc: false, children: 0 });
    expect(await authExists(user.uid)).toBe(false);
  });

  it('No.53 Auth ユーザーの削除だけが失敗したとき、もう一度削除すると users が無くても完了する', async () => {
    const user = await signUpUser();
    await seedUser(user.uid);
    await seedChildren(user.uid);

    await expect(
      deleteAccount(user.uid, {
        deleteAuthUser: async () => {
          throw new Error('Auth の削除だけが失敗');
        },
      }),
    ).rejects.toMatchObject({ status: 500, code: 'DELETE_FAILED' });
    expect(await remaining(user.uid)).toEqual({ userDoc: false, children: 0 }); // データは消えている
    expect(await authExists(user.uid)).toBe(true); // Auth は残っている

    const res = await callDelete(user.token);
    expect(res.status).toBe(200);
    expect(res.body?.data).toEqual({ status: 'deleted' });
    expect(await authExists(user.uid)).toBe(false);
  });

  it('No.54 削除が成功した後に同じ呼び出しをもう一度送ると 401 UNAUTHENTICATED', async () => {
    const user = await signUpUser();
    await seedUser(user.uid);
    expect((await callDelete(user.token)).status).toBe(200);
    const again = await callDelete(user.token);
    expect(again.status).toBe(401);
    expect(again.body?.error.code).toBe('UNAUTHENTICATED');
    expect(again.body?.data).toBeNull();
  });

  it('1回目の削除の後（Auth を消す前）に別の端末から書き込まれたデータも、後片づけで残らない', async () => {
    const user = await signUpUser();
    await seedUser(user.uid);
    await seedChildren(user.uid);

    const result = await deleteAccount(user.uid, {
      deleteUserTree,
      // 1回目のデータの削除の後、Auth を消す前に、別の端末から同意（users の作り直し）・登録・購読が届いた
      deleteAuthUser: async (uid) => {
        expect(await remaining(uid)).toEqual({ userDoc: false, children: 0 });
        await seedUser(uid);
        await seedChildren(uid);
        expect(await remaining(uid)).toEqual({ userDoc: true, children: 4 });
        await deleteAuthUser(uid);
      },
    });
    expect(result).toEqual({ status: 'deleted' });
    expect(await remaining(user.uid)).toEqual({ userDoc: false, children: 0 });
    expect(await authExists(user.uid)).toBe(false);
  });

  it('Auth ユーザーがすでに無いときは成功として扱う（deleteAuthUser）', async () => {
    const user = await signUpUser();
    await adminAuth().deleteUser(user.uid);
    await expect(deleteAuthUser(user.uid)).resolves.toBeUndefined();
  });
});

describe('DELETE /api/account の検査の順序（API共通仕様 B101）', () => {
  it('token が無いと 401 UNAUTHENTICATED', async () => {
    const res = await callDelete(undefined);
    expect(res.status).toBe(401);
    expect(res.body?.error.code).toBe('UNAUTHENTICATED');
  });

  it('再認証が5分以内なら auth_time の確認を通り、本文の誤りの 400 で止まる（削除まで進めない）', async () => {
    const user = await signUpUser();
    await seedUser(user.uid);
    await seedChildren(user.uid);

    // 本文が無い（Content-Type も無い）
    const noBody = await callRoute(DELETE, { method: 'DELETE', token: user.token, path: '/api/account' });
    expect(noBody.status).toBe(400);
    expect(noBody.body?.error.code).toBe('VALIDATION_ERROR');

    // confirmation が 'DELETE' と完全一致しない
    for (const confirmation of ['delete', ' DELETE ', 'DELETE ', 1, null]) {
      const res = await callDelete(user.token, { confirmation });
      expect(res.status).toBe(400);
      expect(res.body?.error).toMatchObject({ code: 'VALIDATION_ERROR', field: 'confirmation', message: '入力内容を確認してください' });
    }
    const missing = await callDelete(user.token, {});
    expect(missing.status).toBe(400);
    expect(missing.body?.error).toMatchObject({ code: 'VALIDATION_ERROR', field: 'confirmation' });

    // 未知のキー
    const unknown = await callDelete(user.token, { confirmation: 'DELETE', uid: user.uid });
    expect(unknown.status).toBe(400);
    expect(unknown.body?.error).toMatchObject({ code: 'UNKNOWN_FIELD', field: 'uid' });

    // どれも何も消していない
    expect(await remaining(user.uid)).toEqual({ userDoc: true, children: 4 });
    expect(await authExists(user.uid)).toBe(true);
  });
});
