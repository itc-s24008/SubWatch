'use client';
// S-07 請求カレンダー画面（04-13。画面設計書 2.画面詳細(S-07)・状態・ダイアログ一覧の S-07、詳細_F-05、API共通仕様 B77）
// ・開くと、今月（日本時間の今日の月。2000-01〜2100-12 の外なら近い方の端）を指定して GET /api/calendar?month=YYYY-MM を読む。
//   URL の month は読まない
// ・①［前月］［翌月］で月を切り替える（同じ API を読み直す）。続けて切り替えたときは、最後に頼んだ月の応答だけを使う
//   （先に頼んだ月の応答が遅れて届いても使わない）。2000年1月では［前月］、2100年12月では［翌月］を押せない
// ・読み込み中は「読み込み中…」、失敗は「カレンダーを読み込めませんでした。もう一度お試しください」と［再試行］
//   （オフライン・一時的な障害は共通の文）。どちらのときも見出しと①（画面が指定した月）は出し、②〜⑦は読めたときだけ出す
// ・API が 400 を返したときだけ、今月を指定して読み直す（それも 400 なら読み込み失敗の表示）
// ・ゲートのエラー（401・同意が必要な 409）のときは文を出さない（ゲートが画面を切り替える。それまで「読み込み中…」のまま）
// ・月を表示したときに選ぶ日は、今月なら今日、ほかの月なら1日。サービスのアイコンは常に頭文字（IconBadge initialOnly）
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { IconBadge } from '@/components/IconBadge';
import { Card, LoadError, Loading, PageTitle } from '@/components/ui';
import { ApiClientError, api, isGateError } from '@/lib/api-client';
import {
  calendarMonthOf,
  calendarWeeks,
  dayLabel,
  initialSelectedDate,
  isCalendarMonth,
  monthLabel,
  monthNumberLabel,
  shiftMonth,
} from '@/lib/calendar';
import { todayJST } from '@/lib/clock';
import { formatYen } from '@/lib/format';
import type { CalendarDto, DateString } from '@/lib/types';

type LoadState = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; data: CalendarDto };
type DayItems = CalendarDto['days'][number]['items'];

const LOAD_FAILED = 'カレンダーを読み込めませんでした。もう一度お試しください';
const NO_BILLS_MONTH = 'この月の請求予定はありません';
const NO_BILLS_DAY = 'この日の請求予定はありません';
const WEEKDAY_HEADERS = ['月', '火', '水', '木', '金', '土', '日'];

function MonthSwitcher({ month, onShift }: { month: string; onShift: (n: number) => void }) {
  const canPrev = isCalendarMonth(shiftMonth(month, -1));
  const canNext = isCalendarMonth(shiftMonth(month, 1));
  const arrow = 'inline-flex h-11 w-11 items-center justify-center rounded-xl text-2xl font-bold text-brand disabled:cursor-not-allowed disabled:text-gray-300';
  return (
    <Card className="flex items-center justify-between py-2">
      <h2 className="text-lg font-bold" aria-live="polite">
        {monthLabel(month)}
      </h2>
      <div className="flex items-center">
        <button type="button" aria-label="前月" className={arrow} disabled={!canPrev} onClick={() => onShift(-1)}>
          <span aria-hidden="true">‹</span>
        </button>
        <button type="button" aria-label="翌月" className={arrow} disabled={!canNext} onClick={() => onShift(1)}>
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </Card>
  );
}

