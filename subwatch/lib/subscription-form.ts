// S-05（サブスクの登録・編集）の入力値と検証（04-06。ブラウザで使う。firebase を import しない）
// 規則は要件定義書「共通ルール」の入力項目の表、画面設計書 2.画面詳細(S-05)、機能設計書「API共通仕様」（B15・B17・B19・B20・B63）
//
//   FormValues：フォームの値（入力欄の文字のまま持つ）
//   initialFormValues()：新規の初期値（請求周期は「選択してください」、請求日方式は「請求日と同じ日」、カテゴリーは「その他」、通知はオン）
//   toFormValues(subscription)：API の値 → フォームの値（編集で使う。04-08）
//   validateForm(values)：項目ごとのエラー文（欄ごとに1つ。誤りの無い欄は入れない）
//   toCreateBody(values)：POST /api/subscriptions の本文（任意の項目が空なら null。トライアルが OFF なら trialEndDate: null。confirmDuplicate は入れない）
//   toUpdateBody(before, after)：PATCH /api/subscriptions/:id の本文（変更した項目だけ。変更が無ければ空のオブジェクト）
//   nextBillingPreview(values, today)：⑧の表示（「11/08（¥1,590）」。請求額が正しくないときは日付だけ、計算できないときは「―」）
//   canChooseEndOfMonth(firstBillingDate)：⑦の「毎月末日」を選べるか（⑥が正しい日付で、月末日のとき）
//
// 日付の部品・次回請求日（nextBillingDate・isValidDate・isEndOfMonth）は lib/billing.ts、カード番号様と URL の判定
// （hasCardLikeNumber・hasHttpScheme）は lib/validation.ts のものを使う（保存の検証と同じ関数。統合①〔11/19〕で仮の関数から置き換えた）
import { isEndOfMonth, isValidDate, nextBillingDate } from '@/lib/billing';
import { formatMonthDay, formatYen } from '@/lib/format';
import type { BillingCycle, BillingDayMode, Category, CreateSubscriptionBody, DateString, SubscriptionDto, UpdateSubscriptionBody } from '@/lib/types';
import { FIELD_MESSAGES, hasCardLikeNumber, hasHttpScheme } from '@/lib/validation';

export interface FormValues {
  serviceName: string;
  planName: string;
  price: string;
  billingCycle: BillingCycle | '';
  firstBillingDate: string;
  billingDayMode: BillingDayMode;
  category: Category;
  trialEnabled: boolean;
  trialEndDate: string;
  websiteUrl: string;
  cancelUrl: string;
  paymentMethod: string;
  memo: string;
  subscriptionNotificationEnabled: boolean;
}

export type FormField = keyof FormValues;
export type FormErrors = Partial<Record<FormField, string>>;

// 画面の上から下の順（要件定義書「共通ルール」の入力項目の表の順と同じ）
export const FORM_FIELDS: readonly FormField[] = [
  'serviceName',
  'planName',
  'price',
  'billingCycle',
  'firstBillingDate',
  'billingDayMode',
  'category',
  'trialEnabled',
  'trialEndDate',
  'websiteUrl',
  'cancelUrl',
  'paymentMethod',
  'memo',
  'subscriptionNotificationEnabled',
];

export const BILLING_CYCLE_OPTIONS: readonly BillingCycle[] = ['monthly', 'quarterly', 'semiAnnual', 'yearly'];
export const CATEGORY_OPTIONS: readonly Category[] = ['video', 'music', 'cloud', 'learning', 'ai', 'game', 'news', 'work', 'other'];

// エラー文（要件定義書「共通ルール」の入力項目の表・画面設計書 S-05）。
// 文は保存の検証（04-07 の lib/validation.ts の FIELD_MESSAGES）と同じものを使う（統合①〔11/19〕で、同じ文の2か所の定義を1つにそろえた。文は変わっていない）
export const FORM_MESSAGES = {
  serviceName: FIELD_MESSAGES.serviceName,
  planName: FIELD_MESSAGES.planName,
  price: FIELD_MESSAGES.price,
  billingCycle: FIELD_MESSAGES.billingCycle,
  date: FIELD_MESSAGES.date,
  endOfMonth: FIELD_MESSAGES.endOfMonth,
  trialEndDateRequired: FIELD_MESSAGES.trialEndRequired,
  trialEndDateOrder: FIELD_MESSAGES.trialEndBefore,
  url: FIELD_MESSAGES.url,
  paymentMethod: FIELD_MESSAGES.paymentMethod,
  memo: FIELD_MESSAGES.memo,
  cardLike: FIELD_MESSAGES.cardLike,
} as const;

const MIN_DATE = '2000-01-01';
const MAX_DATE = '2100-12-31';
const MAX_PRICE = 10_000_000;

export function initialFormValues(): FormValues {
  return {
    serviceName: '',
    planName: '',
    price: '',
    billingCycle: '',
    firstBillingDate: '',
    billingDayMode: 'fixedDay',
    category: 'other',
    trialEnabled: false,
    trialEndDate: '',
    websiteUrl: '',
    cancelUrl: '',
    paymentMethod: '',
    memo: '',
    subscriptionNotificationEnabled: true,
  };
}

export function toFormValues(subscription: SubscriptionDto): FormValues {
  return {
    serviceName: subscription.serviceName,
    planName: subscription.planName ?? '',
    price: String(subscription.price),
    billingCycle: subscription.billingCycle,
    firstBillingDate: subscription.firstBillingDate,
    billingDayMode: subscription.billingDayMode,
    category: subscription.category,
    trialEnabled: subscription.trialEnabled,
    trialEndDate: subscription.trialEndDate ?? '',
    websiteUrl: subscription.websiteUrl ?? '',
    cancelUrl: subscription.cancelUrl ?? '',
    paymentMethod: subscription.paymentMethod ?? '',
    memo: subscription.memo ?? '',
    subscriptionNotificationEnabled: subscription.subscriptionNotificationEnabled,
  };
}

