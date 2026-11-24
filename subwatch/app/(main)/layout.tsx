'use client';
// ログインした人の画面の枠（共通ファイル）。Gates（未ログイン → S-02、同意が必要 → S-13）と下部ナビ
// S-05（/subscriptions/new・/subscriptions/[id]/edit）と、Gates が S-13 を出している間は、下部ナビを出さない
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { BottomNav } from '@/components/BottomNav';
import { Gates } from '@/components/Gates';

function isSubscriptionFormPath(pathname: string): boolean {
  return pathname === '/subscriptions/new' || /^\/subscriptions\/[^/]+\/edit$/.test(pathname);
}

export default function MainLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/';
  const showNav = !isSubscriptionFormPath(pathname);
  return (
    <Gates nav={showNav ? <BottomNav /> : null}>
      <div className={showNav ? 'pb-28' : undefined}>{children}</div>
    </Gates>
  );
}