function CalendarGrid({
  month,
  byDate,
  selected,
  onSelect,
}: {
  month: string;
  byDate: Map<DateString, DayItems>;
  selected: DateString;
  onSelect: (date: DateString) => void;
}) {
  const weeks = calendarWeeks(month);
  return (
    <div>
      <div className="grid grid-cols-7 text-center text-sm font-bold text-gray-500" aria-hidden="true">
        {WEEKDAY_HEADERS.map((label) => (
          <span key={label} className="py-2">
            {label}
          </span>
        ))}
      </div>
      <ul aria-label={`${monthLabel(month)}のカレンダー`} className="grid grid-cols-7 gap-y-1">
        {weeks.flat().map((cell) => {
          const day = Number(cell.date.slice(8, 10));
          if (!cell.inMonth) {
            // 前後の月の日付は灰色で、押せない
            return (
              <li key={cell.date} aria-hidden="true" className="flex h-12 items-center justify-center text-gray-300">
                {day}
              </li>
            );
          }
          const count = byDate.get(cell.date)?.length ?? 0;
          const isSelected = cell.date === selected;
          const label = count > 0 ? `${dayLabel(cell.date)} 請求予定${count}件` : dayLabel(cell.date);
          return (
            <li key={cell.date} className="flex justify-center">
              <button
                type="button"
                aria-label={label}
                aria-pressed={isSelected}
                onClick={() => onSelect(cell.date)}
                className={[
                  'flex h-12 w-11 flex-col items-center justify-center rounded-xl',
                  isSelected ? 'bg-brand font-bold text-white' : count > 0 ? 'bg-brand-light font-bold text-gray-900' : 'text-gray-900 hover:bg-gray-100',
                ].join(' ')}
              >
                <span aria-hidden="true">{day}</span>
                <span aria-hidden="true" className={['mt-0.5 h-1.5 w-1.5 rounded-full', count > 0 ? (isSelected ? 'bg-white' : 'bg-brand') : 'bg-transparent'].join(' ')} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CalendarBody({ data, month, selected, onSelect }: { data: CalendarDto; month: string; selected: DateString; onSelect: (date: DateString) => void }) {
  const byDate = new Map<DateString, DayItems>(data.days.map((day) => [day.date, day.items]));
  const count = data.days.reduce((sum, day) => sum + day.items.length, 0); // 件数は、その月の請求の回数
  const items = byDate.get(selected) ?? [];
  return (
    <>
      <CalendarGrid month={month} byDate={byDate} selected={selected} onSelect={onSelect} />

      {/* ③ 凡例（「請求予定」の青い点だけ） */}
      <div className="flex items-center gap-6 px-1 text-sm">
        <span className="font-bold text-gray-500">凡例</span>
        <span className="flex items-center gap-2 text-gray-700">
          <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-brand" />
          請求予定
        </span>
      </div>

      {/* ④ 月間請求予定額 */}
      <Card as="section" className="flex flex-col gap-1">
        <p className="text-sm text-gray-500">{monthNumberLabel(month)}の請求予定額</p>
        <div className="flex items-end justify-between gap-2">
          <p className="text-3xl font-bold">{formatYen(data.monthTotalJPY)}</p>
          <p className="text-sm font-bold text-gray-500">{count}件</p>
        </div>
        {count === 0 && <p className="text-sm text-gray-500">{NO_BILLS_MONTH}</p>}
      </Card>

      {/* ⑤ 選択日の見出し・⑥ 選択日の請求予定 */}
      <section aria-labelledby="calendar-selected-day" className="flex flex-col gap-3">
        <h2 id="calendar-selected-day" className="mt-2 text-lg font-bold">
          {dayLabel(selected)}の予定
        </h2>
        {items.length === 0 ? (
          <p className="text-sm text-gray-500">{NO_BILLS_DAY}</p>
        ) : (
          <ul aria-label={`${dayLabel(selected)}の請求予定`} className="flex flex-col gap-3">
            {items.map((item) => (
              <li key={item.subscriptionId}>
                <Link
                  href={`/subscriptions/${item.subscriptionId}`}
                  className="flex min-h-11 items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 hover:bg-gray-50"
                >
                  <IconBadge serviceName={item.serviceName} initialOnly />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-bold">{item.serviceName}</span>
                    <span className="block text-sm text-gray-500">請求予定・{formatYen(item.priceJPY)}</span>
                  </span>
                  <span aria-hidden="true" className="text-xl text-brand">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ⑦ 注意書き（「金額は請求予定額です。」の後で改行。最後に「。」は付けない） */}
      <div className="rounded-2xl bg-brand-light p-4 text-sm text-gray-600">
        <p>金額は請求予定額です。</p>
        <p>予定額は実際の決済額ではありません</p>
      </div>
    </>
  );
}

export default function CalendarPage() {
  // month・selected は、開いた後（ブラウザの今日が分かってから）に決める
  const [month, setMonth] = useState<string | null>(null);
  const [selected, setSelected] = useState<DateString | null>(null);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const latestRequest = useRef(0); // 最後に頼んだ読み込みの番号。これと違う番号の応答は使わない

  // target の月を読み込む。
  //   reselect：月を表示し直し、選ぶ日を決め直す（開いたとき・月を切り替えたとき。［再試行］は選んだ日のまま）
  //   after400：400 の後に今月で読み直したときの印（それも 400 なら読み込み失敗の表示）
  const open = useCallback(async function openMonth(target: string, options: { reselect: boolean; after400?: boolean }): Promise<void> {
    if (options.reselect) {
      setMonth(target);
      setSelected(initialSelectedDate(target, todayJST()));
    }
    latestRequest.current += 1;
    const requestId = latestRequest.current;
    setState({ status: 'loading' }); // 読み込みが終わるまで②〜⑦を消す
    try {
      const data = await api<CalendarDto>(`/api/calendar?month=${encodeURIComponent(target)}`);
      if (requestId !== latestRequest.current) return; // 後から別の月を頼んだ（この応答は使わない）
      setState({ status: 'ready', data });
    } catch (error) {
      if (requestId !== latestRequest.current) return;
      if (isGateError(error)) return; // ゲートが画面を切り替える（それまで「読み込み中…」のまま）
      if (!options.after400 && error instanceof ApiClientError && error.status === 400) {
        // 月の形式が不正（400）：今月を指定して読み直す
        await openMonth(calendarMonthOf(todayJST()), { reselect: true, after400: true });
        return;
      }
      setState({ status: 'error', error });
    }
  }, []);

  useEffect(() => {
    void open(calendarMonthOf(todayJST()), { reselect: true });
  }, [open]);

  const onShift = (n: number) => {
    if (month === null) return;
    const target = shiftMonth(month, n);
    if (!isCalendarMonth(target)) return; // 2000年1月より前・2100年12月より後へは移らない
    void open(target, { reselect: true });
  };

  return (
    <>
      <PageTitle brand>請求カレンダー</PageTitle>
      <main className="flex flex-col gap-3 px-4 pb-4">
        {month !== null && <MonthSwitcher month={month} onShift={onShift} />}
        {state.status === 'loading' && <Loading />}
        {state.status === 'error' && month !== null && <LoadError error={state.error} message={LOAD_FAILED} onRetry={() => void open(month, { reselect: false })} />}
        {state.status === 'ready' && month !== null && selected !== null && (
          <CalendarBody data={state.data} month={month} selected={selected} onSelect={setSelected} />
        )}
      </main>
    </>
  );
}
