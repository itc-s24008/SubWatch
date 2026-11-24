// /api/account（API一覧 No.2・3・4）。みんなが足すファイル：04-05 が GET、04-17 が DELETE、04-21 が PATCH を、自分の見出しの下に足す
// route.ts からは、HTTP メソッドの関数と route segment config だけを export する
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ===== 04-05：GET /api/account =====
import { getAccount } from '@/lib/account';
import { requireAuth } from '@/lib/auth';
import { ok, withApi } from '@/lib/http';

// 1. 認証 → users/{uid} を読む（無ければ 404 NOT_FOUND。初期設定と規約の版の検査〔2・2b〕はしない。API共通仕様 B6）
export const GET = withApi(async (req) => {
  const user = await requireAuth(req);
  return ok(await getAccount(user.uid));
});

// ===== 04-17：DELETE /api/account ここに足す =====
import { DELETE_ACCOUNT_KEYS, deleteAccount, requireRecentAuth, validateDeleteConfirmation } from '@/lib/account-delete';
import { readJsonBody, rejectUnknownKeys } from '@/lib/http';

// 検査の順序（API共通仕様 B101）：ID token（checkRevoked: true。401 UNAUTHENTICATED）→ auth_time（5分以内でなければ 401 REAUTH_REQUIRED）→
// 本文（Content-Type・JSON・未知のキー・confirmation:'DELETE'）→ 削除（データ → Auth → 後片づけ）→ 200 {status:'deleted'}
// requireInitialized は呼ばない（users/{uid} が無くても削除できる。S-13 の「アカウントを削除する」から呼ばれるため）
export const DELETE = withApi(async (req) => {
  const user = await requireAuth(req, { checkRevoked: true });
  requireRecentAuth(user.authTime); // サーバーの実際の時刻で判定する
  const body = await readJsonBody(req);
  rejectUnknownKeys(body, DELETE_ACCOUNT_KEYS);
  validateDeleteConfirmation(body);
  return ok(await deleteAccount(user.uid));
});

// ===== 04-21：PATCH /api/account ここに足す =====
import { requireInitialized, UPDATE_ACCOUNT_KEYS, updateAccountNotification, validateUpdateAccountBody } from '@/lib/account';

// 検査の順序（API共通仕様 B6・B56）：ID token（401）→ users/{uid} と規約の版（requireInitialized。409 ACCOUNT_NOT_INITIALIZED・
// TERMS_RECONSENT_REQUIRED）→ 本文（Content-Type・JSON。400）→ 未知のキー（400 UNKNOWN_FIELD）→ 真偽値か（400 VALIDATION_ERROR）→
// 書き込み（update だけ。同じ値なら書かない）→ 200 {accountNotificationEnabled}
export const PATCH = withApi(async (req) => {
  const user = await requireAuth(req);
  const saved = await requireInitialized(user.uid);
  const body = await readJsonBody(req);
  rejectUnknownKeys(body, UPDATE_ACCOUNT_KEYS);
  const { accountNotificationEnabled } = validateUpdateAccountBody(body);
  return ok(await updateAccountNotification(user.uid, saved, accountNotificationEnabled));
});
