// S-12 プライバシーポリシー画面（04-19。画面設計書 2.画面詳細(S-12)）。ログイン前でも見られる。本文は components/legal-text.tsx
import { LegalPage } from '@/components/LegalPage';
import { PRIVACY_DOCUMENT } from '@/components/legal-text';

export default function Page() {
  return <LegalPage document={PRIVACY_DOCUMENT} />;
}
