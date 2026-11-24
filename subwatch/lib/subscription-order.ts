// S-04 の一覧の既定の並び（04-09。ブラウザから使う。firebase を import しない）
// 次回請求日が近い順。同じ日は API の並び（作成日時の昇順＝登録の古い順）のまま。次回請求日が読めないものは最後（その中も API の並び）
// 並べ替えの選択欄（料金の高い順・登録日の新しい順）は 04-20 が足す
import { isValidDate } from '@/lib/billing';

export function sortByNextBillingDate<T extends { nextBillingDate: unknown }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index, date: isValidDate(item.nextBillingDate) ? item.nextBillingDate : null }))
    .sort((a, b) => {
      if (a.date === null || b.date === null) {
        if (a.date === null && b.date === null) return a.index - b.index;
        return a.date === null ? 1 : -1;
      }
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}
