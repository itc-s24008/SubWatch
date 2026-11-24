'use client';
// S-08 通知センター画面（04-21。画面設計書 2.画面詳細(S-08)・状態・ダイアログ一覧の S-08、詳細_F-12 の手順1〜4、API共通仕様 B24・B94・B108、
// 決まりの一覧 C-14）
// ・開くと GET /api/notifications?filter=all&limit=20 を読む。②のフィルターを変えると filter を変えて読み直す。
//   素早く切り替えたときは、最後に頼んだフィルターの応答だけを使う（先に頼んだ応答が遅れて届いても使わない）
// ・①の未読件数は、まだ1回も読めていない間は出さない。フィルターを変えている間は前の数のまま。
//   既読にしたら読み直さずに画面で変える（1件なら1減らし、「すべて既読にする」の後は0）。S-03 ①のバッジは S-03 が開くたびに読む
// ・［詳細を見る］：未読なら POST /api/notifications/:id/read で既読にしてから S-06 へ。既読なら API を呼ばずに S-06 へ。
//   既読にできなかったら移動せず、そのカードのすぐ下に「既読にできませんでした。もう一度お試しください」（オフライン・503 でも、この文）
// ・サブスクが削除された通知（subscriptionExists=false）は［詳細を見る］を出さず、未読ならカードを押すと既読にする（移動しない）。
//   既読ならカードは押せない。サブスクがあるときは、カード本体を押しても何もしない
// ・「すべて既読にする」は POST /api/notifications/read-all。通知カードが1件以上出ているときだけ押せる。失敗の文はフィルターの枠のすぐ下
// ・「未読」のフィルターでは既読にした通知を一覧から外す。ほかのフィルターでは、その場で既読の表示に変える。既読の処理の間は、
//   フィルター・［さらに読み込む］・ほかのカードを押せない
// ・［さらに読み込む］は nextCursor があるときだけ。続きを読めなかったら、読んだ分を残してボタンの位置に読み込み失敗の文と［再試行］
// ・読み込み中は「読み込み中…」、失敗は「通知を読み込めませんでした。もう一度お試しください」と［再試行］（オフライン・一時的な障害は共通の文）
// ・ゲートのエラー（401・同意が必要な 409）のときは文を出さない（ゲートが画面を切り替える。それまで「読み込み中…」のまま）
// ・アイコンは常に頭文字（IconBadge initialOnly）。title・body は保存された文をそのまま出す（画面で組み立て直さない）
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { IconBadge } from '@/components/IconBadge';
import { Button, Card, EmptyState, LoadError, Loading, PageTitle } from '@/components/ui';
import { api, isGateError } from '@/lib/api-client';
import { addDays } from '@/lib/billing';
import { todayJST } from '@/lib/clock';
import { formatMonthDay, formatTimeJST, formatUnreadBadge } from '@/lib/format';
import type { MarkReadResult, NotificationDto, NotificationFilter, NotificationListDto, ReadAllResult } from '@/lib/types';

type ListState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; items: NotificationDto[]; nextCursor: string | null };
type MoreState = { status: 'idle' } | { status: 'loading' } | { status: 'error'; error: unknown };

const PAGE_LIMIT = 20;
const LOAD_FAILED = '通知を読み込めませんでした。もう一度お試しください';
const READ_FAILED = '既読にできませんでした。もう一度お試しください';
const EMPTY = '通知はまだありません';
const EMPTY_UNREAD = '未読の通知はありません';
const EMPTY_DESCRIPTION = '請求予定の通知がここに表示されます';
const FILTERS: { value: NotificationFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'unread', label: '未読' },
  { value: 'billing', label: '請求' },
  { value: 'trial_end', label: 'トライアル' },
];
const TYPE_LABELS: Record<NotificationDto['notificationType'], string> = { billing: '請求', trial_end: 'トライアル' };

function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

