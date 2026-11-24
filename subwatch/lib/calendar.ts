// 月（YYYY-MM）の部品（04-13。F-05 請求カレンダー）。画面（S-07）とサーバー（GET /api/calendar）の両方から使うので、firebase を import しない
// 日付の計算は lib/billing.ts の部品（addDays・daysInMonth・weekdayOf・isValidDate）だけを使う（自分で作らない）
//
//   isCalendarMonth(s)：YYYY-MM の形で、2000-01〜2100-12 の中か（RangeError を投げない）
//   monthOf(date)：日付（YYYY-MM-DD）の月（YYYY-MM）。壊れた日付は RangeError
//   calendarMonthOf(today)：S-07 を開いたとき（と 400 で読み直すとき）に表示する月。今日の月。範囲の外なら近い方の端（2000-01・2100-12）
//   shiftMonth(month, n)：n か月後（n が負なら前）の月。範囲の外の月も返す（押せるかは呼ぶ側が isCalendarMonth で調べる）
//   monthDateRange(month)：月の1日と末日 { from, to }。月の範囲は、この関数だけで求める
//   calendarWeeks(month)：月曜始まりのマス目。週ごとの配列で、各マスは { date, inMonth }（前後の月の日付は inMonth=false）
//   initialSelectedDate(month, today)：月を表示したときに選ぶ日（今月なら今日、ほかの月なら1日。API共通仕様 B77）
//   monthLabel(month)：「2026年11月」。monthNumberLabel(month)：「11月」。dayLabel(date)：「11月5日（木）」
import { addDays, daysInMonth, isValidDate, weekdayOf } from '@/lib/billing';
import type { DateString } from '@/lib/types';

export const CALENDAR_MONTH_MIN = '2000-01';
export const CALENDAR_MONTH_MAX = '2100-12';

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']; // weekdayOf の 0（日曜）〜6（土曜）の順

interface YearMonth {
  year: number;
  month: number; // 1〜12
}

// 形（YYYY-MM。月は 01〜12）だけを調べる。年の範囲は調べない
function parseMonth(s: unknown): YearMonth | null {
  if (typeof s !== 'string') return null;
  const match = /^(\d{4})-(\d{2})$/.exec(s);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

function parseMonthOrThrow(s: unknown): YearMonth {
  const ym = parseMonth(s);
  if (!ym) throw new RangeError('月が正しい形（YYYY-MM）ではありません');
  return ym;
}

function formatMonth({ year, month }: YearMonth): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

// YYYY-MM の形で、2000-01〜2100-12 の中か（API の month の検査と、S-07 の［前月］［翌月］を押せるかに使う）
export function isCalendarMonth(s: unknown): s is string {
  const ym = parseMonth(s);
  return ym !== null && ym.year >= 2000 && ym.year <= 2100;
}

// 日付の月（'2026-11-04' → '2026-11'）。壊れた日付は RangeError
export function monthOf(date: DateString): string {
  if (!isValidDate(date)) throw new RangeError('日付が正しい形（YYYY-MM-DD）ではありません');
  return date.slice(0, 7);
}

// 今日（日本時間の YYYY-MM-DD）から、表示する月を決める。今日が 2000-01〜2100-12 の外なら、近い方の端の月
export function calendarMonthOf(today: DateString): string {
  const month = monthOf(today);
  if (month < CALENDAR_MONTH_MIN) return CALENDAR_MONTH_MIN;
  if (month > CALENDAR_MONTH_MAX) return CALENDAR_MONTH_MAX;
  return month;
}

// n か月後（n が負なら前）。年をまたぐ（'2026-12' の1か月後は '2027-01'）。壊れた月・整数でない n は RangeError
export function shiftMonth(month: string, n: number): string {
  const ym = parseMonthOrThrow(month);
  if (typeof n !== 'number' || !Number.isInteger(n)) throw new RangeError('n は整数にしてください');
  const index = ym.year * 12 + (ym.month - 1) + n;
  return formatMonth({ year: Math.floor(index / 12), month: (((index % 12) + 12) % 12) + 1 });
}

// 月の1日と末日（両端を含む）。壊れた月は RangeError
export function monthDateRange(month: string): { from: DateString; to: DateString } {
  const ym = parseMonthOrThrow(month);
  const prefix = formatMonth(ym);
  return { from: `${prefix}-01`, to: `${prefix}-${String(daysInMonth(ym.year, ym.month)).padStart(2, '0')}` };
}

export interface CalendarCell {
  date: DateString;
  inMonth: boolean; // false は前後の月の日付（灰色で、押せない）
}

// 月曜始まりのマス目。1日を含む週の月曜から、末日を含む週の日曜まで（4〜6週）。壊れた月は RangeError
export function calendarWeeks(month: string): CalendarCell[][] {
  const { from, to } = monthDateRange(month);
  const prefix = from.slice(0, 7);
  const start = addDays(from, -((weekdayOf(from) + 6) % 7)); // 月曜に戻す
  const end = addDays(to, (7 - weekdayOf(to)) % 7); // 日曜まで進める
  const weeks: CalendarCell[][] = [];
  for (let date = start; date <= end; date = addDays(date, 7)) {
    const week: CalendarCell[] = [];
    for (let i = 0; i < 7; i += 1) {
      const d = addDays(date, i);
      week.push({ date: d, inMonth: d.slice(0, 7) === prefix });
    }
    weeks.push(week);
  }
  return weeks;
}

// 月を表示したときに選ぶ日：今月（today の月）なら今日、ほかの月なら1日
export function initialSelectedDate(month: string, today: DateString): DateString {
  const { from } = monthDateRange(month);
  return isValidDate(today) && monthOf(today) === from.slice(0, 7) ? today : from;
}

// 「2026年11月」（① の表示）
export function monthLabel(month: string): string {
  const ym = parseMonthOrThrow(month);
  return `${ym.year}年${ym.month}月`;
}

// 「11月」（④「11月の請求予定額」）
export function monthNumberLabel(month: string): string {
  return `${parseMonthOrThrow(month).month}月`;
}

// 「11月5日（木）」（② の aria-label と ⑤ の見出し）。壊れた日付は RangeError
export function dayLabel(date: DateString): string {
  const weekday = WEEKDAY_LABELS[weekdayOf(date)];
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日（${weekday}）`;
}
