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

// ===== 04-21：PATCH /api/account ここに足す =====