function listPath(filter: NotificationFilter, cursor: string | null): string {
  const params = new URLSearchParams({ filter, limit: String(PAGE_LIMIT) });
  if (cursor) params.set('cursor', cursor);
  return `/api/notifications?${params.toString()}`;
}

// ③の日付見出し：日本時間の今日なら「今日」、前日なら「昨日」、それ以外は MM/DD（作成日時の日本時間の日付）
function dateLabel(createdAt: string, today: string): string {
  const time = Date.parse(createdAt);
  if (Number.isNaN(time)) return '―';
  const date = todayJST(new Date(time));
  if (date === today) return '今日';
  try {
    if (date === addDays(today, -1)) return '昨日';
  } catch {
    // 今日が範囲の外のときは MM/DD で出す
  }
  return formatMonthDay(date);
}

// 並び（新しい順）を保ったまま、同じ日付見出しの通知をまとめる
function groupByDate(items: NotificationDto[], today: string): { label: string; items: NotificationDto[] }[] {
  const groups: { label: string; items: NotificationDto[] }[] = [];
  for (const item of items) {
    const label = dateLabel(item.createdAt, today);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

// ①未読件数（0件は灰色で「0」、100件以上は「99+」）。数は aria-hidden にして、題の読み上げは「（未読N件）」
function UnreadBadge({ count }: { count: number }) {
  return (
    <>
      <span
        aria-hidden="true"
        data-testid="unread-count"
        className={cx(
          'ml-3 inline-flex h-9 min-w-9 items-center justify-center rounded-full px-2 align-middle text-base font-bold text-white',
          count > 0 ? 'bg-brand' : 'bg-gray-400',
        )}
      >
        {formatUnreadBadge(count)}
      </span>
      <span className="sr-only">（未読{count}件）</span>
    </>
  );
}

function NotificationCard({
  item,
  disabled,
  error,
  onOpen,
  onRead,
}: {
  item: NotificationDto;
  disabled: boolean;
  error: boolean;
  onOpen: (item: NotificationDto) => void;
  onRead: (item: NotificationDto) => void;
}) {
  const unread = item.viewedAt === null;
  const cardClass = 'relative block w-full rounded-2xl border border-gray-200 bg-white p-4 text-left';
  const body = (
    <span className="flex items-start gap-3">
      {unread && <span aria-hidden="true" className="absolute left-2 top-3 h-2.5 w-2.5 rounded-full bg-brand" />}
      <IconBadge serviceName={item.serviceNameAtNotification} initialOnly />
      <span className="block min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className={cx('block min-w-0 break-words', unread && 'font-bold')}>
            {unread && <span className="sr-only">未読 </span>}
            {item.serviceNameAtNotification}
          </span>
          <span className="shrink-0 text-sm text-gray-500">{formatTimeJST(item.createdAt)}</span>
        </span>
        <span className={cx('mt-1 block break-words', unread && 'font-bold')}>{item.title}</span>
        <span className="mt-1 block break-words text-sm text-gray-500">{item.body}</span>
        <span className="mt-1 flex min-h-11 items-center justify-between gap-2">
          {item.subscriptionExists ? (
            <button
              type="button"
              className="inline-flex min-h-11 min-w-11 items-center font-bold text-brand disabled:cursor-not-allowed disabled:text-gray-400"
              disabled={disabled}
              onClick={() => onOpen(item)}
            >
              詳細を見る<span aria-hidden="true">&nbsp;›</span>
            </button>
          ) : (
            <span />
          )}
          <span className="shrink-0 rounded-lg bg-brand-light px-3 py-1 text-sm font-bold text-brand">{TYPE_LABELS[item.notificationType] ?? ''}</span>
        </span>
      </span>
    </span>
  );

  return (
    <div>
      {!item.subscriptionExists && unread ? (
        // サブスクが削除された未読の通知：カードを押すと既読にする（移動しない）
        <button type="button" className={cx(cardClass, 'disabled:cursor-not-allowed')} disabled={disabled} onClick={() => onRead(item)} data-testid="notification-card">
          {body}
        </button>
      ) : (
        <div className={cardClass} data-testid="notification-card">
          {body}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {READ_FAILED}
        </p>
      )}
    </div>
  );
}

export default function NotificationsPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [more, setMore] = useState<MoreState>({ status: 'idle' });
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false); // 既読の処理中
  const [filterError, setFilterError] = useState<string | null>(null); // 「すべて既読にする」の失敗
  const [cardError, setCardError] = useState<string | null>(null); // 既読にできなかったカードの notificationId
  const seqRef = useRef(0); // 最後に頼んだ読み込みの番号（古い応答で上書きしない）
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async (nextFilter: NotificationFilter) => {
    seqRef.current += 1;
    const seq = seqRef.current;
    setList({ status: 'loading' });
    setMore({ status: 'idle' });
    setFilterError(null);
    setCardError(null);
    try {
      const data = await api<NotificationListDto>(listPath(nextFilter, null));
      if (!mounted.current || seq !== seqRef.current) return;
      setList({ status: 'ready', items: data.items, nextCursor: data.nextCursor });
      setUnreadCount(data.unreadCount);
    } catch (error) {
      if (!mounted.current || seq !== seqRef.current) return;
      if (isGateError(error)) return; // ゲートが画面を切り替える。「読み込み中…」のまま
      setList({ status: 'error', error });
    }
  }, []);

  useEffect(() => {
    void load('all');
  }, [load]);

  function changeFilter(next: NotificationFilter) {
    if (busy || next === filter) return;
    setFilter(next);
    void load(next);
  }

  async function loadMore() {
    if (list.status !== 'ready' || !list.nextCursor || busy || more.status === 'loading') return;
    const seq = seqRef.current;
    const cursor = list.nextCursor;
    setMore({ status: 'loading' });
    try {
      const data = await api<NotificationListDto>(listPath(filter, cursor));
      if (!mounted.current || seq !== seqRef.current) return;
      setList((prev) => {
        if (prev.status !== 'ready') return prev;
        const shown = new Set(prev.items.map((item) => item.notificationId));
        return { status: 'ready', items: [...prev.items, ...data.items.filter((item) => !shown.has(item.notificationId))], nextCursor: data.nextCursor };
      });
      setUnreadCount(data.unreadCount);
      setMore({ status: 'idle' });
    } catch (error) {
      if (!mounted.current || seq !== seqRef.current) return;
      if (isGateError(error)) return;
      setMore({ status: 'error', error });
    }
  }

  // 既読にした通知を画面に反映する（「未読」のフィルターでは一覧から外す）
  function applyRead(ids: Set<string> | 'all', viewedAt: string) {
    const hit = (item: NotificationDto) => item.viewedAt === null && (ids === 'all' || ids.has(item.notificationId));
    setList((prev) => {
      if (prev.status !== 'ready') return prev;
      if (filter === 'unread') {
        return ids === 'all' ? { status: 'ready', items: [], nextCursor: null } : { ...prev, items: prev.items.filter((item) => !hit(item)) };
      }
      return { ...prev, items: prev.items.map((item) => (hit(item) ? { ...item, viewedAt } : item)) };
    });
  }

  // 1件を既読にする。できたら true
  async function markRead(item: NotificationDto): Promise<boolean> {
    setBusy(true);
    setCardError(null);
    setFilterError(null);
    try {
      const result = await api<MarkReadResult>(`/api/notifications/${encodeURIComponent(item.notificationId)}/read`, { method: 'POST' });
      if (!mounted.current) return true;
      applyRead(new Set([item.notificationId]), result.viewedAt);
      setUnreadCount((count) => (count === null ? count : Math.max(0, count - 1)));
      return true;
    } catch (error) {
      if (!mounted.current) return false;
      if (isGateError(error)) return false; // 文を出さない（ゲートが画面を切り替える）
      setCardError(item.notificationId);
      return false;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function openDetail(item: NotificationDto) {
    if (busy) return;
    const href = `/subscriptions/${encodeURIComponent(item.subscriptionId)}`;
    if (item.viewedAt !== null) {
      router.push(href); // すでに既読：API を呼ばずに移動する
      return;
    }
    if (await markRead(item)) router.push(href);
  }

  async function readOnly(item: NotificationDto) {
    if (busy) return;
    await markRead(item);
  }

  async function readAll() {
    if (busy || list.status !== 'ready' || list.items.length === 0 || more.status === 'loading') return;
    setBusy(true);
    setFilterError(null);
    setCardError(null);
    try {
      await api<ReadAllResult>('/api/notifications/read-all', { method: 'POST' });
      if (!mounted.current) return;
      applyRead('all', new Date().toISOString());
      setUnreadCount(0);
    } catch (error) {
      if (!mounted.current) return;
      if (isGateError(error)) return;
      setFilterError(READ_FAILED);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const today = todayJST();
  const canReadAll = list.status === 'ready' && list.items.length > 0 && !busy && more.status !== 'loading';

  return (
    <>
      <PageTitle brand>
        通知センター
        {unreadCount !== null && <UnreadBadge count={unreadCount} />}
      </PageTitle>
      <main className="flex flex-col gap-3 p-4">
        <Card className="py-2">
          <div className="flex flex-wrap items-center gap-1">
            <div role="group" aria-label="フィルター" className="flex flex-wrap gap-1">
              {FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={filter === option.value}
                  disabled={busy}
                  onClick={() => changeFilter(option.value)}
                  className={cx(
                    'inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl px-3 font-bold disabled:cursor-not-allowed',
                    filter === option.value ? 'bg-brand-light text-brand' : 'text-gray-600',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={!canReadAll}
              onClick={() => void readAll()}
              className="ml-auto inline-flex min-h-11 min-w-11 items-center px-2 font-bold text-brand disabled:cursor-not-allowed disabled:text-gray-400"
            >
              すべて既読にする
            </button>
          </div>
          {filterError && (
            <p role="alert" className="mt-1 text-sm text-red-600">
              {filterError}
            </p>
          )}
        </Card>

        {list.status === 'loading' && <Loading />}
        {list.status === 'error' && <LoadError error={list.error} message={LOAD_FAILED} onRetry={() => void load(filter)} />}
        {list.status === 'ready' && list.items.length === 0 && (
          <Card>
            <EmptyState title={filter === 'unread' ? EMPTY_UNREAD : EMPTY} description={EMPTY_DESCRIPTION} />
          </Card>
        )}
        {list.status === 'ready' &&
          groupByDate(list.items, today).map((group, index) => (
            <section key={`${group.label}-${index}`} className="flex flex-col gap-3">
              <h2 className="text-sm font-bold text-gray-500">{group.label}</h2>
              {group.items.map((item) => (
                <NotificationCard
                  key={item.notificationId}
                  item={item}
                  disabled={busy}
                  error={cardError === item.notificationId}
                  onOpen={(target) => void openDetail(target)}
                  onRead={(target) => void readOnly(target)}
                />
              ))}
            </section>
          ))}
        {list.status === 'ready' && list.nextCursor !== null && more.status !== 'error' && (
          <Button variant="secondary" className="self-center" disabled={busy || more.status === 'loading'} onClick={() => void loadMore()}>
            {more.status === 'loading' ? '読み込み中…' : 'さらに読み込む'}
          </Button>
        )}
        {list.status === 'ready' && more.status === 'error' && <LoadError error={more.error} message={LOAD_FAILED} onRetry={() => void loadMore()} />}

        <div className="rounded-2xl bg-brand-light p-4">
          <h2 className="font-bold text-brand">通知の意味</h2>
          <p className="mt-1 text-sm text-gray-600">請求予定通知は決済完了の通知ではありません</p>
        </div>
      </main>
    </>
  );
}
