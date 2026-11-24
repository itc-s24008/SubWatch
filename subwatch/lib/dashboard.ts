// ホーム・カレンダーの集計（サーバー）。みんなが足すファイル：自分の見出し（// ===== 04-xx：… =====）の下に足す
// （04-09 がホーム〔GET /api/dashboard〕を作り、04-13 がカレンダーを足す）

// ===== 04-09：ホームの集計（GET /api/dashboard。詳細_F-04、API共通仕様 B75・B76・B78・B79、共通ロジック） =====
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { addDays, annualAmount, billingDatesInRange, daysBetween, daysInMonth, monthlyEquivalentTotal, nextBillingDate, weekdayOf } from '@/lib/billing';
import { adminDb } from '@/lib/firebase-admin';
import { listSubscriptions } from '@/lib/subscriptions';
import type { BillingCycle, BillingDayMode, DashboardDto, DateString, SubscriptionDoc } from '@/lib/types';

// 集計に使うサブスクの形（保存の形 SubscriptionDoc から、集計に要る項目だけを取り出したもの）。
// 保存された値が壊れていることがあるので、price・billingCycle などは確かめずにそのまま入れる（集計の中で RangeError になったら外す）
export interface DashboardSubscription {
  subscriptionId: string;
  serviceName: string;
  price: number;
  billingCycle: BillingCycle;
  firstBillingDate: DateString;
  billingDayMode: BillingDayMode;
  websiteUrl: string | null;
}

// 保存されたドキュメント（04-07 の listSubscriptions が返す保存の形）を集計の形にする（CLAUDE.md「統合日にそろえる名前」）。
// 統合①（11/19）で、引数を (id, data) から listSubscriptions の SubscriptionDoc に替えた。保存値は壊れていることがあるので、型は信じずに読む
export function toDashboardSubscription(doc: SubscriptionDoc): DashboardSubscription {
  const data = doc as unknown as Record<string, unknown>;
  return {
    subscriptionId: doc.subscriptionId,
    serviceName: typeof data.serviceName === 'string' ? data.serviceName : '',
    price: data.price as number,
    billingCycle: data.billingCycle as BillingCycle,
    firstBillingDate: data.firstBillingDate as DateString,
    billingDayMode: data.billingDayMode as BillingDayMode,
    websiteUrl: typeof data.websiteUrl === 'string' && data.websiteUrl !== '' ? data.websiteUrl : null,
  };
}

export const NEXT_BILLS_DAYS = 7; // 今日（0日）から7日後までを含む
export const NEXT_BILLS_LIMIT = 5;
export const UNREAD_WINDOW_DAYS = 90;

// 今週（日本時間の月曜〜日曜）。today は YYYY-MM-DD
export function weekRange(today: DateString): { from: DateString; to: DateString } {
  const from = addDays(today, -((weekdayOf(today) + 6) % 7));
  return { from, to: addDays(from, 6) };
}

// 今月（1日〜末日）
export function monthRange(today: DateString): { from: DateString; to: DateString } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const prefix = today.slice(0, 7);
  return { from: `${prefix}-01`, to: `${prefix}-${String(daysInMonth(year, month)).padStart(2, '0')}` };
}

// 集計（firebase を使わない。基準日のテストは、この関数を直接呼ぶ）
//   subscriptions は作成日時の昇順（同じ時刻はドキュメントIDの昇順）で渡す。nextBills の同じ日の並びは、この順のまま
//   請求日・周期・請求日方式・料金が壊れていて計算できない（lib/billing.ts が RangeError を投げる）サブスクは、
//   今週・今月・月額換算・年額換算と nextBills に入れず、subscriptionCount にだけ数える（500 にしない）
export function computeDashboard(subscriptions: DashboardSubscription[], today: DateString, unreadCount: number): DashboardDto {
  const week = weekRange(today);
  const month = monthRange(today);
  const weekTotal = { count: 0, amountJPY: 0 };
  const monthTotal = { count: 0, amountJPY: 0 };
  let annualTotal = 0;
  const candidates: DashboardDto['nextBills'] = [];

  for (const sub of subscriptions) {
    let weekDates: DateString[];
    let monthDates: DateString[];
    let annual: number;
    let next: DateString;
    try {
      annual = annualAmount(sub.price, sub.billingCycle); // 料金・周期が壊れていれば RangeError
      weekDates = billingDatesInRange(sub.firstBillingDate, sub.billingCycle, sub.billingDayMode, week.from, week.to);
      monthDates = billingDatesInRange(sub.firstBillingDate, sub.billingCycle, sub.billingDayMode, month.from, month.to);
      next = nextBillingDate(sub.firstBillingDate, sub.billingCycle, sub.billingDayMode, today);
    } catch (error) {
      if (error instanceof RangeError) continue; // 壊れたサブスクは集計から外す（登録数には数える）
      throw error;
    }
    weekTotal.count += weekDates.length;
    weekTotal.amountJPY += sub.price * weekDates.length;
    monthTotal.count += monthDates.length;
    monthTotal.amountJPY += sub.price * monthDates.length;
    annualTotal += annual;
    const daysLeft = daysBetween(today, next);
    if (daysLeft >= 0 && daysLeft <= NEXT_BILLS_DAYS) {
      candidates.push({
        subscriptionId: sub.subscriptionId,
        serviceName: sub.serviceName,
        websiteUrl: sub.websiteUrl,
        date: next,
        priceJPY: sub.price,
        daysLeft,
      });
    }
  }

  // 日付の近い順。同じ日は渡された順（作成日時の昇順）のまま（Array.prototype.sort は安定）
  const nextBills = candidates.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).slice(0, NEXT_BILLS_LIMIT);

  return {
    weekTotal,
    monthTotal,
    monthlyEquivalentJPY: monthlyEquivalentTotal(annualTotal),
    yearlyEquivalentJPY: annualTotal,
    subscriptionCount: subscriptions.length,
    unreadCount,
    nextBills,
  };
}

