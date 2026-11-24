// GET /api/cron/daily（日次の通知処理。API一覧 No.17。04-14）。Vercel Cron が毎日3回（日本時間9時台・11時台・18時台）呼ぶ
// route は認証と呼び出しだけ。締切の確認と各段階は lib/cron.ts（機能設計書 0.実装構成 B18、API共通仕様 B88）
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { resolveRunDate, runDailyCron, verifyCronSecret } from '@/lib/cron';
import { ok, withApi } from '@/lib/http';
import { pushSender } from '@/lib/push';

export const GET = withApi(async (req) => {
  verifyCronSecret(req); // 1. Authorization: Bearer CRON_SECRET（違えば 401 INVALID_CRON_SECRET。認証が先）
  const runDate = resolveRunDate(req); // 2. 日本時間の今日（ALLOW_CRON_RUNDATE_OVERRIDE=true のときだけ ?runDate）
  // 3. Push の送信は、04-15 の lib/push.ts が export する pushSender（11/25 のα版の統合で、仮の noopPushSender から差し替えた。ここの1か所）。
  //    Web Push の送信を外すときは、ここを lib/cron.ts の noopPushSender に戻す（通知イベントは作り続ける。統合の指示書・手順書 05）
  const result = await runDailyCron({ runDate, pushSender });
  return ok(result);
});
