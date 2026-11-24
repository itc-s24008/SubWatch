'use client';
// S-04 サブスク一覧画面（04-09。画面設計書 S-04、詳細_F-04）
// ・開くたびに GET /api/subscriptions（最大200件。作成日時の昇順）を読み、既定の並び（次回請求日が近い順。同じ日は登録の古い順）で全件を出す
// ・開いたときに takeFlash() の文（S-06 で削除した後の「削除しました」。04-08 が置く）があれば、画面名の下（①の上）に出す
// ・件数の欄は作らない（S-03 の登録数と比べるのはカードの数）
// ・①検索・②カテゴリー・③並べ替えは 04-20（Want）が足す（このタスクで変えてよい範囲は 04-20 の指示書）。作らないときは出さない
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { IconBadge } from '@/components/IconBadge';
import { Button, EmptyState, LoadError, Loading, PageTitle } from '@/components/ui';
import { api, isGateError } from '@/lib/api-client';
import { BILLING_CYCLE_UNIT_LABELS, CATEGORY_LABELS, formatMonthDay, formatYen } from '@/lib/format';
import { takeFlash } from '@/lib/flash';
import { sortByNextBillingDate } from '@/lib/subscription-order';
import type { SubscriptionDto, SubscriptionListDto } from '@/lib/types';

type State = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; items: SubscriptionDto[] };

function SubscriptionCard({ sub }: { sub: SubscriptionDto }) {
  const category = CATEGORY_LABELS[sub.category] ?? '―';
  const unit = BILLING_CYCLE_UNIT_LABELS[sub.billingCycle] ?? '―';
  return (
    <Link
      href={`/subscriptions/${sub.subscriptionId}`}
      className="flex min-h-11 items-center gap-4 rounded-2xl border border-gray-200 bg-white p-4 hover:bg-gray-50"
    >
      <IconBadge serviceName={sub.serviceName} websiteUrl={sub.websiteUrl} size={56} />
      <span className="min-w-0 flex-1">
        <span className="block break-words text-lg font-bold">{sub.serviceName}</span>
        <span className="block text-sm text-gray-500">
          {category}・{formatYen(sub.price)} / {unit}
        </span>
        <span className="block text-sm text-gray-500">次回請求 {formatMonthDay(sub.nextBillingDate)}</span>
      </span>
      <span aria-hidden="true" className="text-xl text-brand">
        ›
      </span>
    </Link>
  );
}

export default function SubscriptionsPage() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [flash, setFlashText] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const data = await api<SubscriptionListDto>('/api/subscriptions');
      setState({ status: 'ready', items: sortByNextBillingDate(data.items) });
    } catch (error) {
      if (isGateError(error)) return; // ゲートが画面を切り替える（それまで「読み込み中…」のまま）
      setState({ status: 'error', error });
    }
  }, []);

  useEffect(() => {
    setFlashText(takeFlash());
    void load();
  }, [load]);

  return (
    <>
      <PageTitle brand>サブスク一覧</PageTitle>
      <main className="flex flex-col gap-3 px-4 pb-4">
        {flash && (
          <p role="status" className="rounded-2xl border border-blue-200 bg-blue-50 p-4 font-bold text-brand">
            {flash}
          </p>
        )}
        {state.status === 'loading' && <Loading />}
        {state.status === 'error' && <LoadError error={state.error} onRetry={() => void load()} />}
        {state.status === 'ready' &&
          (state.items.length === 0 ? (
            <div className="rounded-2xl border border-gray-200 bg-white py-16">
              <EmptyState title="サブスクを登録していません" description="下の［サブスクを追加］から最初のサブスクを登録しましょう" />
            </div>
          ) : (
            <ul className="flex flex-col gap-3" aria-label="サブスク一覧">
              {state.items.map((sub) => (
                <li key={sub.subscriptionId}>
                  <SubscriptionCard sub={sub} />
                </li>
              ))}
            </ul>
          ))}
        <Button href="/subscriptions/new" fullWidth className="mt-4 min-h-14">
          ＋ サブスクを追加
        </Button>
      </main>
    </>
  );
}
