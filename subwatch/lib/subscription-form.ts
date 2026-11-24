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
// 【仮の関数】nextBillingDate・isValidDate・isEndOfMonth（04-04 の lib/billing.ts と同じ引数）と、
// hasCardLikeNumber・hasHttpScheme（04-07 の lib/validation.ts と同じ規則）は、まだ main に入っていないので、
// このファイルの下に仮に置いた（export しない）。統合①で lib/billing.ts・lib/validation.ts の import に置き換えて、仮の関数を消す
import { formatMonthDay, formatYen } from '@/lib/format';
import type { BillingCycle, BillingDayMode, Category, CreateSubscriptionBody, DateString, SubscriptionDto, UpdateSubscriptionBody } from '@/lib/types';

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

// エラー文（要件定義書「共通ルール」の入力項目の表・画面設計書 S-05）
export const FORM_MESSAGES = {
  serviceName: 'サービス名を入力してください',
  planName: 'プラン名は100文字以内で入力してください',
  price: '請求額は0〜10,000,000の整数で入力してください',
  billingCycle: '請求周期を選んでください',
  date: '正しい日付を選んでください',
  endOfMonth: '『毎月末日』は請求日が月末日のときだけ選べます',
  trialEndDateRequired: '最終無料日を入力してください',
  trialEndDateOrder: '最終無料日は請求日より前の日付を入力してください',
  url: 'http:// か https:// から始まるURLを入力してください',
  paymentMethod: '支払方法は80文字以内で入力してください',
  memo: 'メモは1000文字以内で入力してください',
  cardLike: 'カード番号は入力できません',
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

// ===== 仮の関数（統合①で lib/billing.ts・lib/validation.ts の import に置き換えて消す。export しない） =====

const CYCLE_MONTHS: Record<BillingCycle, number> = { monthly: 1, quarterly: 3, semiAnnual: 6, yearly: 12 };

function monthLength(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseYmd(s: unknown): { year: number; month: number; day: number } | null {
  if (typeof s !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > monthLength(year, month)) return null;
  return { year, month, day };
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

// 仮：lib/billing.ts の isValidDate と同じ（形が YYYY-MM-DD で実在する日付か。範囲は呼ぶ側が調べる）
function isValidDate(s: unknown): s is DateString {
  return parseYmd(s) !== null;
}

// 仮：lib/billing.ts の isEndOfMonth と同じ（壊れた日付は RangeError）
function isEndOfMonth(s: DateString): boolean {
  const ymd = parseYmd(s);
  if (!ymd) throw new RangeError('日付が正しくありません');
  return ymd.day === monthLength(ymd.year, ymd.month);
}

// 仮：lib/billing.ts の nextBillingDate と同じ（今日を含む、今日以降で最も早い請求日。fixedDay は月に無い日を月末日に丸め、
// 前回丸めた日を次の基準にしない。endOfMonth は請求のある月の末日。壊れた入力は RangeError）
function nextBillingDate(firstBillingDate: DateString, billingCycle: BillingCycle, billingDayMode: BillingDayMode, today: DateString): DateString {
  const first = parseYmd(firstBillingDate);
  const now = parseYmd(today);
  const months = CYCLE_MONTHS[billingCycle];
  if (!first || !now || months === undefined || (billingDayMode !== 'fixedDay' && billingDayMode !== 'endOfMonth')) {
    throw new RangeError('請求日・周期・方式が正しくありません');
  }
  const monthDiff = (now.year - first.year) * 12 + (now.month - first.month);
  for (let k = Math.max(0, Math.floor(monthDiff / months) - 1); ; k += 1) {
    const index = first.month - 1 + k * months;
    const year = first.year + Math.floor(index / 12);
    const month = (index % 12) + 1;
    const last = monthLength(year, month);
    const day = billingDayMode === 'endOfMonth' ? last : Math.min(first.day, last);
    const date = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
    if (date >= today) return date;
  }
}

// 仮：lib/validation.ts の hasCardLikeNumber と同じ（API共通仕様 B17 の正規表現）
function hasCardLikeNumber(s: string): boolean {
  return /\d(?:[ 　-]?\d){12,}/.test(s);
}

// 仮：lib/validation.ts の hasHttpScheme と同じ（API共通仕様 B63）
function hasHttpScheme(s: string): boolean {
  return /^https?:\/\//i.test(s);
}
