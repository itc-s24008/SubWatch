'use client';
// S-02 ログイン画面（04-05。画面設計書 S-02、詳細_F-02）
// ・ほかの画面から移ってきたときのお知らせ（takeFlash）は、題「ログイン」のすぐ下・白い枠の上（図 S-09_アカウント削除_3）。
//   ［ログイン］か「パスワードを忘れた場合」を押したら消す。開き直すと出さない
// ・ログイン済みで開いても自動では移動しない。ログイン済みのまま［ログイン］を押したら、先に logout() してから認証する（決まりの一覧 C-7）
// ・成功したらホーム（S-03）へ router.replace。users と規約の版は、中の画面の Gates が確かめる
// ・③の送信後の文と、ログインの失敗の文は、白い枠の中の［ログイン］のすぐ上（図 S-02_再設定メール送信後）
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Brand, Button, Card, LinkButton, PageTitle, TextField } from '@/components/ui';
import { AUTH_MESSAGES, loginFailureMessage, resetResultOf } from '@/lib/auth-flow';
import { getFirebaseAuth } from '@/lib/firebase-client';
import { takeFlash } from '@/lib/flash';
import { logout } from '@/lib/logout';

type Notice = { kind: 'info' | 'error'; text: string } | null;

export default function LoginPage() {
  const router = useRouter();
  const [flash, setFlashText] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null); // ③の送信後の文か、ログインの失敗の文（同じ位置）
  const [busy, setBusy] = useState<'login' | 'reset' | null>(null);

  useEffect(() => {
    setFlashText(takeFlash());
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setFlashText(null);
    setEmailError(null);
    setNotice(null);
    if (email === '' || password === '') {
      setNotice({ kind: 'error', text: AUTH_MESSAGES.loginInvalid }); // 空のときは認証を呼ばない
      return;
    }
    setBusy('login');
    const auth = getFirebaseAuth();
    if (auth.currentUser) await logout(); // 前の利用者の Push 購読を外してサインアウト（最大3秒）
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.replace('/');
    } catch (error) {
      setNotice({ kind: 'error', text: loginFailureMessage(error) });
      setBusy(null);
    }
  }

  async function handleReset() {
    if (busy) return;
    setFlashText(null);
    setNotice(null);
    setEmailError(null);
    const input = document.getElementById('login-email') as HTMLInputElement | null;
    const valid = input?.validity.valid ?? true; // 形式は type="email" の判定に任せる
    if (email.trim() === '' || !valid) {
      setEmailError(AUTH_MESSAGES.resetEmailRequired);
      return;
    }
    setBusy('reset');
    let result;
    try {
      await sendPasswordResetEmail(getFirebaseAuth(), email);
      result = resetResultOf(null);
    } catch (error) {
      result = resetResultOf(error);
    }
    if (result === 'sent') setNotice({ kind: 'info', text: AUTH_MESSAGES.resetSent });
    else if (result === 'invalidEmail') setEmailError(AUTH_MESSAGES.resetEmailRequired);
    else setNotice({ kind: 'error', text: AUTH_MESSAGES.resetFailed });
    setBusy(null);
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
          <form noValidate onSubmit={handleLogin} className="mt-6 flex flex-col gap-3">
            <TextField
              id="login-email"
              label="メールアドレス"
              type="email"
              autoComplete="email"
              value={email}
              error={emailError}
              onChange={(event) => setEmail(event.target.value)}
            />
            <TextField
              id="login-password"
              label="パスワード"
              type="password"
              autoComplete="current-password"
              placeholder="パスワードを入力"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <div className="flex justify-end">
              <LinkButton className="text-sm font-bold no-underline" onClick={() => void handleReset()} disabled={busy !== null}>
                パスワードを忘れた場合
              </LinkButton>
            </div>
            {notice && (
              <p
                role={notice.kind === 'error' ? 'alert' : 'status'}
                className={
                  notice.kind === 'error'
                    ? 'rounded-xl bg-red-50 p-4 text-sm font-bold text-red-600'
                    : 'rounded-xl bg-blue-50 p-4 text-sm font-bold text-gray-800'
                }
              >
                {notice.text}
              </p>
            )}
            <Button type="submit" fullWidth disabled={busy !== null} className="mt-2">
              {busy === 'login' ? 'ログイン中…' : 'ログイン'}
            </Button>
          </form>
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