// 文字数はコードポイントで数える（API共通仕様 B63）
function lengthOf(s: string): number {
  return Array.from(s).length;
}

// 2000-01-01〜2100-12-31 の実在する日付か
function isDateInRange(s: string): boolean {
  return isValidDate(s) && s >= MIN_DATE && s <= MAX_DATE;
}

// 請求額：前後の空白を除いた半角数字だけ（全角数字・小数・カンマ・符号は誤り）で、0〜10,000,000
function parsePrice(s: string): number | null {
  const trimmed = s.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value <= MAX_PRICE ? value : null;
}

export function canChooseEndOfMonth(firstBillingDate: string): boolean {
  return isDateInRange(firstBillingDate) && isEndOfMonth(firstBillingDate);
}

export function validateForm(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  const name = values.serviceName.trim();
  if (lengthOf(name) < 1 || lengthOf(name) > 100) errors.serviceName = FORM_MESSAGES.serviceName;
  if (lengthOf(values.planName) > 100) errors.planName = FORM_MESSAGES.planName;
  if (parsePrice(values.price) === null) errors.price = FORM_MESSAGES.price;
  if (!BILLING_CYCLE_OPTIONS.includes(values.billingCycle as BillingCycle)) errors.billingCycle = FORM_MESSAGES.billingCycle;
  const firstValid = isDateInRange(values.firstBillingDate);
  if (!firstValid) errors.firstBillingDate = FORM_MESSAGES.date;
  if (values.billingDayMode === 'endOfMonth' && firstValid && !isEndOfMonth(values.firstBillingDate)) {
    errors.billingDayMode = FORM_MESSAGES.endOfMonth;
  }
  if (values.trialEnabled) {
    if (values.trialEndDate === '') errors.trialEndDate = FORM_MESSAGES.trialEndDateRequired;
    else if (!isDateInRange(values.trialEndDate)) errors.trialEndDate = FORM_MESSAGES.date;
    else if (firstValid && values.trialEndDate >= values.firstBillingDate) errors.trialEndDate = FORM_MESSAGES.trialEndDateOrder;
  }
  for (const key of ['websiteUrl', 'cancelUrl'] as const) {
    const url = values[key];
    if (url !== '' && (!hasHttpScheme(url) || lengthOf(url) > 2048)) errors[key] = FORM_MESSAGES.url;
  }
  // 長さ → カード番号様の順（API共通仕様 B4）
  if (lengthOf(values.paymentMethod) > 80) errors.paymentMethod = FORM_MESSAGES.paymentMethod;
  else if (hasCardLikeNumber(values.paymentMethod)) errors.paymentMethod = FORM_MESSAGES.cardLike;
  if (lengthOf(values.memo) > 1000) errors.memo = FORM_MESSAGES.memo;
  else if (hasCardLikeNumber(values.memo)) errors.memo = FORM_MESSAGES.cardLike;
  return errors;
}

// 任意の文字列は、空なら null（前後の空白は取り除かない。API共通仕様 B63）
function optional(s: string): string | null {
  return s === '' ? null : s;
}

// 検証を通った値から作る（検証の前に呼ばない）
export function toCreateBody(values: FormValues): CreateSubscriptionBody {
  return {
    serviceName: values.serviceName.trim(),
    planName: optional(values.planName),
    price: parsePrice(values.price) ?? Number.NaN,
    billingCycle: values.billingCycle as BillingCycle,
    firstBillingDate: values.firstBillingDate,
    billingDayMode: values.billingDayMode,
    category: values.category,
    trialEnabled: values.trialEnabled,
    trialEndDate: values.trialEnabled ? values.trialEndDate : null,
    websiteUrl: optional(values.websiteUrl),
    cancelUrl: optional(values.cancelUrl),
    paymentMethod: optional(values.paymentMethod),
    memo: optional(values.memo),
    subscriptionNotificationEnabled: values.subscriptionNotificationEnabled,
  };
}

// 変更した項目だけ（保存済みの値をフォームの値にして、同じ形の本文どうしで比べる）。変更が無ければ {}
export function toUpdateBody(before: SubscriptionDto, after: FormValues): UpdateSubscriptionBody {
  const oldBody = toCreateBody(toFormValues(before));
  const newBody = toCreateBody(after);
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(newBody) as (keyof CreateSubscriptionBody)[]) {
    if (newBody[key] !== oldBody[key]) result[key] = newBody[key];
  }
  return result as UpdateSubscriptionBody;
}

// ⑧ 次回請求日の参考表示（画面側の計算。保存後はサーバーの値を表示する）
export function nextBillingPreview(values: FormValues, today: DateString): string {
  const cycle = values.billingCycle;
  if (cycle === '' || !isDateInRange(values.firstBillingDate)) return '―';
  if (values.billingDayMode === 'endOfMonth' && !isEndOfMonth(values.firstBillingDate)) return '―';
  let date: DateString;
  try {
    date = nextBillingDate(values.firstBillingDate, cycle, values.billingDayMode, today);
  } catch {
    return '―';
  }
  const price = parsePrice(values.price);
  return price === null ? formatMonthDay(date) : `${formatMonthDay(date)}（${formatYen(price)}）`;
}
