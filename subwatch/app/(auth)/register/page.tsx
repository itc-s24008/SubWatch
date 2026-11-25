'use client';
// S-01 ユーザー登録画面（04-05。画面設計書 S-01、詳細_F-01、決まりの一覧 C-4・C-14。登録は Google だけ：C-19）
// ・開いたときにログイン済みなら、自分で GET /api/account を1回だけ読む（開いた後の最初の認証の確定の1回だけ。登録の送信中は読まない。
//   Gates は使わない）：200 → ホーム（S-03）へ router.replace／404 → 「やり直す」表示（チェックは外した状態）／
//   読めない → 「読み込めませんでした。ページを再読み込みしてください」だけ（共通の文にしない。［再試行］は出さない）
// ・［Googleで登録］（同意のチェック2つが済むまで押せない）：Google のポップアップでログイン → POST /api/account/bootstrap → 成功ならホームへ router.replace
//   すでに登録済みの Google アカウントでも同じ（bootstrap は、users があって版が同じなら何もしない）。ポップアップを閉じたときは文を出さない
// ・bootstrap の失敗は lib/auth-flow.ts の classifyBootstrapFailure（決まりの一覧 C-4）：
//   401 は onApiGate（AuthProvider）／版違いの 409 と、それ以外（500 INTERNAL_ERROR など）は signOut だけして S-02 へ（お知らせは signOut の前に置く）／
//   やり直せる失敗は、サインアウトせず同じ画面のまま「やり直す」表示に切り替える（チェックはしたまま）
// ・「やり直す」表示：説明・同意のチェック2つ・失敗の文・「初期設定をやり直す」（bootstrap だけを呼ぶ）・「ログアウト」（logout() → S-02）だけ
import { signOut } from 'firebase/auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Brand, Button, Card, Checkbox, LoadError, Loading, PageTitle } from '@/components/ui';
import { ApiClientError, api, isGateError } from '@/lib/api-client';
import { AUTH_MESSAGES, classifyBootstrapFailure } from '@/lib/auth-flow';
import { getFirebaseAuth } from '@/lib/firebase-client';
import { setFlash } from '@/lib/flash';
import { GOOGLE_MESSAGES, googleSignInMessage, signInWithGoogle } from '@/lib/google-auth';
import { logout } from '@/lib/logout';
import { currentTermsVersions } from '@/lib/terms';
import type { AccountDto, BootstrapBody, BootstrapResult } from '@/lib/types';

type Phase = 'checking' | 'form' | 'retry' | 'loadError';
type Busy = 'create' | 'retry' | 'logout' | null;

