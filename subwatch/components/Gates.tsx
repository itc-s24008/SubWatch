'use client';
// 画面を切り替える部品（(main) の画面だけで使う。(auth) の画面〔S-01・S-02〕では判定しない）。枠は 04-01、判定は 04-05 が書く
// 04-01 の枠：未ログインなら /login へ router.replace（履歴を置き換える）。確かめている間は「読み込み中…」。
// 同意が必要なとき（04-05 が判定する）は ConsentScreen（S-13）を出し、下部ナビ（nav）は出さない。
// 仮データ（NEXT_PUBLIC_USE_MOCKS=true）のときは、ログインを求めない
//
// props：children（中の画面）、nav?（下部ナビ。S-13 を出している間は出さない）
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useAccountGate, useAuth } from '@/components/AuthProvider';
import { ConsentScreen } from '@/components/ConsentScreen';
import { LoadError, Loading } from '@/components/ui';
import { MOCKS_ENABLED } from '@/lib/api-client';

// ===== 04-05：同意の判定と GET /api/account の読み込み =====
// ・ログインした人ごとに最初に1回 GET /api/account を読む（終わるまで「読み込み中…」）。値は useAccountGate() で配る
// ・404（users が無い）・規約の版が古い・API が 409 を返した → S-13（ConsentScreen）。下部ナビは出さない
// ・読めなかった（503・通信の失敗など）→ ログインしたまま、共通の読み込み失敗の表示と［再試行］（オフライン・一時的な障害は共通の文）
// ・S-13 の onDone → GET /api/account を読み直し、同意が済んでいればホーム（S-03）へ router.replace
// ・401 は AuthProvider（onApiGate の受け方）が S-02 へ移すので、ここでは「読み込み中…」のまま
export function Gates({ children, nav }: { children: ReactNode; nav?: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const gate = useAccountGate();
  const { status, loadAccount } = gate;
  const [goHomeAfterLoad, setGoHomeAfterLoad] = useState(false); // S-13 の onDone の後の読み直しが済んだら、ホームへ移る

  useEffect(() => {
    if (MOCKS_ENABLED) return;
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  // ログインした人ごとに最初に1回読む（仮データのときは、ログインせずに仮の値を読む）
  const ready = MOCKS_ENABLED || (!loading && user !== null);
  useEffect(() => {
    if (ready && status === 'idle') void loadAccount();
  }, [ready, status, loadAccount]);

  useEffect(() => {
    if (!goHomeAfterLoad) return;
    if (status === 'ready') {
      setGoHomeAfterLoad(false);
      router.replace('/');
    }
  }, [status, goHomeAfterLoad, router]);

  if (!MOCKS_ENABLED) {
    if (loading || !user) return <Loading />;
  }
  if (status === 'consent') {
    return (
      <ConsentScreen
        onDone={() => {
          setGoHomeAfterLoad(true);
          void loadAccount();
        }}
      />
    );
  }
  if (status === 'error') {
    return (
      <main>
        <LoadError error={gate.error} onRetry={() => void loadAccount()} />
      </main>
    );
  }
  if (status !== 'ready') return <Loading />;
  return (
    <>
      {children}
      {nav}
    </>
  );
}
