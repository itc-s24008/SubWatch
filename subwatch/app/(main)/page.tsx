'use client';
// S-03 ホーム画面（04-09。画面設計書 S-03、詳細_F-04）
// ・開くたびに GET /api/dashboard を読む（未読のバッジも、開くたびに読んだ数。画面をまたいで数を持ち回らない）
// ・読み込み中は「読み込み中…」。失敗は「請求予定を読み込めませんでした。もう一度お試しください」と［再試行］（オフライン・一時的な障害は共通の文）。
//   失敗のときは②〜⑨を出さず、①のベルはバッジなしで出す
// ・登録0件：金額は「¥0」「0件」、一覧の位置に「登録されたサブスクがありません」、⑨は「サブスクを登録する」
// ・7日以内の請求なし：②は「次の請求予定／7日以内の請求予定はありません」、一覧の位置も「7日以内の請求予定はありません」
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { IconBadge } from '@/components/IconBadge';
import { Brand, Button, Card, LoadError, Loading, PageTitle } from '@/components/ui';
import { api, isGateError } from '@/lib/api-client';
import { formatMonthDay, formatUnreadBadge, formatYen } from '@/lib/format';
import type { DashboardDto } from '@/lib/types';

type State = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; data: DashboardDto };

const LOAD_FAILED = '請求予定を読み込めませんでした。もう一度お試しください';
const NO_BILLS = '7日以内の請求予定はありません';

function BellLink({ unreadCount }: { unreadCount: number }) {
  const label = unreadCount > 0 ? `通知センター（未読${unreadCount}件）` : '通知センター';
  return (
    <Link href="/notifications" aria-label={label} className="relative inline-flex h-11 w-11 items-center justify-center text-brand">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15L6 16zM10 20a2 2 0 004 0" />
      </svg>
      {unreadCount > 0 && (
        <span aria-hidden="true" className="absolute right-0 top-0 min-w-5 rounded-full bg-brand px-1 text-center text-xs font-bold leading-5 text-white">
          {formatUnreadBadge(unreadCount)}
        </span>
      )}
    </Link>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      {sub !== undefined && <p className="text-sm text-gray-500">{sub}</p>}
    </Card>
  );
}

function Dashboard({ data }: { data: DashboardDto }) {
  const empty = data.subscriptionCount === 0;
  const first = data.nextBills[0];
  return (
    <>
      {first ? (
        <Link href={`/subscriptions/${first.subscriptionId}`} className="block rounded-2xl bg-indigo-600 p-5 text-white">
          <p>次の請求まであと{first.daysLeft}日</p>
          <p className="mt-2 flex items-center gap-3 text-2xl font-bold">
            <IconBadge serviceName={first.serviceName} websiteUrl={first.websiteUrl} size={44} />
            <span className="min-w-0 break-words">{first.serviceName}</span>
          </p>
          <p className="mt-2">
            {formatMonthDay(first.date)}・{formatYen(first.priceJPY)}・あと{first.daysLeft}日
          </p>
        </Link>
      ) : (
        <div className="rounded-2xl bg-indigo-600 p-5 text-white">
          <p>次の請求予定</p>
          <p className="mt-2 text-xl font-bold">{NO_BILLS}</p>
        </div>
      )}

      <section aria-labelledby="home-month" className="flex flex-col gap-3">
        <h2 id="home-month" className="mt-2 text-lg font-bold">
          今月の請求予定
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="今月の予定額" value={formatYen(data.monthTotal.amountJPY)} sub={`${data.monthTotal.count}件`} />
          <StatCard label="今週の予定額" value={formatYen(data.weekTotal.amountJPY)} sub={`${data.weekTotal.count}件`} />
          <StatCard label="登録数" value={`${data.subscriptionCount}件`} />
          <StatCard label="月額換算 / 年額換算" value={formatYen(data.monthlyEquivalentJPY)} sub={formatYen(data.yearlyEquivalentJPY)} />
        </div>
      </section>

      <section aria-labelledby="home-upcoming" className="flex flex-col gap-3">
        <div className="mt-2 flex items-center justify-between">
          <h2 id="home-upcoming" className="text-lg font-bold">
            今後の支払い予定
          </h2>
          <Link href="/subscriptions" className="inline-flex min-h-11 items-center text-sm font-bold text-brand">
            すべて見る ›
          </Link>
        </div>
        {empty ? (
          <Card className="py-10 text-center">
            <p className="font-bold">登録されたサブスクがありません</p>
            <p className="mt-2 text-sm text-gray-500">サブスクを追加して、請求予定をまとめて管理しましょう</p>
          </Card>
        ) : data.nextBills.length === 0 ? (
          <Card className="py-8 text-center">
            <p className="font-bold">{NO_BILLS}</p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.nextBills.map((bill) => (
              <li key={bill.subscriptionId}>
                <Link
                  href={`/subscriptions/${bill.subscriptionId}`}
                  className="flex min-h-11 items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 hover:bg-gray-50"
                >
                  <IconBadge serviceName={bill.serviceName} websiteUrl={bill.websiteUrl} />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-bold">{bill.serviceName}</span>
                    <span className="block text-sm text-gray-500">
                      {formatMonthDay(bill.date)} {formatYen(bill.priceJPY)} あと{bill.daysLeft}日
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="rounded-2xl bg-brand-light p-4">
        <p className="text-sm font-bold text-brand">予定額は登録内容からの予測です</p>
        <p className="mt-1 text-xs text-gray-500">実際の決済額・支払い済み状態ではありません</p>
      </div>

      <Button href="/subscriptions/new" fullWidth className="min-h-14">
        {empty ? '＋ サブスクを登録する' : '＋ サブスクを追加'}
      </Button>
    </>
  );
}

export default function HomePage() {
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const data = await api<DashboardDto>('/api/dashboard');
      setState({ status: 'ready', data });
    } catch (error) {
      if (isGateError(error)) return; // ゲートが画面を切り替える（それまで「読み込み中…」のまま）
      setState({ status: 'error', error });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="flex items-center justify-between bg-white px-4 pt-4">
        <Brand className="text-2xl" />
        <BellLink unreadCount={state.status === 'ready' ? state.data.unreadCount : 0} />
      </div>
      <PageTitle>ホーム</PageTitle>
      <main className="flex flex-col gap-3 px-4 pb-4">
        <p className="-mt-2 text-sm text-gray-500">請求予定をまとめて確認</p>
        {state.status === 'loading' && <Loading />}
        {state.status === 'error' && <LoadError error={state.error} message={LOAD_FAILED} onRetry={() => void load()} />}
        {state.status === 'ready' && <Dashboard data={state.data} />}
      </main>
    </>
  );
}
