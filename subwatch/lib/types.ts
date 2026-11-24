// 型定義（機能設計書「型定義」をそのまま置く。ほかのファイルで定義し直さない）
// 保存の形の型（SubscriptionDoc・NotificationEventDoc・CronRunDoc）は DB設計書 No.2・No.3・No.5 の物理名
import type { Timestamp } from 'firebase-admin/firestore';

export type BillingCycle = 'monthly' | 'quarterly' | 'semiAnnual' | 'yearly';
export type BillingDayMode = 'fixedDay' | 'endOfMonth';
export type Category = 'video' | 'music' | 'cloud' | 'learning' | 'ai' | 'game' | 'news' | 'work' | 'other';
export type DateString = string; // 'YYYY-MM-DD'（日本時間、2000-01-01〜2100-12-31）
export type IsoString = string; // ISO 8601（UTC）。APIのJSONでの日時

// APIが返す／受け取るサブスク（uid は含めない）
export interface SubscriptionDto {
  subscriptionId: string;
  serviceName: string;
  planName: string | null;
  price: number; // 円。0〜10,000,000の整数
  billingCycle: BillingCycle;
  firstBillingDate: DateString;
  nextBillingDate: DateString; // 毎回計算した値（読み取り専用）
  billingDayMode: BillingDayMode;
  category: Category;
  trialEnabled: boolean;
  trialEndDate: DateString | null;
  websiteUrl: string | null;
  cancelUrl: string | null;
  paymentMethod: string | null;
  memo: string | null;
  subscriptionNotificationEnabled: boolean;
  createdAt: IsoString;
  updatedAt: IsoString;
}

// POST /api/subscriptions の本文（必須: serviceName, price, billingCycle, firstBillingDate, billingDayMode, category）
export interface CreateSubscriptionBody {
  serviceName: string;
  price: number;
  billingCycle: BillingCycle;
  firstBillingDate: DateString;
  billingDayMode: BillingDayMode;
  category: Category;
  planName?: string | null;
  trialEnabled?: boolean;
  trialEndDate?: DateString | null;
  websiteUrl?: string | null;
  cancelUrl?: string | null;
  paymentMethod?: string | null;
  memo?: string | null;
  subscriptionNotificationEnabled?: boolean;
  confirmDuplicate?: boolean;
}
// PATCH /api/subscriptions/:id の本文（1項目以上。confirmDuplicate は受け付けない）
export type UpdateSubscriptionBody = Partial<Omit<CreateSubscriptionBody, 'confirmDuplicate'>>;

// AccountDto の pushSubscriptionCount、NotificationDto の daysBefore・targetDate・priceAtNotification・webPushStatus、SubscriptionDto の updatedAt、ReadAllResult の updatedCount、409 DUPLICATE_CANDIDATE の candidates は画面では使わない（テストと運用で使う）
export interface AccountDto {
  email: string;
  accountNotificationEnabled: boolean;
  termsVersion: string;
  privacyVersion: string;
  pushSubscriptionCount: number;
  pushSubscriptionIds: string[];
}
export interface BootstrapBody {
  termsAccepted: true;
  privacyAccepted: true;
  termsVersion: string;
  privacyVersion: string;
}
export interface NotificationDto {
  notificationId: string;
  subscriptionId: string;
  serviceNameAtNotification: string;
  notificationType: 'billing' | 'trial_end';
  daysBefore: 7 | 1;
  targetDate: DateString;
  title: string;
  body: string;
  priceAtNotification: number | null;
  subscriptionExists: boolean; // そのサブスクが今もあるか（GET /api/notifications が付ける）
  viewedAt: IsoString | null;
  webPushStatus: 'pending' | 'sent' | 'partially_sent' | 'failed' | 'skipped';
  createdAt: IsoString;
}

export interface ApiFieldError {
  field: string;
  code: string;
  message: string;
}
export interface ApiError {
  code: string;
  message: string;
  field?: string;
  details?: ApiFieldError[];
  candidates?: { subscriptionId: string; serviceName: string }[];
}
export type ApiResponse<T> = { data: T; error: null; requestId: string } | { data: null; error: ApiError; requestId: string };

// GET /api/dashboard（API一覧 No.10）
export interface DashboardDto {
  weekTotal: { count: number; amountJPY: number };
  monthTotal: { count: number; amountJPY: number };
  monthlyEquivalentJPY: number;
  yearlyEquivalentJPY: number;
  subscriptionCount: number;
  unreadCount: number;
  nextBills: { subscriptionId: string; serviceName: string; websiteUrl: string | null; date: DateString; priceJPY: number; daysLeft: number }[];
}
// GET /api/calendar?month=YYYY-MM（API一覧 No.11）
export interface CalendarDto {
  month: string; // YYYY-MM
  days: { date: DateString; items: { subscriptionId: string; serviceName: string; priceJPY: number }[] }[];
  monthTotalJPY: number;
}

