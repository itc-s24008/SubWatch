// GET /api/dashboard（API一覧 No.10。04-09）。ホーム（S-03）の集計
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { requireInitialized } from '@/lib/account';
import { requireAuth } from '@/lib/auth';
import { todayJST } from '@/lib/clock';
import { getDashboard } from '@/lib/dashboard';
import { ok, withApi } from '@/lib/http';

// 1. 認証 → 2・2b. users と規約の版（集計では users をもう一度読まない。API共通仕様 B11）→ 7. 集計（本文は読まない）
export const GET = withApi(async (req) => {
  const user = await requireAuth(req);
  await requireInitialized(user.uid);
  const now = new Date();
  return ok(await getDashboard(user.uid, { today: todayJST(now), now }));
});
