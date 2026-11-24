'use client';
// S-06 サブスク詳細画面（04-08 が最小表示を作り、04-19 が①③〜⑧・②の支払方法・Push から開いたときの 404 の移動を足した）
// 画面設計書 2.画面詳細(S-06)・状態・ダイアログ一覧 S-06 の行、機能設計書 詳細_F-03 の手順9・10、API共通仕様 B107、決まりの一覧 C-14
//   ① 解約案内（無料トライアルの最終無料日か次回請求日まで0〜7日。今日は lib/clock.ts の todayJST()。判定は lib/subscription-detail.ts）
//   ② サービス名・アイコン・カテゴリー・プラン名・支払方法（入力があるときだけ）・次回請求予定（次回請求日は API の値をそのまま出す）
//   ③ 月額換算・④ 年額換算（参考）（1件分。計算できないときは「―」）
//   「登録情報」⑤ 無料トライアル・⑥ 公式サイト・⑦ 解約ページ（http(s) のときだけリンク。新しいタブ）・⑧ メモ（未入力・空白だけなら出さない）
//   ⑨ 編集する（S-05 の編集へ）・⑩ 削除する（確認ダイアログ → DELETE → 「削除しました」を置いて S-04 へ置き換える）・⑪ 注意書き
//   読み込み中・読み込み失敗（［再試行］）・404 の「見つかりません」と［一覧へ戻る］。
//   Push から開いたとき（?from=push）の 404 は、「見つかりません」を出さずに「読み込み中…」のまま S-08 へ履歴を置き換えて移る
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog } from '@/components/Dialog';
import { IconBadge } from '@/components/IconBadge';
import { SubscriptionNotFound } from '@/components/SubscriptionNotFound';
import { Button, Card, LoadError, Loading, PageTitle, commonErrorMessage } from '@/components/ui';
import { ApiClientError, api, isGateError } from '@/lib/api-client';
import { todayJST } from '@/lib/clock';
import { setFlash } from '@/lib/flash';
import { CATEGORY_LABELS, formatMonthDay, formatYen } from '@/lib/format';
import {
  DETAIL_MESSAGES,
  annualEquivalentOf,
  cancelGuideOf,
  cancelGuideText,
  hasMemo,
  hasPaymentMethod,
  monthlyEquivalentOf,
} from '@/lib/subscription-detail';
import type { SubscriptionDto } from '@/lib/types';
import { useSubscription } from '@/lib/use-subscription';
import { hasHttpScheme } from '@/lib/validation';

