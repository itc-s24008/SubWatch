// S-11 利用規約画面（04-19。画面設計書 2.画面詳細(S-11)）。ログイン前でも見られる。本文は components/legal-text.tsx
import { LegalPage } from '@/components/LegalPage';
import { TERMS_DOCUMENT } from '@/components/legal-text';

export default function Page() {
  return <LegalPage document={TERMS_DOCUMENT} />;
}
