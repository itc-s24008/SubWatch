// 表示の整形（ブラウザ・サーバーの両方から使う）。読めない値は「―」
import type { BillingCycle, BillingDayMode, Category } from '@/lib/types';

const DASH = '―';

// 1590 → ¥1,590
export function formatYen(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DASH;
  return `¥${new Intl.NumberFormat('ja-JP').format(value)}`;
}

// '2026-11-05' → 11/05
export function formatMonthDay(date: unknown): string {
  if (typeof date !== 'string') return DASH;
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return DASH;
  return `${match[1]}/${match[2]}`;
}

// ISO 8601 の文字列 → 日本時間の HH:mm（例 09:05）
export function formatTimeJST(iso: unknown): string {
  if (typeof iso !== 'string') return DASH;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return DASH;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(time));
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '';
  return `${hour === '24' ? '00' : hour}:${minute}`;
}

// 未読件数のバッジ。99 を超えたら 99+
export function formatUnreadBadge(count: unknown): string {
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return DASH;
  return count > 99 ? '99+' : String(count);
}

// カテゴリーの表示名（要件定義書「共通ルール」）
export const CATEGORY_LABELS: Record<Category, string> = {
  video: '動画',
  music: '音楽',
  cloud: 'クラウド',
  learning: '学習',
  ai: 'AI',
  game: 'ゲーム',
  news: 'ニュース',
  work: '仕事',
  other: 'その他',
};

// S-05 の請求周期の表示名
export const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  monthly: '月額（毎月）',
  quarterly: '3か月',
  semiAnnual: '6か月',
  yearly: '年額（毎年）',
};

// S-04 のカードの「¥980 / 月」の単位
export const BILLING_CYCLE_UNIT_LABELS: Record<BillingCycle, string> = {
  monthly: '月',
  quarterly: '3か月',
  semiAnnual: '6か月',
  yearly: '年',
};

// 請求日方式の表示名
export const BILLING_DAY_MODE_LABELS: Record<BillingDayMode, string> = {
  fixedDay: '請求日と同じ日',
  endOfMonth: '毎月末日',
};
