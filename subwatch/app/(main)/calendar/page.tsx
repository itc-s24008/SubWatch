// S-07 請求カレンダー画面（04-13） の空のページ（04-01 が置く。中身は担当が作る）
import { PageTitle } from '@/components/ui';

export default function Page() {
  return (
    <>
      <PageTitle>請求カレンダー</PageTitle>
      <main className="p-4">
        <p className="text-gray-500">（この画面は、担当のタスクが作る）</p>
      </main>
    </>
  );
}
