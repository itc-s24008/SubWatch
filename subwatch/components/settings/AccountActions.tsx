'use client';
// S-09 の部品：⑨ログアウト（04-05。画面設計書 S-09 ⑨、詳細_F-02 の手順6）
// ⑧パスワードを再設定は、ログインを Google だけにしたので無くした（決まりの一覧 C-19。パスワードは Google のアカウントで管理する）
// ⑨：logout() を呼ぶ（この端末の Push 購読の解除〔04-12 が登録する〕とサインアウト。失敗しても文を出さずに続ける）。
//     S-02 への移動は Gates（未ログインになったら router.replace('/login')）
import { useState } from 'react';
import { logout } from '@/lib/logout';

const ROW =
  'flex min-h-11 w-full items-center rounded-2xl border border-gray-200 bg-white px-4 py-4 text-left text-base font-bold hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400';

export function AccountActions() {
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    if (busy) return;
    setBusy(true);
    await logout();
    setBusy(false);
  }

  return (
    <button type="button" className={ROW} onClick={() => void handleLogout()} disabled={busy}>
      ログアウト
    </button>
  );
}
