'use client';
// S-09 の部品：⑧パスワードを再設定・⑨ログアウト（04-05。画面設計書 S-09 ⑧⑨、詳細_F-02 の手順4・6）
// ⑧：ログイン中のメールアドレスに再設定メールを送る。文（送った・送れない）は、このボタンのすぐ下に出す
// ⑨：logout() を呼ぶ（この端末の Push 購読の解除〔04-12 が登録する〕とサインアウト。失敗しても文を出さずに続ける）。
//     S-02 への移動は Gates（未ログインになったら router.replace('/login')）
import { sendPasswordResetEmail } from 'firebase/auth';
import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { AUTH_MESSAGES, resetResultOf } from '@/lib/auth-flow';
import { getFirebaseAuth } from '@/lib/firebase-client';
import { logout } from '@/lib/logout';

const ROW =
  'flex min-h-11 w-full items-center rounded-2xl border border-gray-200 bg-white px-4 py-4 text-left text-base font-bold hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400';

type Notice = { kind: 'info' | 'error'; text: string } | null;

export function AccountActions() {
  const { user } = useAuth();
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<'reset' | 'logout' | null>(null);

  async function handleReset() {
    if (busy) return;
    setBusy('reset');
    setNotice(null);
    const email = user?.email ?? getFirebaseAuth().currentUser?.email ?? '';
    let result: ReturnType<typeof resetResultOf> = 'failed';
    if (email) {
      try {
        await sendPasswordResetEmail(getFirebaseAuth(), email);
        result = resetResultOf(null);
      } catch (error) {
        result = resetResultOf(error);
      }
    }
    setNotice(
      result === 'sent' ? { kind: 'info', text: AUTH_MESSAGES.resetSentShort } : { kind: 'error', text: AUTH_MESSAGES.resetFailed },
    );
    setBusy(null);
  }

  async function handleLogout() {
    if (busy) return;
    setBusy('logout');
    await logout();
    setBusy(null);
  }

  return (
    <>
      <div>
        <button type="button" className={ROW} onClick={() => void handleReset()} disabled={busy !== null}>
          パスワードを再設定
        </button>
        {notice && (
          <p role={notice.kind === 'error' ? 'alert' : 'status'} className={notice.kind === 'error' ? 'mt-1 text-sm text-red-600' : 'mt-1 text-sm text-gray-700'}>
            {notice.text}
          </p>
        )}
      </div>
      <button type="button" className={ROW} onClick={() => void handleLogout()} disabled={busy !== null}>
        ログアウト
      </button>
    </>
  );
}
