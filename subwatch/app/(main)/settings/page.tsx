// S-09 設定画面の枠（共通ファイル）。図と同じ見出し（「通知」「アカウント」）と、上から次の順に部品を置く
//   ②AccountInfo（04-05）／「通知」③NotificationSection（04-21）・④⑤⑦と⑥PushSection（04-12）／
//   「アカウント」⑧⑨AccountActions（04-05）・⑩DeleteAccount（04-17）／⑪LegalLinks（04-19）／⑫下部ナビ（layout）
// 各部品の中身は担当が書く。この枠は変えない
import { DeleteAccount } from '@/components/DeleteAccount';
import { AccountActions } from '@/components/settings/AccountActions';
import { AccountInfo } from '@/components/settings/AccountInfo';
import { LegalLinks } from '@/components/settings/LegalLinks';
import { NotificationSection } from '@/components/settings/NotificationSection';
import { PushSection } from '@/components/settings/PushSection';
import { PageTitle } from '@/components/ui';

export default function SettingsPage() {
  return (
    <>
      <PageTitle>設定</PageTitle>
      <main className="flex flex-col gap-3 p-4">
        <AccountInfo />
        <section aria-labelledby="settings-notification" className="flex flex-col gap-3">
          <h2 id="settings-notification" className="mt-2 text-lg font-bold">
            通知
          </h2>
          <NotificationSection />
          <PushSection />
        </section>
        <section aria-labelledby="settings-account" className="flex flex-col gap-3">
          <h2 id="settings-account" className="mt-2 text-lg font-bold">
            アカウント
          </h2>
          <AccountActions />
          <DeleteAccount />
        </section>
        <LegalLinks />
      </main>
    </>
  );
}
