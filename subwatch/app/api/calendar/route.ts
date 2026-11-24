// GET /api/calendar?month=YYYY-MM（API一覧 No.11。04-13）。請求カレンダー（S-07）の月の集計
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { requireInitialized } from '@/lib/account';
import { requireAuth } from '@/lib/auth';
import { calendarMonthOf, isCalendarMonth } from '@/lib/calendar';
import { todayJST } from '@/lib/clock';
import { getCalendar } from '@/lib/dashboard';
import { ERROR_MESSAGES, HttpError } from '@/lib/errors';
import { ok, withApi } from '@/lib/http';

// month の検査（API共通仕様 B25・B77）：
//   省略 → 日本時間の今月／空文字（?month=）・形が違う・年が 2000〜2100 の外 → 400 VALIDATION_ERROR（field=month、details にも month）
//   month が2つ以上あるときは最初の1つだけを見る（URLSearchParams.get が最初の値を返す）。ほかのクエリは無視する
function resolveMonth(req: Request): string {
  const value = new URL(req.url).searchParams.get('month');
  if (value === null) return calendarMonthOf(todayJST());
  if (!isCalendarMonth(value)) {
    const message = ERROR_MESSAGES.VALIDATION_ERROR;
    throw new HttpError(400, 'VALIDATION_ERROR', message, {
      field: 'month',
      details: [{ field: 'month', code: 'VALIDATION_ERROR', message }],
    });
  }
  return value;
}

// 1. 認証 → 2・2b. users と規約の版 → クエリの検査（2b の後。ログインしていなければ、クエリが不正でも 401）→ 集計
export const GET = withApi(async (req) => {
  const user = await requireAuth(req);
  await requireInitialized(user.uid);
  const month = resolveMonth(req);
  return ok(await getCalendar(user.uid, { month }));
});
