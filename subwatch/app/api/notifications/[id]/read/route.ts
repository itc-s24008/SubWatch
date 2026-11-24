// POST /api/notifications/:id/read（API一覧 No.15。04-21）。1件を既読にする（既読の巻き戻しなし）
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { requireInitialized } from '@/lib/account';
import { requireAuth } from '@/lib/auth';
import { ok, withApi } from '@/lib/http';
import { markNotificationRead } from '@/lib/notifications';

// 1. 認証 → 2・2b. users と規約の版 → 3. :id（64桁の小文字16進でない・無い・他人のものは404）と既読（本文は読まない）→ 200 {viewedAt}
export const POST = withApi<{ id: string }>(async (req, { params }) => {
  const user = await requireAuth(req);
  await requireInitialized(user.uid);
  const { id } = await params;
  return ok(await markNotificationRead(user.uid, id, { now: new Date() }));
});
