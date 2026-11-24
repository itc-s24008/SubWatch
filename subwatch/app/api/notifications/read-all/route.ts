// POST /api/notifications/read-all（API一覧 No.16。04-21）。直近90日の未読を400件ずつ既読にする
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { requireInitialized } from '@/lib/account';
import { requireAuth } from '@/lib/auth';
import { ok, withApi } from '@/lib/http';
import { markAllNotificationsRead } from '@/lib/notifications';

// 1. 認証 → 2・2b. users と規約の版 → 既読（本文は読まない）→ 200 {updatedCount}
export const POST = withApi(async (req) => {
  const user = await requireAuth(req);
  await requireInitialized(user.uid);
  return ok(await markAllNotificationsRead(user.uid, { now: new Date() }));
});
