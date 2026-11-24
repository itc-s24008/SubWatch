'use client';
// 画面の下部ナビゲーション（共通部品）。ホーム・一覧・カレンダー・設定を切り替える
// 選択中：/ と /notifications（S-08）→ ホーム、/subscriptions 以下 → 一覧、/calendar → カレンダー、/settings → 設定
// S-05（/subscriptions/new・/subscriptions/[id]/edit）と S-13 では出さない（app/(main)/layout.tsx が決める）
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type NavKey = 'home' | 'list' | 'calendar' | 'settings';

const ITEMS: { key: NavKey; href: string; label: string; icon: string }[] = [
  { key: 'home', href: '/', label: 'ホーム', icon: 'M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z' },
  { key: 'list', href: '/subscriptions', label: '一覧', icon: 'M4 6h16M4 12h16M4 18h16' },
  { key: 'calendar', href: '/calendar', label: 'カレンダー', icon: 'M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1zM4 10h16M8 3v4M16 3v4' },
  { key: 'settings', href: '/settings', label: '設定', icon: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v4M12 18v4' },
];

export function selectedNavKey(pathname: string): NavKey | null {
  if (pathname === '/' || pathname.startsWith('/notifications')) return 'home';
  if (pathname.startsWith('/subscriptions')) return 'list';
  if (pathname.startsWith('/calendar')) return 'calendar';
  if (pathname.startsWith('/settings')) return 'settings';
  return null;
}

export function BottomNav() {
  const pathname = usePathname() ?? '/';
  const selected = selectedNavKey(pathname);
  return (
    <nav aria-label="メニュー" className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3">
      <ul className="mx-auto flex max-w-app justify-around rounded-3xl border border-gray-200 bg-white p-2 shadow-sm">
        {ITEMS.map((item) => {
          const active = item.key === selected;
          return (
            <li key={item.key} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-11 flex-col items-center justify-center rounded-2xl py-1 text-xs ${
                  active ? 'bg-brand-light font-bold text-brand' : 'text-gray-500'
                }`}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d={item.icon} />
                </svg>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
