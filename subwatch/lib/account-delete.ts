// アカウント削除（サーバー。04-17。機能設計書 詳細_F-07、API一覧 No.4、API共通仕様 B101〜B104、DB設計書 3.補足設計 B15）
//
//   isRecentAuth(authTime, now)：auth_time（秒）が5分以内か。now はミリ秒（既定 Date.now()）。テストでは now を渡す
//     サーバーの現在時刻 − auth_time が300秒以下なら true（ちょうど300秒も true。未来の auth_time も true）。
//     auth_time が無い・数でないときは false（API共通仕様 B102）
//   requireRecentAuth(authTime, now?)：isRecentAuth が false なら 401 REAUTH_REQUIRED を投げる
//   DELETE_ACCOUNT_KEYS：本文で受け付けるキー（route が rejectUnknownKeys に渡す）
//   validateDeleteConfirmation(body)：confirmation が 'DELETE' と完全一致しなければ 400 VALIDATION_ERROR（field=confirmation）
//   deleteAccount(uid, deps?)：データ → Auth → もう一度データ（後片づけ）の順に消し、{ status: 'deleted' } を返す
//     ・1回目のデータの削除か Auth の削除が失敗したら 500 DELETE_FAILED（データの削除が失敗したときは Auth を消さない）
//     ・後片づけは、先に users/{uid} のドキュメントを消してから配下を消す。失敗したら合わせて3回まで行い、
//       3回とも失敗しても成功を返す（ログに code DELETE_CLEANUP_FAILED だけを出す。uid は出さない。Firestore には記録しない）
//     ・deps はテストの差し替え口（省略すると下の本物の処理）
// users の存在確認はしない（users が無くても削除できる。requireInitialized を呼ばない。決まりの一覧 C-8）
import { HttpError } from '@/lib/errors';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import type { DeleteAccountResult } from '@/lib/types';

export const REAUTH_WINDOW_SECONDS = 300; // 5分

export function isRecentAuth(authTime: unknown, now: number = Date.now()): boolean {
  if (typeof authTime !== 'number' || !Number.isFinite(authTime)) return false;
  // auth_time は秒。ミリ秒の now と比べるので1000倍する
  return now - authTime * 1000 <= REAUTH_WINDOW_SECONDS * 1000;
}

export function requireRecentAuth(authTime: unknown, now: number = Date.now()): void {
  if (!isRecentAuth(authTime, now)) throw new HttpError(401, 'REAUTH_REQUIRED');
}

export const DELETE_ACCOUNT_KEYS = ['confirmation'] as const;

// 未知のキーの確認（rejectUnknownKeys）の後に呼ぶ。'delete'・前後に空白・文字列でない・無い は、すべて 400
export function validateDeleteConfirmation(body: Record<string, unknown>): void {
  if (body.confirmation === 'DELETE') return;
  const message = '入力内容を確認してください';
  throw new HttpError(400, 'VALIDATION_ERROR', message, {
    field: 'confirmation',
    details: [{ field: 'confirmation', code: 'VALIDATION_ERROR', message }],
  });
}

// ---- 本物の処理（テストからも使う） ----

function userRef(uid: string) {
  return adminDb().collection('users').doc(uid);
}

// 1回目：users/{uid} を配下（subscriptions・notificationEvents・webPushSubscriptions）ごと再帰削除する。
// 親のドキュメントが無くても配下を消す
export async function deleteUserTree(uid: string): Promise<void> {
  await adminDb().recursiveDelete(userRef(uid));
}

function authErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object') {
    const withCode = error as { code?: unknown; errorInfo?: { code?: unknown } };
    if (typeof withCode.code === 'string') return withCode.code;
    if (typeof withCode.errorInfo?.code === 'string') return withCode.errorInfo.code;
  }
  return undefined;
}

// Firebase Authentication のユーザーを消す。すでに無いときは成功として扱う（API共通仕様 B103）
export async function deleteAuthUser(uid: string): Promise<void> {
  try {
    await adminAuth().deleteUser(uid);
  } catch (error) {
    if (authErrorCode(error) === 'auth/user-not-found') return;
    throw error;
  }
}

// 後片づけ（1回分）：先に users/{uid} のドキュメントを消し（配下への新しい書き込みを止める）、それから配下を再帰削除する
export async function cleanupUserTree(uid: string): Promise<void> {
  const ref = userRef(uid);
  await ref.delete();
  await adminDb().recursiveDelete(ref);
}

export const CLEANUP_ATTEMPTS = 3;

export interface DeleteAccountDeps {
  deleteUserTree?: (uid: string) => Promise<void>;
  deleteAuthUser?: (uid: string) => Promise<void>;
  cleanupUserTree?: (uid: string) => Promise<void>;
  log?: (line: string) => void; // 後片づけが3回とも失敗したときの1行（既定は console.error）
}

export async function deleteAccount(uid: string, deps: DeleteAccountDeps = {}): Promise<DeleteAccountResult> {
  const removeTree = deps.deleteUserTree ?? deleteUserTree;
  const removeAuth = deps.deleteAuthUser ?? deleteAuthUser;
  const cleanup = deps.cleanupUserTree ?? cleanupUserTree;
  const log = deps.log ?? ((line: string) => console.error(line));

  // 5. データ（失敗したら Auth を消さずに 500。もう一度呼べば最初からやり直せる）
  try {
    await removeTree(uid);
  } catch {
    throw new HttpError(500, 'DELETE_FAILED'); // 内部の理由は返さない・出さない
  }

  // 6. Auth
  try {
    await removeAuth(uid);
  } catch {
    throw new HttpError(500, 'DELETE_FAILED');
  }

  // 6-2. 後片づけ（Auth はもう無く、やり直せないので、3回とも失敗しても成功を返す）
  let cleaned = false;
  for (let attempt = 1; attempt <= CLEANUP_ATTEMPTS && !cleaned; attempt += 1) {
    try {
      await cleanup(uid);
      cleaned = true;
    } catch {
      // 次の回へ
    }
  }
  if (!cleaned) {
    try {
      log(JSON.stringify({ code: 'DELETE_CLEANUP_FAILED' })); // code だけ（uid・メールアドレスは出さない）
    } catch {
      // ログの失敗で結果を変えない
    }
  }

  // 7.
  return { status: 'deleted' };
}
