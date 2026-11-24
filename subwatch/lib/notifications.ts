// 通知の処理（サーバー）。04-14 が作り、04-21 が一覧・既読を足す
// みんなが足すファイル：自分の見出し（// ===== 04-xx：… =====）の下に足す。ほかの人の行と、先頭の import は変えない
import { createHash } from 'node:crypto';
import { addDays, isValidDate, nextBillingDate } from '@/lib/billing';
import { formatMonthDay, formatYen } from '@/lib/format';
import type { DateString, SubscriptionDoc } from '@/lib/types';

// ===== 04-14：通知の判定・決定的ID・文面 =====
//
//   notificationId(uid, subscriptionId, notificationType, daysBefore, targetDate)：決定的ID（機能設計書「共通ロジック」B6）
//   notificationText(notificationType, daysBefore, date, price)：title・body（要件定義書「共通ルール」の「通知の文面」B19）
//   planNotifications(subscription, today)：そのサブスクで今日作る通知（全体の通知のオン・オフと users の有無は Cron が見る）

export type NotificationType = 'billing' | 'trial_end';
export type DaysBefore = 7 | 1;

// 通知を作る日の差（請求日・最終無料日の7日前と1日前。当日の通知は作らない）
export const NOTIFICATION_DAYS_BEFORE: readonly DaysBefore[] = [7, 1];

// sha256(`${uid}|${subscriptionId}|${notificationType}|${daysBefore}|${targetDate}`) の小文字16進（64文字）
export function notificationId(
  uid: string,
  subscriptionId: string,
  notificationType: NotificationType,
  daysBefore: DaysBefore,
  targetDate: DateString,
): string {
  return createHash('sha256').update(`${uid}|${subscriptionId}|${notificationType}|${daysBefore}|${targetDate}`, 'utf8').digest('hex');
}

// billing：title「請求日まであと{N}日」・body「{MM/DD}・¥{請求額} の請求予定」
// trial_end：title「無料トライアル終了まであと{N}日」・body「最終無料日は{MM/DD}です」
// date は billing なら請求日（次回請求日）、trial_end なら最終無料日。price は billing だけ使う
export function notificationText(
  notificationType: NotificationType,
  daysBefore: DaysBefore,
  date: DateString,
  price: number | null,
): { title: string; body: string } {
  if (notificationType === 'trial_end') {
    return { title: `無料トライアル終了まであと${daysBefore}日`, body: `最終無料日は${formatMonthDay(date)}です` };
  }
  return { title: `請求日まであと${daysBefore}日`, body: `${formatMonthDay(date)}・${formatYen(price)} の請求予定` };
}

// 今日作る1件の通知（targetDate は今日）
export interface PlannedNotification {
  notificationType: NotificationType;
  daysBefore: DaysBefore;
  targetDate: DateString;
  title: string;
  body: string;
  serviceNameAtNotification: string;
  priceAtNotification: number | null; // billing は通知を作ったときの料金、trial_end は null
}

// today から date までが7日か1日なら、その日数。それ以外は null
function daysBeforeOf(date: DateString, today: DateString): DaysBefore | null {
  for (const days of NOTIFICATION_DAYS_BEFORE) {
    if (addDays(today, days) === date) return days;
  }
  return null;
}

// そのサブスクで、今日（today）作る通知（0〜1件）。機能設計書 詳細_F-06 の手順6、共通ロジック B7、API共通仕様 B89
// ・個別の通知（subscriptionNotificationEnabled）が false なら作らない（項目が無いドキュメントは true）
// ・請求日・周期・請求日方式のどれかが壊れていたら、billing も trial_end も作らない
// ・trial_end：trialEnabled が true で、trialEndDate が今日+7日／今日+1日（trialEnabled が false なら trialEndDate が残っていても作らない）
// ・billing：請求日と周期から計算し直した次回請求日が今日+7日／今日+1日。料金が数でない・0以下なら作らない
// ・trial_end を作る条件に合うサブスクは、billing を作らない（trial_end が前の実行で作られていても同じ）
// 全体の通知（accountNotificationEnabled）と users/{uid} の有無は、ここでは見ない（Cron が users を読んで決める）
export function planNotifications(subscription: SubscriptionDoc, today: DateString): PlannedNotification[] {
  if (subscription.subscriptionNotificationEnabled === false) return [];
  let next: DateString;
  try {
    next = nextBillingDate(subscription.firstBillingDate, subscription.billingCycle, subscription.billingDayMode, today);
  } catch (error) {
    if (error instanceof RangeError) return [];
    throw error;
  }
  const serviceNameAtNotification = typeof subscription.serviceName === 'string' ? subscription.serviceName : '';

  if (subscription.trialEnabled === true && isValidDate(subscription.trialEndDate)) {
    const trialEndDate = subscription.trialEndDate as DateString;
    const days = daysBeforeOf(trialEndDate, today);
    if (days !== null) {
      return [
        {
          notificationType: 'trial_end',
          daysBefore: days,
          targetDate: today,
          ...notificationText('trial_end', days, trialEndDate, null),
          serviceNameAtNotification,
          priceAtNotification: null,
        },
      ];
    }
  }

  const days = daysBeforeOf(next, today);
  if (days === null) return [];
  const price = subscription.price;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return [];
  return [
    {
      notificationType: 'billing',
      daysBefore: days,
      targetDate: today,
      ...notificationText('billing', days, next, price),
      serviceNameAtNotification,
      priceAtNotification: price,
    },
  ];
}

// ===== 04-21：通知一覧・既読 ここに足す =====
