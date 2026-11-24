'use client';
// 開いたサブスクが無いとき（404。他人の ID・存在しない ID）の表示（04-08。S-06 と S-05 の編集で使う）
// 「見つかりません」と［一覧へ戻る］（S-04 へ）。画面設計書 画面一覧 S-06 F7・状態・ダイアログ一覧 S-06 の28行・S-05 の48行
// （Push から開いたときに S-08 へ移すのは 04-19）
import { Button } from '@/components/ui';

export function SubscriptionNotFound() {
  return (
    <div className="p-6 text-center">
      <p className="text-lg font-bold">見つかりません</p>
      <Button variant="secondary" href="/subscriptions" className="mt-4">
        一覧へ戻る
      </Button>
    </div>
  );
}
