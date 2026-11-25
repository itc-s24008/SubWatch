'use client';
// S-02 ログイン画面（04-05。画面設計書 S-02、詳細_F-02。ログインは Google だけ：決まりの一覧 C-19）
// ・ほかの画面から移ってきたときのお知らせ（takeFlash）は、題「ログイン」のすぐ下・白い枠の上（図 S-09_アカウント削除_3）。
//   ［Googleでログイン］を押したら消す。開き直すと出さない
// ・ログイン済みで開いても自動では移動しない。ログイン済みのまま［Googleでログイン］を押したら、先に logout() してから
//   ポップアップを開く（決まりの一覧 C-7。前の利用者の Push 購読を、前の利用者のまま外すため）。
//   logout() を待つ間にブラウザがポップアップを止めたら「ポップアップがブロックされました…」を出す（もう一度押せば、ログアウト済みなのですぐ開く）
// ・成功したらホーム（S-03）へ router.replace。users と規約の版は、中の画面の Gates が確かめる
//   （初めての Google アカウントで users が無いときは、Gates が S-13 の同意の画面を出し、そこで users を作る）
// ・ポップアップを閉じたときは文を出さない。失敗の文は、白い枠の中のボタンのすぐ上
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Brand, Button, Card, PageTitle } from '@/components/ui';
import { AUTH_MESSAGES } from '@/lib/auth-flow';
import { getFirebaseAuth } from '@/lib/firebase-client';
import { takeFlash } from '@/lib/flash';
import { GOOGLE_MESSAGES, googleSignInMessage, signInWithGoogle } from '@/lib/google-auth';
import { logout } from '@/lib/logout';

export default function LoginPage() {
  const router = useRouter();
  const [flash, setFlashText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFlashText(takeFlash());
  }, []);

  async function handleLogin() {
    if (busy) return;
    setFlashText(null);
    setError(null);
    setBusy(true);
    if (getFirebaseAuth().currentUser) await logout(); // 前の利用者の Push 購読を外してサインアウト（最大3秒）
    try {
      await signInWithGoogle();
      router.replace('/');
    } catch (failure) {
      setError(googleSignInMessage(failure, AUTH_MESSAGES.loginFailed));
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle brand>ログイン</PageTitle>
      <main className="flex flex-col gap-4 px-4 pb-8">
        {flash && (
          <p role="status" className="rounded-2xl border border-blue-200 bg-blue-50 p-4 font-bold text-brand">
            {flash}
          </p>
        )}
        <Card className="p-6">
          <Brand className="text-center text-3xl" />
          <h2 className="mt-8 text-2xl font-bold">おかえりなさい</h2>
          <p className="mt-1 text-sm text-gray-500">ログインして請求予定を確認しましょう</p>
          <div className="mt-6 flex flex-col gap-3">
            {error && (
              <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm font-bold text-red-600">
                {error}
              </p>
            )}
            <Button fullWidth disabled={busy} onClick={() => void handleLogin()} className="mt-2">
              {busy ? 'ログイン中…' : GOOGLE_MESSAGES.loginButton}
            </Button>
          </div>
          <div className="mt-6 flex flex-col items-center text-sm text-gray-500">
            <p>アカウントをお持ちでないですか？</p>
            <Link href="/register" className="inline-flex min-h-11 min-w-11 items-center font-bold text-brand">
              新規登録
            </Link>
          </div>
        </Card>
      </main>
    </>
  );
}
