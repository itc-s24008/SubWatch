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
//
// GET /api/notifications・POST /api/notifications/:id/read・POST /api/notifications/read-all の中身（API一覧 No.14〜16、
// 詳細_F-12 の手順1〜4、API共通仕様 B24・B92・B93・B94、DB設計書 3.補足設計 B211・B214）。04-14 の関数は変えず、ここに足しただけ
//   isNotificationVisible(createdAt, now)：通知一覧に出すか（createdAt が「now − 90日」以後。境目は lib/dashboard.ts の unreadWindowStart）
//   parseNotificationListQuery(searchParams)：filter・limit・cursor の検査（不正なら 400 VALIDATION_ERROR）
//   listNotifications(uid, query, { now, db })：直近90日を作成日時（ミリ秒）の降順・同じ瞬間は通知IDの降順で返す。
//     種別・未読の絞り込みはメモリ上で行う（100件ずつ読み、条件に合うものが limit+1 件そろうまで繰り返す）。
//     クエリは createdAt の範囲と並び（createdAt 降順・ドキュメントID 降順）だけにして、新しい複合インデックスを要らなくする
//   markNotificationRead(uid, notificationId, { now, db })：既読にする（すでに既読なら何も書かず、保存された viewedAt を返す）
//   markAllNotificationsRead(uid, { now, db })：直近90日の未読を400件ずつ既読にする（1回の呼び出しで最大4回）
import { FieldPath, Timestamp, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { countUnreadNotifications, unreadWindowStart } from '@/lib/dashboard';
import { HttpError } from '@/lib/errors';
import { adminDb } from '@/lib/firebase-admin';
import type { MarkReadResult, NotificationDto, NotificationFilter, NotificationListDto, ReadAllResult } from '@/lib/types';
import { isSubscriptionId } from '@/lib/validation';

export const NOTIFICATION_LIST_DEFAULT_LIMIT = 20;
export const NOTIFICATION_LIST_MAX_LIMIT = 50;
export const NOTIFICATION_FILTERS: readonly NotificationFilter[] = ['all', 'unread', 'billing', 'trial_end'];
const LIST_SCAN_BATCH = 100; // メモリ上で絞り込むときに1回で読む件数（API共通仕様 B92）
const READ_ALL_BATCH = 400; // すべて既読の1回の件数（API一覧 No.16）
const READ_ALL_MAX_ROUNDS = 4; // 1回の呼び出しで 400件×4回（1,600件）まで（API共通仕様 B93）
const TIMESTAMP_MAX_MILLIS = 253402300799000; // Timestamp の上限（9999-12-31T23:59:59Z）
const CURSOR_PATTERN = /^(\d{1,16})_([A-Za-z0-9]{1,128})$/;
const LIMIT_PATTERN = /^[1-9]\d*$/; // 10進の数字だけ（先頭の0・空白・小数・指数は不可）
const NOTIFICATION_ID_PATTERN = /^[0-9a-f]{64}$/; // 64桁の小文字16進でなければ Firestore を読まずに 404

// 通知一覧に出すか（テスト一覧 No.49）。createdAt が「now − 90日」ちょうどなら出し、それより1ミリ秒でも古ければ出さない
export function isNotificationVisible(createdAt: Date | number, now: Date): boolean {
  const millis = typeof createdAt === 'number' ? createdAt : createdAt.getTime();
  return millis >= unreadWindowStart(now).getTime();
}

export interface NotificationListQuery {
  filter: NotificationFilter;
  limit: number;
  cursor: { millis: number; notificationId: string } | null;
}

// filter・limit・cursor の検査（API共通仕様 B92）。省略は filter=all・limit=20・cursor なし。空（?limit= など）は 400。
// 誤りが複数なら filter・limit・cursor の順に details に入れ、field は最初の項目。message は「入力内容を確認してください」
export function parseNotificationListQuery(params: URLSearchParams): NotificationListQuery {
  const message = '入力内容を確認してください';
  const details: { field: string; code: string; message: string }[] = [];
  const invalid = (field: string) => details.push({ field, code: 'VALIDATION_ERROR', message });

  let filter: NotificationFilter = 'all';
  const rawFilter = params.get('filter');
  if (rawFilter !== null) {
    if ((NOTIFICATION_FILTERS as readonly string[]).includes(rawFilter)) filter = rawFilter as NotificationFilter;
    else invalid('filter');
  }

  let limit = NOTIFICATION_LIST_DEFAULT_LIMIT;
  const rawLimit = params.get('limit');
  if (rawLimit !== null) {
    const value = LIMIT_PATTERN.test(rawLimit) ? Number(rawLimit) : NaN;
    if (value >= 1 && value <= NOTIFICATION_LIST_MAX_LIMIT) limit = value;
    else invalid('limit');
  }

  let cursor: NotificationListQuery['cursor'] = null;
  const rawCursor = params.get('cursor');
  if (rawCursor !== null) {
    const match = CURSOR_PATTERN.exec(rawCursor);
    const millis = match ? Number(match[1]) : NaN;
    if (match && millis <= TIMESTAMP_MAX_MILLIS) cursor = { millis, notificationId: match[2] };
    else invalid('cursor');
  }

  if (details.length > 0) throw new HttpError(400, 'VALIDATION_ERROR', message, { field: details[0].field, details });
  return { filter, limit, cursor };
}

export interface NotificationOptions {
  now: Date; // 現在時刻（直近90日の基準・既読の時刻。route は new Date() を渡す。テスト用の差し替え口）
  db?: Firestore; // テスト用の差し替え口
}

function notificationsOf(db: Firestore, uid: string) {
  return db.collection('users').doc(uid).collection('notificationEvents');
}

function toIso(value: unknown): string | null {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function matchesFilter(data: Record<string, unknown>, filter: NotificationFilter): boolean {
  if (filter === 'unread') return data.viewedAt === null || data.viewedAt === undefined;
  if (filter === 'billing' || filter === 'trial_end') return data.notificationType === filter;
  return true;
}

// 保存の形 → 応答の形（NotificationDto）。uid・expireAt・updatedAt・webPushSentAt・webPushLastErrorCode・webPushDeliveredIds は返さない
function toNotificationDto(doc: QueryDocumentSnapshot, subscriptionExists: boolean): NotificationDto {
  const data = doc.data() as Record<string, unknown>;
  return {
    notificationId: doc.id,
    subscriptionId: typeof data.subscriptionId === 'string' ? data.subscriptionId : '',
    serviceNameAtNotification: typeof data.serviceNameAtNotification === 'string' ? data.serviceNameAtNotification : '',
    notificationType: data.notificationType as NotificationDto['notificationType'],
    daysBefore: data.daysBefore as NotificationDto['daysBefore'],
    targetDate: data.targetDate as string,
    title: typeof data.title === 'string' ? data.title : '',
    body: typeof data.body === 'string' ? data.body : '',
    priceAtNotification: typeof data.priceAtNotification === 'number' ? data.priceAtNotification : null,
    subscriptionExists,
    viewedAt: toIso(data.viewedAt),
    webPushStatus: data.webPushStatus as NotificationDto['webPushStatus'],
    createdAt: toIso(data.createdAt) ?? '',
  };
}

// このページの通知のサブスクが今もあるか（サブスクIDをまとめて1回で読む。形が ^[A-Za-z0-9]{20}$ でない ID は読まずに false）
async function existingSubscriptionIds(db: Firestore, uid: string, docs: QueryDocumentSnapshot[]): Promise<Set<string>> {
  const ids = [...new Set(docs.map((doc) => doc.get('subscriptionId')).filter(isSubscriptionId))];
  if (ids.length === 0) return new Set();
  const subscriptions = db.collection('users').doc(uid).collection('subscriptions');
  const snapshots = await db.getAll(...ids.map((id) => subscriptions.doc(id)));
  return new Set(snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => snapshot.id));
}

// GET /api/notifications の中身（users と規約の版の確認・クエリの検査は route が先に行う）
// unreadCount は filter・cursor に関係なく直近90日の未読の全体（04-09 の countUnreadNotifications。S-03 のバッジと同じ数）
export async function listNotifications(uid: string, query: NotificationListQuery, options: NotificationOptions): Promise<NotificationListDto> {
  const db = options.db ?? adminDb();
  const { now } = options;
  const base = notificationsOf(db, uid)
    .where('createdAt', '>=', Timestamp.fromDate(unreadWindowStart(now)))
    .orderBy('createdAt', 'desc')
    .orderBy(FieldPath.documentId(), 'desc');

  const scan = async (): Promise<QueryDocumentSnapshot[]> => {
    const matched: QueryDocumentSnapshot[] = [];
    let next = query.cursor ? base.startAfter(Timestamp.fromMillis(query.cursor.millis), query.cursor.notificationId) : base;
    for (;;) {
      const snapshot = await next.limit(LIST_SCAN_BATCH).get();
      for (const doc of snapshot.docs) {
        const data = doc.data() as Record<string, unknown>;
        const createdAt = data.createdAt;
        if (!(createdAt instanceof Timestamp) || !isNotificationVisible(createdAt.toMillis(), now)) continue;
        if (!matchesFilter(data, query.filter)) continue;
        matched.push(doc);
        if (matched.length > query.limit) return matched; // limit+1 件そろった
      }
      if (snapshot.size < LIST_SCAN_BATCH) return matched;
      next = base.startAfter(snapshot.docs[snapshot.docs.length - 1]);
    }
  };

  const [matched, unreadCount] = await Promise.all([scan(), countUnreadNotifications(uid, now, db)]);
  const page = matched.slice(0, query.limit);
  const existing = await existingSubscriptionIds(db, uid, page);
  const items = page.map((doc) => toNotificationDto(doc, existing.has(doc.get('subscriptionId'))));
  const last = page[page.length - 1];
  const nextCursor = matched.length > query.limit && last ? `${(last.get('createdAt') as Timestamp).toMillis()}_${last.id}` : null;
  return { items, nextCursor, unreadCount };
}

// POST /api/notifications/:id/read の中身（API共通仕様 B93）。ID の形が違う・無い・他人のもの（自分の配下に無い）は 404。
// 90日より古い通知も既読にできる。すでに既読なら何も書かず、保存されている viewedAt を返す（既読を未読に戻す方法は作らない）。
// 読み取りと書き込みは1つの transaction（同時に押されても viewedAt は最初の1回の値のまま）。書くのは viewedAt と updatedAt だけ（update）
export async function markNotificationRead(uid: string, notificationId: string, options: NotificationOptions): Promise<MarkReadResult> {
  if (!NOTIFICATION_ID_PATTERN.test(notificationId)) throw new HttpError(404, 'NOT_FOUND');
  const db = options.db ?? adminDb();
  const ref = notificationsOf(db, uid).doc(notificationId);
  const viewedAt = Timestamp.fromDate(options.now);
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new HttpError(404, 'NOT_FOUND');
    const saved = snapshot.get('viewedAt');
    if (saved instanceof Timestamp) return { viewedAt: saved.toDate().toISOString() };
    tx.update(ref, { viewedAt, updatedAt: viewedAt });
    return { viewedAt: viewedAt.toDate().toISOString() };
  });
}

// POST /api/notifications/read-all の中身（API一覧 No.16、API共通仕様 B93）。検索は未読件数と同じ条件
// （viewedAt == null かつ createdAt >= 90日前。並びは指定しない＝既存の複合インデックス）。400件ずつ、1回の呼び出しで最大4回。
// 各回は transaction で読んで update する（その間に既読になった・消えた通知を書き直さない）。updatedCount は、この呼び出しで既読にした件数
export async function markAllNotificationsRead(uid: string, options: NotificationOptions): Promise<ReadAllResult> {
  const db = options.db ?? adminDb();
  const viewedAt = Timestamp.fromDate(options.now);
  const unread = notificationsOf(db, uid)
    .where('viewedAt', '==', null)
    .where('createdAt', '>=', Timestamp.fromDate(unreadWindowStart(options.now)))
    .limit(READ_ALL_BATCH);
  let updatedCount = 0;
  for (let round = 0; round < READ_ALL_MAX_ROUNDS; round += 1) {
    const count = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(unread);
      for (const doc of snapshot.docs) tx.update(doc.ref, { viewedAt, updatedAt: viewedAt });
      return snapshot.size;
    });
    updatedCount += count;
    if (count < READ_ALL_BATCH) break;
  }
  return { updatedCount };
}