// Cron と Push 送信の間の約束（分担は「詳細_F-06」の 8-6）
export type WebPushStatus = 'pending' | 'sent' | 'partially_sent' | 'failed' | 'skipped';
export interface NotificationEvent {
  notificationId: string;
  uid: string;
  subscriptionId: string;
  serviceNameAtNotification: string;
  notificationType: 'billing' | 'trial_end';
  daysBefore: 7 | 1;
  targetDate: DateString;
  title: string;
  body: string;
  priceAtNotification: number | null;
  webPushStatus: WebPushStatus;
  webPushDeliveredIds: string[];
}
// PushResult.deliveredIds は、送り終えた端末の全部（前の実行までの分と、今回の分。保存した後の webPushDeliveredIds と同じ）
export interface PushResult {
  status: Exclude<WebPushStatus, 'pending'>;
  deliveredIds: string[];
  lastErrorCode: string | null;
}
export type PushSender = (uid: string, event: NotificationEvent) => Promise<PushResult>;
// GET /api/notifications の応答（API一覧 No.14。filter は all・unread・billing・trial_end）
export type NotificationFilter = 'all' | 'unread' | 'billing' | 'trial_end';
export interface NotificationListDto {
  items: NotificationDto[];
  nextCursor: string | null;
  unreadCount: number;
}
// DELETE /api/account の成功の応答（API一覧 No.4）
export interface DeleteAccountResult {
  status: 'deleted';
}
// DELETE /api/account の本文（API一覧 No.4。画面は入力値ではなく固定の 'DELETE' を送る）
export interface DeleteAccountBody {
  confirmation: 'DELETE';
}
// GET /api/subscriptions の応答（API一覧 No.5。totalCount は画面では使わない。テストで使う）
export interface SubscriptionListDto {
  items: SubscriptionDto[];
  totalCount: number;
}
// POST /api/push/subscribe の本文と応答（API一覧 No.12）
export interface PushSubscribeRequest {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | null;
}
export interface PushUnsubscribeRequest {
  endpoint: string;
}
// POST /api/account/bootstrap の応答（API一覧 No.1。画面では使わない。テストで使う）
export interface BootstrapResult {
  uid: string;
  initialized: true;
}
// PATCH /api/account の本文と応答（No.3）
export interface UpdateAccountBody {
  accountNotificationEnabled: boolean;
}
export type UpdateAccountResult = UpdateAccountBody;
// GET/POST/PATCH の1件の応答（No.6〜8）
export interface SubscriptionResponse {
  subscription: SubscriptionDto;
}
// 既読の応答（No.15・No.16）
export interface MarkReadResult {
  viewedAt: IsoString;
}
export interface ReadAllResult {
  updatedCount: number;
}
export interface PushSubscribeResult {
  enabled: true;
}
// GET /api/cron/daily の応答（API一覧 No.17）
export interface CronResult {
  status: 'completed' | 'partial' | 'noop';
  createdCount: number;
  sentCount: number;
  failedCount: number;
}

// ---- 保存の形（DB設計書 No.1〜No.5。応答の Dto と分ける） ----
export interface ConsentRecord {
  termsVersion: string;
  privacyVersion: string;
  acceptedAt: Timestamp;
  kind: 'create' | 'reconsent';
}

// users/{uid}/subscriptions/{subscriptionId}（DB設計書 テーブルNo.2）
export interface SubscriptionDoc {
  subscriptionId: string;
  uid: string;
  serviceName: string;
  planName: string | null;
  price: number;
  billingCycle: BillingCycle;
  firstBillingDate: DateString;
  nextBillingDate: DateString; // 保存値（Cron の検索用）
  billingDayMode: BillingDayMode;
  category: Category;
  trialEnabled: boolean;
  trialEndDate: DateString | null;
  websiteUrl: string | null;
  cancelUrl: string | null;
  paymentMethod: string | null;
  memo: string | null;
  subscriptionNotificationEnabled: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// users/{uid}/notificationEvents/{notificationId}（DB設計書 テーブルNo.3）
export interface NotificationEventDoc extends NotificationEvent {
  viewedAt: Timestamp | null;
  webPushSentAt: Timestamp | null;
  webPushLastErrorCode: string | null;
  expireAt: Timestamp; // createdAt の90日後
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// cronRuns/{runDate}（DB設計書 テーブルNo.5）
export type CronRunStatus = 'running' | 'completed' | 'partial' | 'failed';
export interface CronRunDoc {
  runDate: DateString;
  status: CronRunStatus;
  startedAt: Timestamp;
  finishedAt: Timestamp | null;
  createdCount: number;
  sentCount: number;
  failedCount: number;
  errorCode: 'CONFLICT' | 'RESOURCE_EXHAUSTED' | 'TEMPORARILY_UNAVAILABLE' | 'INTERNAL_ERROR' | null;
  expireAt: Timestamp; // startedAt の90日後
  updatedAt: Timestamp;
}
