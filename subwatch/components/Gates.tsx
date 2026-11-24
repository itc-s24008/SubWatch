'use client';
// 画面を切り替える部品（(main) の画面だけで使う。(auth) の画面〔S-01・S-02〕では判定しない）。枠は 04-01、判定は 04-05 が書く
// 04-01 の枠：未ログインなら /login へ router.replace（履歴を置き換える）。確かめている間は「読み込み中…」。
// 同意が必要なとき（04-05 が判定する）は ConsentScreen（S-13）を出し、下部ナビ（nav）は出さない。
// 仮データ（NEXT_PUBLIC_USE_MOCKS=true）のときは、ログインを求めない
//
// props：children（中の画面）、nav?（下部ナビ。S-13 を出している間は出さない）
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { ConsentScreen } from '@/components/ConsentScreen';
import { Loading } from '@/components/ui';
import { MOCKS_ENABLED } from '@/lib/api-client';

export function Gates({ children, nav }: { children: ReactNode; nav?: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  // 同意が必要か（04-05 が、GET /api/account の結果と onApiGate で決める。04-01 の時点ではいつも false）
  const [consentRequired, setConsentRequired] = useState(false);

  useEffect(() => {
    if (MOCKS_ENABLED) return;
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (!MOCKS_ENABLED) {
    if (loading || !user) return <Loading />;
  }
  if (consentRequired) return <ConsentScreen onDone={() => setConsentRequired(false)} />;
  return (
    <>
      {children}
      {nav}
    </>
  );
}

// ===== 04-05：同意の判定と GET /api/account の読み込み ここに足す =====
