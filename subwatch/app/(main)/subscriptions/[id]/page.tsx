'use client';
// S-06 サブスク詳細画面（04-08 の最小表示。①解約案内・③〜⑧・②の支払方法・Push から開いたときの 404 の移動は 04-19 が足す）
// 画面設計書 2.画面詳細(S-06)・状態・ダイアログ一覧 S-06 の行、機能設計書 詳細_F-03 の手順9
//   ② サービス名・アイコン・カテゴリー・プラン名・次回請求予定（次回請求日は API の値をそのまま出す）
//   ⑨ 編集する（S-05 の編集へ）・⑩ 削除する（確認ダイアログ → DELETE → 「削除しました」を置いて S-04 へ置き換える）・⑪ 注意書き
//   読み込み中・読み込み失敗（［再試行］）・404 の「見つかりません」と［一覧へ戻る］
import { useParams, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Dialog } from '@/components/Dialog';
import { IconBadge } from '@/components/IconBadge';
import { SubscriptionNotFound } from '@/components/SubscriptionNotFound';
import { Button, Card, LoadError, Loading, PageTitle, commonErrorMessage } from '@/components/ui';
import { ApiClientError, api, isGateError } from '@/lib/api-client';
import { setFlash } from '@/lib/flash';
import { CATEGORY_LABELS, formatMonthDay, formatYen } from '@/lib/format';
import type { SubscriptionDto } from '@/lib/types';
import { useSubscription } from '@/lib/use-subscription';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const { status, subscription, error, reload } = useSubscription(id);

  return (
    <>
      <PageTitle brand>サービス詳細</PageTitle>
      <main className="p-4">
        {status === 'loading' && <Loading />}
        {status === 'error' && <LoadError error={error} onRetry={reload} />}
        {status === 'notFound' && <SubscriptionNotFound />}
        {status === 'ready' && subscription && <SubscriptionDetail subscription={subscription} />}
      </main>
    </>
  );
}

// 「動画・スタンダード」（プラン名が未入力ならカテゴリーだけ）
function categoryAndPlan(subscription: SubscriptionDto): string {
  const category = CATEGORY_LABELS[subscription.category] ?? '―';
  return subscription.planName ? `${category}・${subscription.planName}` : category;
}

function SubscriptionDetail({ subscription }: { subscription: SubscriptionDto }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      {/* ② サービス名・次回請求予定 */}
      <Card as="section">
        <div className="flex items-center gap-4">
          <IconBadge serviceName={subscription.serviceName} websiteUrl={subscription.websiteUrl} size={56} />
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-xl font-bold">{subscription.serviceName}</h2>
            <p className="break-words text-sm text-gray-500">{categoryAndPlan(subscription)}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-gray-200 pt-3">
          <p className="text-sm text-gray-500">次回請求予定</p>
          <p className="text-lg font-bold">
            {formatMonthDay(subscription.nextBillingDate)}・{formatYen(subscription.price)}
          </p>
        </div>
      </Card>

      {/* ⑨ 編集する・⑩ 削除する */}
      <div className="grid grid-cols-2 gap-3">
        <Button href={`/subscriptions/${encodeURIComponent(subscription.subscriptionId)}/edit`}>編集する</Button>
        <Button variant="dangerOutline" onClick={() => setDeleteOpen(true)}>
          削除する
        </Button>
      </div>

      {/* ⑪ 注意書き */}
      <div className="rounded-2xl bg-brand-light p-4 text-sm text-gray-600">
        <p>解約したら、このサブスクを削除してください。</p>
        <p>削除時は確認ダイアログを表示します。届いた通知の履歴は残ります</p>
      </div>

      <DeleteDialog subscription={subscription} open={deleteOpen} onClose={() => setDeleteOpen(false)} />
    </div>
  );
}

// 削除の確認ダイアログ（状態・ダイアログ一覧 S-06 の26行・49行）
//   題「{サービス名}を削除しますか？」、本文「通知の履歴は残ります。」「この操作は取り消せません。」、左に［キャンセル］（開いたときのフォーカス）、右に［削除する］
//   ［削除する］の後は「削除中…」。削除中は［キャンセル］も押せず、Esc でも閉じない
//   成功（204）と、すでに削除されていたとき（404）は、「削除しました」を置いて S-04 へ置き換える（S-04 が takeFlash で出す。04-09）
//   失敗はダイアログの中に文を出す（オフライン・一時的な障害は共通の文を優先）。もう一度押せる
function DeleteDialog({ subscription, open, onClose }: { subscription: SubscriptionDto; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const deletingRef = useRef(false);

  function close() {
    if (deletingRef.current) return;
    setMessage(null);
    onClose();
  }

  function finish() {
    setFlash('削除しました');
    router.replace('/subscriptions');
  }

  async function remove() {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setMessage(null);
    let succeeded = false;
    try {
      await api<void>(`/api/subscriptions/${encodeURIComponent(subscription.subscriptionId)}`, { method: 'DELETE' });
      succeeded = true;
      finish();
    } catch (error) {
      if (isGateError(error)) return;
      if (error instanceof ApiClientError && error.status === 404) {
        succeeded = true;
        finish(); // すでに削除されていたときも「削除しました」
        return;
      }
      setMessage(commonErrorMessage(error) ?? '削除できませんでした。もう一度お試しください');
    } finally {
      if (!succeeded) {
        deletingRef.current = false;
        setDeleting(false);
      }
    }
  }

  return (
    <Dialog
      open={open}
      title={`${subscription.serviceName}を削除しますか？`}
      onClose={close}
      closeOnEsc={!deleting}
      actions={
        <>
          <Button variant="secondary" className="flex-1" disabled={deleting} onClick={close}>
            キャンセル
          </Button>
          <Button variant="danger" className="flex-1" disabled={deleting} onClick={() => void remove()}>
            {deleting ? '削除中…' : '削除する'}
          </Button>
        </>
      }
    >
      <p className="text-gray-500">通知の履歴は残ります。</p>
      <p className="text-gray-500">この操作は取り消せません。</p>
      {message && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {message}
        </p>
      )}
    </Dialog>
  );
}