// Push 通知から開いたか（Service Worker が ?from=push を付ける。API共通仕様 B107）
function openedFromPush(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('from') === 'push';
}

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { status, subscription, error, reload } = useSubscription(id);
  const [fromPush, setFromPush] = useState(false);

  useEffect(() => {
    setFromPush(openedFromPush());
  }, []);

  // Push から開いたときの 404 は、S-08 へ履歴を置き換えて移る
  const goNotifications = status === 'notFound' && fromPush;
  useEffect(() => {
    if (goNotifications) router.replace('/notifications');
  }, [goNotifications, router]);

  return (
    <>
      <PageTitle brand>サービス詳細</PageTitle>
      <main className="p-4">
        {(status === 'loading' || goNotifications) && <Loading />}
        {status === 'error' && <LoadError error={error} onRetry={reload} />}
        {status === 'notFound' && !goNotifications && <SubscriptionNotFound />}
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
  const guide = cancelGuideOf(subscription, todayJST());
  const monthly = monthlyEquivalentOf(subscription.price, subscription.billingCycle);
  const annual = annualEquivalentOf(subscription.price, subscription.billingCycle);
  return (
    <div className="flex flex-col gap-4">
      {/* ① 解約案内（条件に当たるときだけ。②の上） */}
      {guide && <CancelGuideCard lines={cancelGuideText(guide)} cancelUrl={subscription.cancelUrl} />}

      {/* ② サービス名・支払方法・次回請求予定 */}
      <Card as="section">
        <div className="flex items-center gap-4">
          <IconBadge serviceName={subscription.serviceName} websiteUrl={subscription.websiteUrl} size={56} />
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-xl font-bold">{subscription.serviceName}</h2>
            <p className="break-words text-sm text-gray-500">{categoryAndPlan(subscription)}</p>
            {hasPaymentMethod(subscription.paymentMethod) && (
              <p className="break-words text-sm text-gray-500">支払方法：{subscription.paymentMethod}</p>
            )}
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-gray-200 pt-3">
          <p className="text-sm text-gray-500">次回請求予定</p>
          <p className="text-lg font-bold">
            {formatMonthDay(subscription.nextBillingDate)}・{formatYen(subscription.price)}
          </p>
        </div>
      </Card>

      {/* ③ 月額換算・④ 年額換算（参考） */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <p className="text-sm text-gray-500">月額換算</p>
          <p className="mt-2 break-all text-2xl font-bold">{monthly === null ? '―' : formatYen(monthly)}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">年額換算（参考）</p>
          <p className="mt-2 break-all text-2xl font-bold">{annual === null ? '―' : formatYen(annual)}</p>
        </Card>
      </div>

      {/* 登録情報：⑤ 無料トライアル・⑥ 公式サイト・⑦ 解約ページ・⑧ メモ */}
      <h2 className="mt-2 text-lg font-bold">登録情報</h2>
      <InfoRow title="無料トライアル">
        {subscription.trialEnabled ? (
          <>
            <p>最終無料日：{formatMonthDay(subscription.trialEndDate)}</p>
            <p className="text-sm">{DETAIL_MESSAGES.trialFreeUntil}</p>
          </>
        ) : (
          <p>{DETAIL_MESSAGES.trialNotApplicable}</p>
        )}
      </InfoRow>
      <InfoRow title="公式サイト">
        <UrlValue url={subscription.websiteUrl} />
      </InfoRow>
      <InfoRow title="解約ページ">
        <UrlValue url={subscription.cancelUrl} />
      </InfoRow>
      {hasMemo(subscription.memo) && (
        <InfoRow title="メモ">
          <p className="whitespace-pre-wrap break-words">{subscription.memo}</p>
        </InfoRow>
      )}

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

// ① 解約案内のカード。見出し「解約を検討するタイミングです」、文の2行、その下に［解約ページを開く］（新しいタブ）。
// 解約URLが未登録のときはボタンの代わりに「未登録：編集で追加できます」。http(s) でない値（ふつうは保存できない）はボタンにせず文字だけを出す（⑦と同じ判定）
function CancelGuideCard({ lines, cancelUrl }: { lines: { lead: string; body: string }; cancelUrl: string | null }) {
  return (
    <div className="rounded-2xl bg-brand-light p-4">
      <h2 className="font-bold text-brand">{DETAIL_MESSAGES.cancelGuideTitle}</h2>
      <p className="mt-2 text-sm font-bold">{lines.lead}</p>
      <p className="mt-1 text-sm text-gray-600">{lines.body}</p>
      {!cancelUrl ? (
        <p className="mt-1 text-xs text-gray-500">{DETAIL_MESSAGES.notRegistered}</p>
      ) : hasHttpScheme(cancelUrl) ? (
        <a
          href={cancelUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-brand px-4 py-2 font-bold text-white hover:bg-blue-700"
        >
          {DETAIL_MESSAGES.openCancelPage}
        </a>
      ) : (
        <p className="mt-1 break-all text-xs text-gray-500">{cancelUrl}</p>
      )}
    </div>
  );
}

// ⑤〜⑧の行（白い枠。題と値）
function InfoRow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <h3 className="font-bold">{title}</h3>
      <div className="mt-1 text-gray-600">{children}</div>
    </Card>
  );
}

// ⑥⑦の値：http(s) で始まるときだけリンク（新しいタブ）。未登録は「未登録：編集で追加できます」。合わない値は文字だけ
function UrlValue({ url }: { url: string | null }) {
  if (!url) return <p>{DETAIL_MESSAGES.notRegistered}</p>;
  if (!hasHttpScheme(url)) return <p className="break-all">{url}</p>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 max-w-full items-center break-all text-brand underline">
      {url}
    </a>
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
