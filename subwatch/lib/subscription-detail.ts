// S-06 サブスク詳細画面の計算（04-19。ブラウザから使うので firebase を import しない）
// 画面設計書 2.画面詳細(S-06) の①③④、機能設計書 詳細_F-03 の手順10、決まりの一覧 C-14
//
//   cancelGuideOf(subscription, today)：①解約案内を出すか。出さないときは null
//     (1) 無料トライアル：trialEnabled が true で、今日から最終無料日までが0〜7日 → kind 'trial'（請求日が8日以上先でも出す）
//     (2) 請求：(1) に当たらず、今日から次回請求日までが0〜7日 → kind 'billing'（0円も同じ。最終無料日を過ぎたトライアルも、この条件だけで決める）
//     today は日本時間の今日（画面は lib/clock.ts の todayJST() を渡す。テストは引数で渡す）
//     日付が壊れているときは、その条件に当たらないものとして扱う（例外を投げない）
//   cancelGuideText(guide)：①の文（1行目と2行目）
//   monthlyEquivalentOf(price, billingCycle)：③月額換算（1件分。年額換算を12で割り、円未満を四捨五入）。計算できなければ null（画面は「―」）
//   annualEquivalentOf(price, billingCycle)：④年額換算（1件分。料金×12÷周期の月数）。計算できなければ null（画面は「―」）
//   hasMemo(memo)：⑧メモを出すか（未入力・空白だけなら出さない）
//   hasPaymentMethod(paymentMethod)：②の「支払方法：…」を出すか（未入力なら出さない）
import { annualAmount, daysBetween, monthlyEquivalentTotal } from '@/lib/billing';
import { formatMonthDay, formatYen } from '@/lib/format';
import type { BillingCycle, DateString, SubscriptionDto } from '@/lib/types';

export const CANCEL_GUIDE_DAYS = 7; // 今日から0〜7日のときに出す

export const DETAIL_MESSAGES = {
  cancelGuideTitle: '解約を検討するタイミングです',
  openCancelPage: '解約ページを開く',
  notRegistered: '未登録：編集で追加できます',
  trialNotApplicable: '対象外',
  trialFreeUntil: 'この日までは無料です',
} as const;

export type CancelGuide =
  | { kind: 'trial'; date: DateString }
  | { kind: 'billing'; date: DateString; price: number };

type GuideInput = Pick<SubscriptionDto, 'trialEnabled' | 'trialEndDate' | 'nextBillingDate' | 'price'>;

// 今日から date までの日数（壊れた日付は null）
function daysUntil(today: DateString, date: unknown): number | null {
  if (typeof date !== 'string') return null;
  try {
    return daysBetween(today, date);
  } catch {
    return null;
  }
}

function withinGuideDays(days: number | null): boolean {
  return days !== null && days >= 0 && days <= CANCEL_GUIDE_DAYS;
}

export function cancelGuideOf(subscription: GuideInput, today: DateString): CancelGuide | null {
  if (subscription.trialEnabled === true && subscription.trialEndDate) {
    if (withinGuideDays(daysUntil(today, subscription.trialEndDate))) {
      return { kind: 'trial', date: subscription.trialEndDate };
    }
  }
  if (withinGuideDays(daysUntil(today, subscription.nextBillingDate))) {
    return { kind: 'billing', date: subscription.nextBillingDate, price: subscription.price };
  }
  return null;
}

// ①の文。lead は太字の1行目、body は2行目
export function cancelGuideText(guide: CancelGuide): { lead: string; body: string } {
  if (guide.kind === 'trial') {
    return {
      lead: `${formatMonthDay(guide.date)} で無料期間が終わります。`,
      body: '続けないなら、その日までに解約を検討しましょう。',
    };
  }
  return {
    lead: `${formatMonthDay(guide.date)} に ${formatYen(guide.price)} の請求予定です。`,
    body: '使っていなければ、請求日の前に解約を検討しましょう。',
  };
}

export function annualEquivalentOf(price: number, billingCycle: BillingCycle): number | null {
  try {
    return annualAmount(price, billingCycle);
  } catch {
    return null;
  }
}

export function monthlyEquivalentOf(price: number, billingCycle: BillingCycle): number | null {
  const annual = annualEquivalentOf(price, billingCycle);
  if (annual === null) return null;
  try {
    return monthlyEquivalentTotal(annual);
  } catch {
    return null;
  }
}

export function hasMemo(memo: string | null | undefined): memo is string {
  return typeof memo === 'string' && memo.trim() !== '';
}

export function hasPaymentMethod(paymentMethod: string | null | undefined): paymentMethod is string {
  return typeof paymentMethod === 'string' && paymentMethod.trim() !== '';
}
