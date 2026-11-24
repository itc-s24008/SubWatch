// GET /api/notifications?filter=all|unread|billing|trial_end&limit=1..50&cursor=（API一覧 No.14。04-21）。通知センター（S-08）の一覧
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { requireInitialized } from '@/lib/account';
import { requireAuth } from '@/lib/auth';
import { ok, withApi } from '@/lib/http';
import { listNotifications, parseNotificationListQuery } from '@/lib/notifications';

// 1. 認証 → 2・2b. users と規約の版 → クエリの検査（2b の後。ログインしていなければ、クエリが不正でも401。API共通仕様 B6）→ 一覧
export const GET = withApi(async (req) => {
  const user = await requireAuth(req);
  await requireInitialized(user.uid);
  const query = parseNotificationListQuery(new URL(req.url).searchParams);
  return ok(await listNotifications(user.uid, query, { now: new Date() }));
});
