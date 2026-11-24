'use client';
// S-04 サブスク一覧画面（04-09。画面設計書 S-04、詳細_F-04）
// ・開くたびに GET /api/subscriptions（最大200件。作成日時の昇順）を読み、既定の並び（次回請求日が近い順。同じ日は登録の古い順）で全件を出す
// ・開いたときに takeFlash() の文（S-06 で削除した後の「削除しました」。04-08 が置く）があれば、画面名の下（①の上）に出す
// ・件数の欄は作らない（S-03 の登録数と比べるのはカードの数）
// ・①検索・②カテゴリー・③並べ替えは 04-20（Want）が足す（このタスクで変えてよい範囲は 04-20 の指示書）。作らないときは出さない
// ・04-20：①②③と検索0件の表示（⑦「条件に合うサブスクはありません」）を足した。絞り込み・並べ替えは lib/subscription-list.ts で、
//   API は呼び直さない。①②③は読み込み中・読み込み失敗・登録0件のときも出す。検索語・カテゴリー・並べ替えは保存しない（開き直すと既定）
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconBadge } from '@/components/IconBadge';
import { Button, EmptyState, LoadError, Loading, PageTitle, Select, TextField } from '@/components/ui';
import { api, isGateError } from '@/lib/api-client';
import { BILLING_CYCLE_UNIT_LABELS, CATEGORY_LABELS, formatMonthDay, formatYen } from '@/lib/format';
import { takeFlash } from '@/lib/flash';
import {
  CATEGORY_FILTERS,
  DEFAULT_CATEGORY,
  DEFAULT_SORT,
  SORT_OPTIONS,
  isSubscriptionSort,
  viewSubscriptions,
  type CategoryFilter,
  type SubscriptionSort,
} from '@/lib/subscription-list';
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

// ① 検索欄（04-20）。見えないラベルと placeholder は「サービス名で検索」。1文字ごとに絞り込む（検索ボタンは置かない）
function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="relative">
      <TextField
        id="subscription-search"
        type="search"
        label={<span className="sr-only">サービス名で検索</span>}
        placeholder="サービス名で検索"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{ paddingLeft: '2.75rem' }}
      />
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="pointer-events-none absolute bottom-3 left-3 h-5 w-5 text-gray-500"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <circle cx="10" cy="10" r="6" />
        <path d="M15 15l5 5" />
      </svg>
    </div>
  );
}

// ② カテゴリーのタブ（04-20）。横スクロールはこの枠の中だけ。選択中は aria-pressed
function CategoryTabs({ value, onChange }: { value: CategoryFilter; onChange: (value: CategoryFilter) => void }) {
  return (
    <div role="group" aria-label="カテゴリー" className="flex gap-1 overflow-x-auto rounded-2xl bg-brand-light p-1">
      {CATEGORY_FILTERS.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`min-h-11 min-w-11 shrink-0 whitespace-nowrap rounded-xl px-4 text-base ${
              selected ? 'bg-white font-bold text-brand shadow-sm' : 'text-gray-600 hover:bg-white/60'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export default function SubscriptionsPage() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [flash, setFlashText] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>(DEFAULT_CATEGORY);
  const [sort, setSort] = useState<SubscriptionSort>(DEFAULT_SORT);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const data = await api<SubscriptionListDto>('/api/subscriptions');
      setState({ status: 'ready', items: data.items }); // API の並び（作成日時の昇順）のまま持ち、表示の並びは下の viewSubscriptions で決める
    } catch (error) {
      if (isGateError(error)) return; // ゲートが画面を切り替える（それまで「読み込み中…」のまま）
      setState({ status: 'error', error });
    }
  }, []);

  useEffect(() => {
    setFlashText(takeFlash());
    void load();
  }, [load]);

  const visibleItems = useMemo(
    () => (state.status === 'ready' ? viewSubscriptions(state.items, { query, category, sort }) : []),
    [state, query, category, sort],
  );

  return (
    <>
      <PageTitle brand>サブスク一覧</PageTitle>
      <main className="flex flex-col gap-3 px-4 pb-4">
        {flash && (
          <p role="status" className="rounded-2xl border border-blue-200 bg-blue-50 p-4 font-bold text-brand">
            {flash}
          </p>
        )}
        <SearchField value={query} onChange={setQuery} />
        <CategoryTabs value={category} onChange={setCategory} />
        <Select
          id="subscription-sort"
          label={<span className="sr-only">並べ替え</span>}
          options={SORT_OPTIONS}
          value={sort}
          onChange={(event) => {
            if (isSubscriptionSort(event.target.value)) setSort(event.target.value);
          }}
          className="w-fit min-w-[14rem] max-w-full"
        />
        {state.status === 'loading' && <Loading />}
        {state.status === 'error' && <LoadError error={state.error} onRetry={() => void load()} />}
        {state.status === 'ready' &&
          (state.items.length === 0 ? (
            <div className="rounded-2xl border border-gray-200 bg-white py-16">
              <EmptyState title="サブスクを登録していません" description="下の［サブスクを追加］から最初のサブスクを登録しましょう" />
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="rounded-2xl border border-gray-200 bg-white py-16">
              <EmptyState title="条件に合うサブスクはありません" />
            </div>
          ) : (
            <ul className="flex flex-col gap-3" aria-label="サブスク一覧">
              {visibleItems.map((sub) => (
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