export default function RegisterPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const checkedRef = useRef(false); // 開いた後の最初の認証の確定で、1回だけ確かめる
  const [phase, setPhase] = useState<Phase>('checking');
  const [termsChecked, setTermsChecked] = useState(false);
  const [privacyChecked, setPrivacyChecked] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);

  useEffect(() => {
    if (loading || checkedRef.current) return;
    checkedRef.current = true;
    if (!user) {
      setPhase('form');
      return;
    }
    api<AccountDto>('/api/account')
      .then(() => router.replace('/'))
      .catch((error: unknown) => {
        if (error instanceof ApiClientError && error.status === 404) {
          setPhase('retry'); // users が無い（チェックは外した状態で出す）
          return;
        }
        if (isGateError(error)) return; // 401 は onApiGate が S-02 へ移す
        setPhase('loadError');
      });
  }, [loading, user, router]);

  async function signOutTo(flash: string) {
    setFlash(flash); // signOut の前に置く
    try {
      await signOut(getFirebaseAuth()); // logout() は使わない（signOut だけ）
    } catch {
      // サインアウトの失敗でも S-02 へ移す
    }
    router.replace('/login');
  }

  // bootstrap だけを呼ぶ（［アカウントを作成］の続きと「初期設定をやり直す」）
  async function runBootstrap() {
    const body: BootstrapBody = { termsAccepted: true, privacyAccepted: true, ...currentTermsVersions() };
    try {
      await api<BootstrapResult>('/api/account/bootstrap', { method: 'POST', body });
      router.replace('/');
    } catch (error) {
      const failure = classifyBootstrapFailure(error);
      if (failure.kind === 'gate') return; // onApiGate が S-02 へ移す（それまで「作成中…」のまま）
      if (failure.kind === 'termsMismatch') {
        await signOutTo(AUTH_MESSAGES.flashTermsUpdated);
        return;
      }
      if (failure.kind === 'retryable') {
        setSubmitError(failure.message);
        setPhase('retry'); // 同じ画面のまま「やり直す」表示へ（チェックはしたまま）
        setBusy(null);
        return;
      }
      await signOutTo(AUTH_MESSAGES.flashBootstrapFailed);
    }
  }

  async function handleCreate() {
    if (busy || !termsChecked || !privacyChecked) return;
    setSubmitError(null);
    setBusy('create');
    try {
      await signInWithGoogle(); // ポップアップは、ほかの await より先に開く
    } catch (error) {
      setSubmitError(googleSignInMessage(error, AUTH_MESSAGES.registerFailed));
      setBusy(null);
      return;
    }
    await runBootstrap();
  }

  async function handleRetry() {
    if (busy || !termsChecked || !privacyChecked) return;
    setBusy('retry');
    setSubmitError(null);
    await runBootstrap();
  }

  async function handleLogout() {
    if (busy) return;
    setBusy('logout');
    await logout(); // S-13 の⑦と同じ（ブラウザの購読を解除してサインアウト）
    router.replace('/login');
  }

  const consentChecks = (
    <div className="flex flex-col">
      <Checkbox id="register-terms" checked={termsChecked} onChange={setTermsChecked} disabled={busy !== null}>
        <Link href="/terms" className="text-brand underline">
          利用規約
        </Link>{' '}
        に同意する
      </Checkbox>
      <Checkbox id="register-privacy" checked={privacyChecked} onChange={setPrivacyChecked} disabled={busy !== null}>
        <Link href="/privacy" className="text-brand underline">
          プライバシーポリシー
        </Link>{' '}
        に同意する
      </Checkbox>
    </div>
  );

  const errorBox = submitError && (
    <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-600">
      {submitError}
    </p>
  );

  let content: ReactNode;
  if (phase === 'checking') {
    content = <Loading />;
  } else if (phase === 'loadError') {
    content = <LoadError message={AUTH_MESSAGES.accountLoadFailed} />;
  } else if (phase === 'retry') {
    content = (
      <Card className="flex flex-col gap-4 p-6">
        <p className="font-bold">{AUTH_MESSAGES.retryDescription}</p>
        {consentChecks}
        {errorBox}
        <Button fullWidth onClick={() => void handleRetry()} disabled={busy !== null || !termsChecked || !privacyChecked}>
          {busy === 'retry' ? '処理中…' : '初期設定をやり直す'}
        </Button>
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={busy !== null}
            className="inline-flex min-h-11 min-w-11 items-center font-bold text-brand disabled:cursor-not-allowed disabled:text-gray-400"
          >
            ログアウト
          </button>
        </div>
      </Card>
    );
  } else {
    content = (
      <Card className="p-6">
        <Brand className="text-center text-3xl" />
        <p className="mt-4 text-center font-bold">
          サブスクを忘れない、
          <br />
          払い忘れない。
        </p>
        <h2 className="mt-6 text-2xl font-bold">アカウントを作成</h2>
        <p className="mt-1 text-sm text-gray-500">請求予定をまとめて管理しましょう</p>
        <div className="mt-6 flex flex-col gap-3">
          {consentChecks}
          {errorBox}
          <Button fullWidth onClick={() => void handleCreate()} disabled={busy !== null || !termsChecked || !privacyChecked} className="mt-2">
            {busy === 'create' ? '作成中…' : GOOGLE_MESSAGES.registerButton}
          </Button>
        </div>
        <div className="mt-6 flex flex-col items-center text-sm text-gray-500">
          <p>すでにアカウントをお持ちですか？</p>
          <Link href="/login" className="inline-flex min-h-11 min-w-11 items-center font-bold text-brand">
            ログイン
          </Link>
        </div>
        <div className="mt-2 flex items-center justify-center gap-1 text-sm text-gray-500">
          <Link href="/terms" className="inline-flex min-h-11 items-center px-1">
            利用規約
          </Link>
          <span aria-hidden="true">・</span>
          <Link href="/privacy" className="inline-flex min-h-11 items-center px-1">
            プライバシーポリシー
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <>
      <PageTitle brand>ユーザー登録</PageTitle>
      <main className="px-4 pb-8">{content}</main>
    </>
  );
}
