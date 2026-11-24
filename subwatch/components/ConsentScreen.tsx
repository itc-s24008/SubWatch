'use client';
// S-13（同意の確認）。URL のない部品で、Gates が出す。枠は 04-01、中身は 04-19 が書く
// props：onDone（同意が済んだら呼ぶ。読み直しとホームへの移動は Gates〔04-05〕）
// 04-01 の仮の表示：［同意して続ける（仮）］（bootstrap は呼ばず onDone() だけを呼ぶ。04-05 の画面テストが押す）と［ログアウト］
import { useState } from 'react';
import { Button, PageTitle } from '@/components/ui';
import { logout } from '@/lib/logout';

export interface ConsentScreenProps {
  onDone: () => void;
}

export function ConsentScreen({ onDone }: ConsentScreenProps) {
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <PageTitle brand>同意の確認</PageTitle>
      <main className="flex flex-col gap-3 p-4">
        <p>（04-19 がこの画面の中身を作る。いまは仮の表示）</p>
        <Button onClick={onDone} disabled={busy} fullWidth>
          同意して続ける（仮）
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          fullWidth
          onClick={async () => {
            setBusy(true);
            await logout();
            setBusy(false);
          }}
        >
          ログアウト
        </Button>
      </main>
    </div>
  );
}
