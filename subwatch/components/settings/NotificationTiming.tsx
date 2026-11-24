// S-09 ⑥通知タイミング（固定）（04-12。画面設計書 S-09 ⑥、決まりの一覧 B-5）
// withoutPush：Web Push を削ったときは true（S-09 の枠の <PushSection /> を <NotificationTiming withoutPush /> に替える）
import { Card } from '@/components/ui';

export const NOTIFICATION_TIMING_TEXT = '請求日・最終無料日の7日前と1日前にお知らせします（毎日、日本時間9時台（遅れると11時台か18時台）に判定）';
export const NOTIFICATION_TIMING_TEXT_WITHOUT_PUSH =
  '請求日・最終無料日の7日前と1日前に、通知センターでお知らせします（毎日、日本時間9時台（遅れると11時台か18時台）に判定）';

export function NotificationTiming({ withoutPush = false }: { withoutPush?: boolean }) {
  return (
    <Card>
      <h3 className="font-bold">通知タイミング（固定）</h3>
      <p className="mt-1 text-sm text-gray-600">{withoutPush ? NOTIFICATION_TIMING_TEXT_WITHOUT_PUSH : NOTIFICATION_TIMING_TEXT}</p>
    </Card>
  );
}
