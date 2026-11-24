'use client';
// S-05 サブスク編集画面（04-08）。GET /api/subscriptions/:id で読み、04-06 のフォームに渡す（保存と保存の後の移動はフォームの中）
// 読み込み中・読み込み失敗・「見つかりません」のときも、題「サブスクを編集」と「戻る」を出す（戻る先が無ければ S-04。画面設計書 S-05 ①）
import { useParams, useRouter } from 'next/navigation';
import { SubscriptionForm, SubscriptionFormTitle, goBackOr } from '@/components/SubscriptionForm';
import { SubscriptionNotFound } from '@/components/SubscriptionNotFound';
import { LoadError, Loading } from '@/components/ui';
import { useSubscription } from '@/lib/use-subscription';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { status, subscription, error, reload } = useSubscription(id);

  if (status === 'ready' && subscription) {
    return <SubscriptionForm key={subscription.subscriptionId} mode="edit" subscription={subscription} />;
  }
  return (
    <>
      <SubscriptionFormTitle mode="edit" onBack={() => goBackOr(router, '/subscriptions')} />
      <main className="p-4">
        {status === 'loading' && <Loading />}
        {status === 'error' && <LoadError error={error} onRetry={reload} />}
        {status === 'notFound' && <SubscriptionNotFound />}
      </main>
    </>
  );
}
