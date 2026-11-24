'use client';
// S-13（同意の確認）。URL のない部品で、Gates が出す。枠は 04-01、中身は 04-19（画面設計書 2.画面詳細(S-13)・状態・ダイアログ一覧 S-13 の行、
// 機能設計書 詳細_F-01・詳細_F-07、CLAUDE.md の「bootstrap の失敗」、決まりの一覧 C-4・C-5）
// props：onDone（同意が済んだら呼ぶ。読み直しとホームへの移動は Gates〔04-05〕）
//
//   ① 題「同意の確認」（題の上に「SubWatch」）／② 説明文（users が無いときも同じ文）
//   ③④ 同意のチェック（「利用規約」「プライバシーポリシー」は S-11・S-12 へのリンク。同じタブ。戻るとチェックは外れた状態に戻る）
//   ⑤ bootstrap の失敗の文（チェックは入れたまま。⑥をもう一度押せる）
//   ⑥［同意して続ける］：③④が両方チェックされているときだけ押せる。POST /api/account/bootstrap（kind は送らない。サーバーが決める）。
//      押している間は「処理中…」。成功したら onDone() を呼び、画面が切り替わるまで「処理中…」のまま
//   ⑦ ログアウト：logout()（S-02 へは Gates が移す）。サインアウトに失敗したら、文を出さずにもう一度押せるようにする
//   ⑧「アカウントを削除する」：いつも出す（users が無いときも、版が古いだけのときも。出し分けの判定はしない）。
//      04-17 の DeleteAccount を trigger="link" で使う（onSuccess は渡さない＝成功したら S-02 へ）。失敗の文はリンクのすぐ下（DeleteAccount が出す）
//   ⑥の処理中とログアウト中は、⑥⑦⑧とも押せない（⑧には disabled を渡す）
// bootstrap の失敗（lib/auth-flow.ts の classifyBootstrapFailure。決まりの一覧 C-4）：
//   401 UNAUTHENTICATED → onApiGate（AuthProvider）が S-02 へ移す（ここでは何も出さない）
//   409 TERMS_RECONSENT_REQUIRED → 「利用規約が更新されました。もう一度同意してください」と「続けて表示されるときは、画面を読み込み直してください」
//   やり直せる失敗（503・500 RESOURCE_EXHAUSTED・409 CONFLICT・status 0）→ 共通の文（オフライン・一時的な障害）か「登録できませんでした…」
//   それ以外（500 INTERNAL_ERROR など）→ 「登録できませんでした。もう一度お試しください」
import Link from 'next/link';
import { useRef, useState } from 'react';
import { DeleteAccount } from '@/components/DeleteAccount';
import { Button, Card, Checkbox, PageTitle } from '@/components/ui';
import { api } from '@/lib/api-client';
import { AUTH_MESSAGES, classifyBootstrapFailure } from '@/lib/auth-flow';
import { logout } from '@/lib/logout';
import { currentTermsVersions } from '@/lib/terms';
import type { BootstrapBody, BootstrapResult } from '@/lib/types';

export interface ConsentScreenProps {
  onDone: () => void;
}

export const CONSENT_MESSAGES = {
  title: '同意の確認',
  description: '利用規約・プライバシーポリシーが更新されました。内容を確認して同意してください',
  submit: '同意して続ける',
  processing: '処理中…',
  logout: 'ログアウト',
  termsUpdated: '利用規約が更新されました。もう一度同意してください',
  reloadHint: '続けて表示されるときは、画面を読み込み直してください',
  failed: AUTH_MESSAGES.registerFailed, // 「登録できませんでした。もう一度お試しください」
} as const;

type Busy = 'consent' | 'logout' | null;

interface ConsentError {
  message: string;
  hint?: string;
}

const CHECK_ROW = 'rounded-xl border border-gray-200 bg-gray-50 px-4 py-2';

export function ConsentScreen({ onDone }: ConsentScreenProps) {
  const [termsChecked, setTermsChecked] = useState(false);
  const [privacyChecked, setPrivacyChecked] = useState(false);
  const [busy, setBusyState] = useState<Busy>(null);
  const busyRef = useRef<Busy>(null);
  const [error, setError] = useState<ConsentError | null>(null);

  function setBusy(next: Busy) {
    busyRef.current = next;
    setBusyState(next);
  }

  async function handleConsent() {
    if (busyRef.current !== null || !termsChecked || !privacyChecked) return;
    setBusy('consent');
    setError(null);
    const body: BootstrapBody = { termsAccepted: true, privacyAccepted: true, ...currentTermsVersions() };
    try {
      await api<BootstrapResult>('/api/account/bootstrap', { method: 'POST', body });
    } catch (caught) {
      const failure = classifyBootstrapFailure(caught);
      if (failure.kind === 'gate') return; // onApiGate が S-02 へ移す（それまで「処理中…」のまま）
      if (failure.kind === 'termsMismatch') setError({ message: CONSENT_MESSAGES.termsUpdated, hint: CONSENT_MESSAGES.reloadHint });
      else if (failure.kind === 'retryable') setError({ message: failure.message });
      else setError({ message: CONSENT_MESSAGES.failed });
      setBusy(null); // チェックは入れたまま。もう一度押せる
      return;
    }
    onDone(); // 画面が切り替わるまで「処理中…」のまま（busy を戻さない）
  }

  async function handleLogout() {
    if (busyRef.current !== null) return;
    setBusy('logout');
    await logout(); // 失敗しても例外を投げない。サインアウトできれば Gates が S-02 へ移す
    setBusy(null); // サインアウトに失敗したときは、もう一度押せる
  }

  const locked = busy !== null;

  return (
    <div>
      <PageTitle brand>{CONSENT_MESSAGES.title}</PageTitle>
      <main className="px-4 pb-8">
        <Card className="flex flex-col gap-4 p-6">
          <p className="font-bold">{CONSENT_MESSAGES.description}</p>
          <div className="flex flex-col gap-3">
            <div className={CHECK_ROW}>
              <Checkbox id="consent-terms" checked={termsChecked} onChange={setTermsChecked} disabled={locked}>
                <Link href="/terms" className="text-brand underline">
                  利用規約
                </Link>{' '}
                に同意する
              </Checkbox>
            </div>
            <div className={CHECK_ROW}>
              <Checkbox id="consent-privacy" checked={privacyChecked} onChange={setPrivacyChecked} disabled={locked}>
                <Link href="/privacy" className="text-brand underline">
                  プライバシーポリシー
                </Link>{' '}
                に同意する
              </Checkbox>
            </div>
          </div>
          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
              <p className="font-bold">{error.message}</p>
              {error.hint && <p className="mt-1">{error.hint}</p>}
            </div>
          )}
          <Button fullWidth className="mt-2" onClick={() => void handleConsent()} disabled={locked || !termsChecked || !privacyChecked}>
            {busy === 'consent' ? CONSENT_MESSAGES.processing : CONSENT_MESSAGES.submit}
          </Button>
          <div className="flex flex-col items-center">
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={locked}
              className="inline-flex min-h-11 min-w-11 items-center font-bold text-brand disabled:cursor-not-allowed disabled:text-gray-400"
            >
              {CONSENT_MESSAGES.logout}
            </button>
            <DeleteAccount trigger="link" disabled={locked} />
          </div>
        </Card>
      </main>
    </div>
  );
}
