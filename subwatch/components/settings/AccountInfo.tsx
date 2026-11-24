'use client';
// S-09 の部品：②アカウント情報（04-05）。登録したメールアドレスを出す
// GET /api/account は自分で読まず、Gates が読んだ値（useAccountGate().account）を使う
import { useAccountGate } from '@/components/AuthProvider';
import { Card } from '@/components/ui';

export function AccountInfo() {
  const { account } = useAccountGate();
  return (
    <Card className="py-3">
      <p className="text-sm font-bold text-gray-500">アカウント情報</p>
      <p className="mt-1 break-all text-lg font-bold">{account?.email ?? ''}</p>
    </Card>
  );
}
