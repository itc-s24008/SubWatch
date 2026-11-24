// 利用規約（S-11）・プライバシーポリシー（S-12）の枠（共通ファイル）。ログイン前でも見られる
import type { ReactNode } from 'react';

export default function LegalLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-white">{children}</div>;
}
