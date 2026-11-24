// アプリ全体の枠（共通ファイル）。AuthProvider を差し込み、manifest と apple-touch-icon（ファイルは 04-12 が public/ に置く）を指定する
// PC はスマートフォンと同じレイアウトを、幅 480px で中央に出す
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/components/AuthProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'SubWatch',
  description: 'サブスクの請求予定をまとめて管理するアプリ',
  manifest: '/manifest.webmanifest',
  icons: { apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#2563eb',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <AuthProvider>
          <div className="mx-auto min-h-screen w-full max-w-app overflow-x-hidden">{children}</div>
        </AuthProvider>
      </body>
    </html>
  );
}
