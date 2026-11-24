// POST /api/account/bootstrap（API一覧 No.1。04-05）。users/{uid} を作る・規約の版を更新する
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { BOOTSTRAP_KEYS, bootstrapAccount, validateBootstrapBody } from '@/lib/account';
import { requireAuth } from '@/lib/auth';
import { ok, readJsonBody, rejectUnknownKeys, withApi } from '@/lib/http';

// 1. 認証（checkRevoked: true。削除済みのアカウントの token で users を作り直さない。No.55）
// 2・2b は行わない（bootstrap は users が無くても、版が古くても呼べる）→ 4. 本文 → 5. 未知のキー → 6. 項目の検査（400）→ 版の一致（409）→ 7. transaction
export const POST = withApi(async (req) => {
  const user = await requireAuth(req, { checkRevoked: true });
  const body = await readJsonBody(req);
  rejectUnknownKeys(body, BOOTSTRAP_KEYS);
  const versions = validateBootstrapBody(body);
  return ok(await bootstrapAccount(user.uid, user.email, versions));
});
