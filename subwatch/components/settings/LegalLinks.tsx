'use client';
// S-09 の部品：⑪利用規約・プライバシーポリシーのリンク（04-19。画面設計書 S-09 ⑪）
// S-11・S-12 を同じタブで開く（S-11・S-12 の［戻る］で S-09 に戻る）。図のとおり「利用規約 ／ プライバシーポリシー」と「内容を確認する」
import Link from 'next/link';
import { Card } from '@/components/ui';

const LINK = 'inline-flex min-h-11 items-center font-bold text-brand';

export function LegalLinks() {
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-2">
        <Link href="/terms" className={LINK}>
          利用規約
        </Link>
        <span aria-hidden="true" className="font-bold text-brand">
          ／
        </span>
        <Link href="/privacy" className={LINK}>
          プライバシーポリシー
        </Link>
      </div>
      <p className="text-sm text-gray-500">内容を確認する</p>
    </Card>
  );
}
