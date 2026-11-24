// ログイン前の画面（S-01・S-02）の枠（共通ファイル）。Gates は使わない（登録の途中で S-13 に切り替えないため）
// onApiGate（api() の結果を受ける口）は、この画面でも反応する（受け方は 04-05）
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen">{children}</div>;
}