// 未読の数え始め（現在時刻 − 90日。CLAUDE.md「統合日にそろえる名前」）。置き場所はこのファイル。
// 統合①（11/19）の時点で、ほかに同じ計算は無い。04-14・04-21 が「直近90日」を使うときは、作り直さずにこれを import する（次の統合の手順8で確かめる）
export function unreadWindowStart(now: Date): Date {
  return new Date(now.getTime() - UNREAD_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

// 未読の数：viewedAt が null で、createdAt が「現在時刻 − 90日」以後（上限なし）。count() 集計
// （複合インデックス viewedAt 昇順 ＋ createdAt 昇順。firestore.indexes.json にある）
export async function countUnreadNotifications(uid: string, now: Date, db: Firestore = adminDb()): Promise<number> {
  const snapshot = await db
    .collection('users')
    .doc(uid)
    .collection('notificationEvents')
    .where('viewedAt', '==', null)
    .where('createdAt', '>=', Timestamp.fromDate(unreadWindowStart(now)))
    .count()
    .get();
  return snapshot.data().count;
}

export interface DashboardOptions {
  today: DateString; // 日本時間の今日（route は todayJST() を渡す）
  now: Date; // 未読の数え始めの基準（route は new Date() を渡す）
  db?: Firestore; // テスト用の差し替え口
}

// GET /api/dashboard の中身（users と規約の版の確認は route が requireInitialized で行う）
export async function getDashboard(uid: string, options: DashboardOptions): Promise<DashboardDto> {
  const db = options.db ?? adminDb();
  // サブスクの読み取りは 04-07 の listSubscriptions（作成日時の昇順・同じ時刻はドキュメントIDの昇順）。統合①で仮の listDashboardSubscriptions から置き換えた
  const [docs, unreadCount] = await Promise.all([listSubscriptions(uid, db), countUnreadNotifications(uid, options.now, db)]);
  return computeDashboard(docs.map(toDashboardSubscription), options.today, unreadCount);
}

// ===== 04-13：カレンダーの集計 ここに足す =====
// GET /api/calendar?month=YYYY-MM（API一覧 No.11、詳細_F-05、API共通仕様 B77）。04-09 の行は変えず、関数を足しただけ
// 月の範囲（1日〜末日）は lib/calendar.ts の monthDateRange で求める（04-09 の monthRange は使わない）
import { monthDateRange } from '@/lib/calendar';
import type { CalendarDto } from '@/lib/types';

// 月の集計（firebase を使わない。基準日のテストは、この関数を直接呼ぶ）
//   subscriptions は作成日時の昇順で渡す（同じ日の items は、この順のまま）
//   各サブスクの請求日は firstBillingDate と周期・請求日方式から計算する（保存された nextBillingDate には頼らない）
//   請求日・周期・請求日方式・料金が壊れていて計算できない（lib/billing.ts が RangeError を投げる）サブスクは、
//   500 にせず集計から外す（GET /api/dashboard の computeDashboard と同じ基準：annualAmount と billingDatesInRange が通るもの）
//   days は請求のある日だけを日付の昇順。monthTotalJPY は、その月の請求の料金の合計
export function computeCalendar(subscriptions: DashboardSubscription[], month: string): CalendarDto {
  const { from, to } = monthDateRange(month); // 壊れた月は RangeError（route が先に検査するので、ふつうは来ない）
  const byDate = new Map<DateString, CalendarDto['days'][number]['items']>();
  let monthTotalJPY = 0;

  for (const sub of subscriptions) {
    let dates: DateString[];
    try {
      annualAmount(sub.price, sub.billingCycle); // 料金・周期が壊れていれば RangeError（ホームと同じ基準で外す）
      dates = billingDatesInRange(sub.firstBillingDate, sub.billingCycle, sub.billingDayMode, from, to);
    } catch (error) {
      if (error instanceof RangeError) continue;
      throw error;
    }
    for (const date of dates) {
      const items = byDate.get(date) ?? [];
      items.push({ subscriptionId: sub.subscriptionId, serviceName: sub.serviceName, priceJPY: sub.price });
      byDate.set(date, items);
      monthTotalJPY += sub.price;
    }
  }

  const days = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, items]) => ({ date, items }));
  return { month, days, monthTotalJPY };
}

export interface CalendarOptions {
  month: string; // YYYY-MM（route が検査し、省略なら日本時間の今月を渡す）
  db?: Firestore; // テスト用の差し替え口
}

// GET /api/calendar の中身（users と規約の版の確認は route が requireInitialized で行う）
// サブスクの読み取りは 04-07 の listSubscriptions（作成日時の昇順）、集計の形は 04-09 の toDashboardSubscription
export async function getCalendar(uid: string, options: CalendarOptions): Promise<CalendarDto> {
  const docs = await listSubscriptions(uid, options.db ?? adminDb());
  return computeCalendar(docs.map(toDashboardSubscription), options.month);
}
