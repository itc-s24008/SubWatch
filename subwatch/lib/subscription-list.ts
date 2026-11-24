// S-04 の検索・カテゴリーの絞り込み・並べ替え（04-20。F-10 の Want。ブラウザから使う。firebase を import しない）
// 機能設計書 詳細_F-10 の手順1〜3・5、画面設計書 S-04 の①②③⑦
//
//   matchesSearch(serviceName, query)：検索語がサービス名に部分一致するか。どちらも duplicateKey（lib/validation.ts。同名の判定と
//     同じ規則：前後の空白〔全角を含む〕を除き、英字 A-Z だけを小文字にする）で正規化してから比べる。全角の英字は半角と同じにしない。
//     検索語の途中の空白はそのまま比べる。正規化して空になる検索語（空・空白だけ）は、絞り込まない（true）
//   filterSubscriptions(items, { query, category })：検索語とカテゴリーで絞り込む（category 'all' は「すべて」＝絞り込まない）
//   sortSubscriptions(items, sort)：並べ替える。items は API の並び（作成日時の昇順）で渡す。値が同じものは渡された順のまま。
//     値が読めないものは最後（その中も渡された順）。元の配列は変えない
//       'nextBillingDate'（既定。次回請求日が近い順）：04-09 の sortByNextBillingDate（lib/subscription-order.ts）をそのまま使う
//       'priceDesc'（料金の高い順）：1回の請求額（price）の大きい順
//       'createdAtDesc'（登録日の新しい順）：createdAt の日時（ミリ秒まで）の新しい順
//   viewSubscriptions(items, { query, category, sort })：絞り込んでから並べ替える（S-04 が表示する並び）
import { sortByNextBillingDate } from '@/lib/subscription-order';
import { CATEGORY_LABELS } from '@/lib/format';
import { CATEGORIES, duplicateKey } from '@/lib/validation';
import type { Category } from '@/lib/types';

export type SubscriptionSort = 'nextBillingDate' | 'priceDesc' | 'createdAtDesc';
export type CategoryFilter = Category | 'all';

export const DEFAULT_SORT: SubscriptionSort = 'nextBillingDate';
export const DEFAULT_CATEGORY: CategoryFilter = 'all';

// ③の選択肢（画面設計書 S-04 D18 の順と文言）
export const SORT_OPTIONS: { value: SubscriptionSort; label: string }[] = [
  { value: 'nextBillingDate', label: '次回請求日が近い順' },
  { value: 'priceDesc', label: '料金の高い順' },
  { value: 'createdAtDesc', label: '登録日の新しい順' },
];

// ②のタブ（画面設計書 S-04 D17 の順：すべて／動画／音楽／クラウド／学習／AI／ゲーム／ニュース／仕事／その他）
export const CATEGORY_FILTERS: { value: CategoryFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  ...CATEGORIES.map((category) => ({ value: category, label: CATEGORY_LABELS[category] })),
];

export function isSubscriptionSort(value: unknown): value is SubscriptionSort {
  return SORT_OPTIONS.some((option) => option.value === value);
}

type Listable = { serviceName: unknown; category: unknown; price: unknown; createdAt: unknown; nextBillingDate: unknown };

export function matchesSearch(serviceName: unknown, query: string): boolean {
  const key = duplicateKey(query);
  if (key === '') return true;
  if (typeof serviceName !== 'string') return false;
  return duplicateKey(serviceName).includes(key);
}

export function filterSubscriptions<T extends Listable>(items: readonly T[], { query = '', category = DEFAULT_CATEGORY }: { query?: string; category?: CategoryFilter }): T[] {
  return items.filter((item) => (category === 'all' || item.category === category) && matchesSearch(item.serviceName, query));
}

// 値の大きい順に並べる（値が null＝読めないものは最後。同じ値・読めないもの同士は渡された順）
function sortByValueDesc<T>(items: readonly T[], valueOf: (item: T) => number | null): T[] {
  return items
    .map((item, index) => ({ item, index, value: valueOf(item) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) {
        if (a.value === null && b.value === null) return a.index - b.index;
        return a.value === null ? 1 : -1;
      }
      if (a.value !== b.value) return b.value - a.value;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

function readablePrice(price: unknown): number | null {
  return typeof price === 'number' && Number.isFinite(price) ? price : null;
}

// createdAt（ISO 8601）をミリ秒にする。読めないものは null
function readableCreatedAt(createdAt: unknown): number | null {
  if (typeof createdAt !== 'string') return null;
  const ms = Date.parse(createdAt);
  return Number.isNaN(ms) ? null : ms;
}

export function sortSubscriptions<T extends Listable>(items: readonly T[], sort: SubscriptionSort = DEFAULT_SORT): T[] {
  switch (sort) {
    case 'priceDesc':
      return sortByValueDesc(items, (item) => readablePrice(item.price));
    case 'createdAtDesc':
      return sortByValueDesc(items, (item) => readableCreatedAt(item.createdAt));
    case 'nextBillingDate':
    default:
      return sortByNextBillingDate(items);
  }
}

export function viewSubscriptions<T extends Listable>(
  items: readonly T[],
  { query = '', category = DEFAULT_CATEGORY, sort = DEFAULT_SORT }: { query?: string; category?: CategoryFilter; sort?: SubscriptionSort },
): T[] {
  return sortSubscriptions(filterSubscriptions(items, { query, category }), sort);
}
