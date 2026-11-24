'use client';
// S-11 利用規約・S-12 プライバシーポリシーの画面の形（04-19。画面設計書 2.画面詳細(S-11)・(S-12)、状態・ダイアログ一覧 S-11・S-12 の行、
// 機能設計書 API共通仕様 B108・B109）。本文は components/legal-text.tsx
//
// props：document（TERMS_DOCUMENT か PRIVACY_DOCUMENT）
//   ①［戻る］：ログイン中で履歴があれば前の画面へ（router.back）、無ければ S-09 へ router.replace。ログイン前は S-01 へ router.replace。
//              ログインの状態を確かめている途中に押されたときは、確かめ終わってから行き先を決める
//   ② 画面のタイトル（<h1>）
//   ③ 本文（静的。通信はしない）。題（<h2>）の下に「この文書は卒業制作…」、末尾に「版：…」。ページ全体をスクロールさせる
//   ④［再試行］：開いたときにオフライン（navigator.onLine が false）なら「読み込めませんでした」「ネットワークを確認して再試行してください」と［再試行］。
//              押すとオンラインかを確かめ直す（確かめている間は「読み込み中…」）。確かめるのは開いたときと［再試行］のときだけで、
//              読んでいる途中で通信が切れても本文は出したまま
//   共通の LoadError は文の組み合わせ（見出し＋「ネットワークを確認して再試行してください」）を出せないので、ここで書く（指示書 04-19）
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { LEGAL_DISCLAIMER, versionLabel, type LegalDocument } from '@/components/legal-text';
import { Button, Card, Loading, PageTitle } from '@/components/ui';

type Phase = 'checking' | 'ready' | 'offline';

export const LEGAL_MESSAGES = {
  back: '戻る',
  loadFailed: '読み込めませんでした',
  checkNetwork: 'ネットワークを確認して再試行してください',
  retry: '再試行',
} as const;

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export function LegalPage({ document }: { document: LegalDocument }) {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [phase, setPhase] = useState<Phase>('checking');
  const [attempt, setAttempt] = useState(0);
  const [backPending, setBackPending] = useState(false);

  // 開いたときと［再試行］のときだけ、オンラインかを確かめる
  useEffect(() => {
    setPhase(isOnline() ? 'ready' : 'offline');
  }, [attempt]);

  // ［戻る］の行き先（ログインの状態が決まってから）
  useEffect(() => {
    if (!backPending || loading) return;
    setBackPending(false);
    if (!user) {
      router.replace('/register');
      return;
    }
    if (window.history.length > 1) router.back();
    else router.replace('/settings');
  }, [backPending, loading, user, router]);

  function retry() {
    setPhase('checking');
    setAttempt((n) => n + 1);
  }

  const backButton = (
    <button
      type="button"
      onClick={() => setBackPending(true)}
      className="inline-flex min-h-11 min-w-11 items-center gap-1 rounded-xl bg-brand-light px-3 text-sm font-bold text-brand"
    >
      <span aria-hidden="true">‹</span>
      {LEGAL_MESSAGES.back}
    </button>
  );

  return (
    <>
      <div className="bg-white px-4 pt-3">{backButton}</div>
      <PageTitle>{document.pageTitle}</PageTitle>
      <main className="bg-gray-50 p-4">
        <Card className="p-6">
          {phase === 'checking' && <Loading />}
          {phase === 'offline' && (
            <div role="alert" className="py-16 text-center">
              <p className="text-lg font-bold">{LEGAL_MESSAGES.loadFailed}</p>
              <p className="mt-2 text-sm text-gray-500">{LEGAL_MESSAGES.checkNetwork}</p>
              <Button className="mt-6 w-44" onClick={retry}>
                {LEGAL_MESSAGES.retry}
              </Button>
            </div>
          )}
          {phase === 'ready' && <LegalBody document={document} />}
        </Card>
      </main>
    </>
  );
}

function LegalBody({ document }: { document: LegalDocument }) {
  return (
    <article className="break-words text-sm leading-relaxed text-gray-700">
      <h2 className="text-xl font-bold text-gray-900">{document.documentTitle}</h2>
      <p className="mt-2 rounded-xl bg-brand-light px-4 py-2 font-bold text-brand">{LEGAL_DISCLAIMER}</p>
      {document.sections.map((section) => (
        <section key={section.title} className="mt-4">
          <h3 className="text-base font-bold text-gray-900">{section.title}</h3>
          {section.paragraphs?.map((text) => (
            <p key={text}>{text}</p>
          ))}
          {section.items && (
            <ul>
              {section.items.map((text) => (
                <li key={text} className="flex gap-1">
                  <span aria-hidden="true">・</span>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          )}
          {section.after?.map((text) => (
            <p key={text} className="mt-1">
              {text}
            </p>
          ))}
        </section>
      ))}
      <p className="mt-1">{versionLabel(document.versionEnv)}</p>
    </article>
  );
}
