// サブスクの入力の検証（04-07。ブラウザからも使うので firebase を import しない）
// 規則は機能設計書「API共通仕様」（B5・B15〜B20・B57〜B60・B63）と、要件定義書「共通ルール」の入力項目の表
//
//   hasCardLikeNumber(s)：カード番号様の数字（半角数字13桁以上。数字の間に半角空白・全角空白・半角ハイフンが1つまで）を含むか
//   hasHttpScheme(s)：http:// か https:// で始まるか（URL としての解釈はしない。保存の検証、S-05 の入力、S-06 のリンクで同じものを使う）
//   duplicateKey(name)：同名の判定と S-04 の検索に使う形（前後の空白〔全角を含む〕を除き、英字 A-Z だけを小文字にする）
//   isSubscriptionId(s)：Firestore の自動 ID（英数字20文字）の形か
//   validateSubscriptionFields(body, mode)：項目ごとの検証（誤りを全部集める。1項目1件。型 → 長さ → カード番号様の順）
//   validateSubscriptionCrossFields(values)：項目の間の検証（項目ごとの誤りが無いときだけ呼ぶ）
import { isEndOfMonth, isValidDate } from '@/lib/billing';
import type { ApiFieldError, BillingCycle, BillingDayMode, Category, DateString } from '@/lib/types';

// ---- 部品（共通部品の形にある名前） ----

export function hasCardLikeNumber(s: string): boolean {
  return /\d(?:[ 　-]?\d){12,}/.test(s);
}

export function hasHttpScheme(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

export function duplicateKey(name: string): string {
  return name.trim().replace(/[A-Z]/g, (c) => c.toLowerCase());
}

export function isSubscriptionId(s: unknown): s is string {
  return typeof s === 'string' && /^[A-Za-z0-9]{20}$/.test(s);
}

// ---- 項目 ----

export const BILLING_CYCLES: readonly BillingCycle[] = ['monthly', 'quarterly', 'semiAnnual', 'yearly'];
export const BILLING_DAY_MODES: readonly BillingDayMode[] = ['fixedDay', 'endOfMonth'];
export const CATEGORIES: readonly Category[] = ['video', 'music', 'cloud', 'learning', 'ai', 'game', 'news', 'work', 'other'];

// 入力項目の表の順（details の順もこの順。API共通仕様 B6 の 6）
export const SUBSCRIPTION_FIELD_ORDER = [
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
] as const;

// POST /api/subscriptions が受け付けるキー（API一覧 No.7）と、PATCH が受け付けるキー（No.8。confirmDuplicate 以外）
export const CREATE_KEYS: readonly string[] = [...SUBSCRIPTION_FIELD_ORDER, 'confirmDuplicate'];
export const UPDATE_KEYS: readonly string[] = [...SUBSCRIPTION_FIELD_ORDER];

// POST の必須項目
export const REQUIRED_KEYS: readonly string[] = ['serviceName', 'price', 'billingCycle', 'firstBillingDate', 'billingDayMode', 'category'];

// 保存する値（検証と整形の後）
export interface SubscriptionValues {
  serviceName: string;
  planName: string | null;
  price: number;
  billingCycle: BillingCycle;
  firstBillingDate: DateString;
  billingDayMode: BillingDayMode;
  category: Category;
  trialEnabled: boolean;
  trialEndDate: DateString | null;
  websiteUrl: string | null;
  cancelUrl: string | null;
  paymentMethod: string | null;
  memo: string | null;
  subscriptionNotificationEnabled: boolean;
}

// 項目ごとの文（要件定義書「共通ルール」の入力項目の表。表に無い項目は「入力内容を確認してください」）
export const FIELD_MESSAGES = {
  serviceName: 'サービス名を入力してください',
  planName: 'プラン名は100文字以内で入力してください',
  price: '請求額は0〜10,000,000の整数で入力してください',
  billingCycle: '請求周期を選んでください',
  date: '正しい日付を選んでください',
  billingDayMode: '請求日方式を選んでください',
  category: 'カテゴリーを選んでください',
  url: 'http:// か https:// から始まるURLを入力してください',
  paymentMethod: '支払方法は80文字以内で入力してください',
  memo: 'メモは1000文字以内で入力してください',
  cardLike: 'カード番号は入力できません',
  other: '入力内容を確認してください',
  endOfMonth: '『毎月末日』は請求日が月末日のときだけ選べます',
  trialEndRequired: '最終無料日を入力してください',
  trialEndBefore: '最終無料日は請求日より前の日付を入力してください',
} as const;

const DATE_MIN = '2000-01-01';
const DATE_MAX = '2100-12-31';
const MAX_PRICE = 10_000_000;

// 文字数はコードポイントで数える（API共通仕様 B63）
function length(s: string): number {
  return Array.from(s).length;
}

type Check<T> = { ok: true; value: T } | { ok: false; error: ApiFieldError };

function fail(field: string, message: string, code = 'VALIDATION_ERROR'): { ok: false; error: ApiFieldError } {
  return { ok: false, error: { field, code, message } };
}

// 日付（文字列でない → VALIDATION_ERROR。文字列だが形・実在・範囲が不正 → INVALID_DATE。API共通仕様 B58）
function checkDate(field: string, value: unknown): Check<DateString> {
  if (typeof value !== 'string') return fail(field, FIELD_MESSAGES.date);
  if (!isValidDate(value) || value < DATE_MIN || value > DATE_MAX) return fail(field, FIELD_MESSAGES.date, 'INVALID_DATE');
  return { ok: true, value };
}

// 任意の文字列（null・空文字は null。前後の空白は取り除かない）
function checkOptionalText(field: string, value: unknown, max: number, message: string, cardCheck: boolean): Check<string | null> {
  if (value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return fail(field, message);
  if (length(value) > max) return fail(field, message);
  if (cardCheck && hasCardLikeNumber(value)) return fail(field, FIELD_MESSAGES.cardLike, 'CARD_LIKE_VALUE');
  return { ok: true, value };
}

function checkOptionalUrl(field: string, value: unknown): Check<string | null> {
  if (value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || length(value) > 2048 || !hasHttpScheme(value)) return fail(field, FIELD_MESSAGES.url);
  return { ok: true, value };
}

function checkBoolean(field: string, value: unknown): Check<boolean> {
  if (typeof value !== 'boolean') return fail(field, FIELD_MESSAGES.other);
  return { ok: true, value };
}

// 1つの項目を検証して、保存する形にする
export function checkSubscriptionField(field: string, value: unknown): Check<unknown> {
  switch (field) {
    case 'serviceName': {
      if (typeof value !== 'string') return fail(field, FIELD_MESSAGES.serviceName);
      const trimmed = value.trim();
      if (length(trimmed) < 1 || length(trimmed) > 100) return fail(field, FIELD_MESSAGES.serviceName);
      return { ok: true, value: trimmed };
    }
    case 'planName':
      return checkOptionalText(field, value, 100, FIELD_MESSAGES.planName, false);
    case 'price':
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_PRICE) return fail(field, FIELD_MESSAGES.price);
      return { ok: true, value };
    case 'billingCycle':
      if (!BILLING_CYCLES.includes(value as BillingCycle)) return fail(field, FIELD_MESSAGES.billingCycle);
      return { ok: true, value };
    case 'firstBillingDate':
      return checkDate(field, value);
    case 'billingDayMode':
      if (!BILLING_DAY_MODES.includes(value as BillingDayMode)) return fail(field, FIELD_MESSAGES.billingDayMode);
      return { ok: true, value };
    case 'category':
      if (!CATEGORIES.includes(value as Category)) return fail(field, FIELD_MESSAGES.category);
      return { ok: true, value };
    case 'trialEnabled':
    case 'subscriptionNotificationEnabled':
    case 'confirmDuplicate':
      return checkBoolean(field, value);
    case 'trialEndDate':
      if (value === null || value === '') return { ok: true, value: null };
      return checkDate(field, value);
    case 'websiteUrl':
    case 'cancelUrl':
      return checkOptionalUrl(field, value);
    case 'paymentMethod':
      return checkOptionalText(field, value, 80, FIELD_MESSAGES.paymentMethod, true);
    case 'memo':
      return checkOptionalText(field, value, 1000, FIELD_MESSAGES.memo, true);
    default:
      return fail(field, FIELD_MESSAGES.other);
  }
}

// 必須項目が無い・null のときの文
function missingError(field: string): ApiFieldError {
  if (field === 'firstBillingDate') return { field, code: 'VALIDATION_ERROR', message: FIELD_MESSAGES.date };
  const message = (FIELD_MESSAGES as Record<string, string>)[field] ?? FIELD_MESSAGES.other;
  return { field, code: 'VALIDATION_ERROR', message };
}

export interface FieldValidationResult {
  values: Partial<SubscriptionValues> & { confirmDuplicate?: boolean };
  errors: ApiFieldError[];
}

// 項目ごとの検証。mode 'create' は必須項目も調べ、省いた任意の項目に既定の値を入れる（文字列は null、trialEnabled は false、
// subscriptionNotificationEnabled は true）。'update' は送られた項目だけを調べる。誤りは入力項目の表の順に並べる
export function validateSubscriptionFields(body: Record<string, unknown>, mode: 'create' | 'update'): FieldValidationResult {
  const values: Record<string, unknown> = {};
  const errors: ApiFieldError[] = [];
  const order = mode === 'create' ? [...SUBSCRIPTION_FIELD_ORDER, 'confirmDuplicate'] : [...SUBSCRIPTION_FIELD_ORDER];
  for (const field of order) {
    const present = Object.prototype.hasOwnProperty.call(body, field) && body[field] !== undefined;
    if (!present) {
      if (mode === 'create' && REQUIRED_KEYS.includes(field)) errors.push(missingError(field));
      continue;
    }
    const value = body[field];
    if (value === null && REQUIRED_KEYS.includes(field)) {
      errors.push(missingError(field));
      continue;
    }
    const result = checkSubscriptionField(field, value);
    if (result.ok) values[field] = result.value;
    else errors.push(result.error);
  }
  if (mode === 'create' && errors.length === 0) {
    for (const key of ['planName', 'trialEndDate', 'websiteUrl', 'cancelUrl', 'paymentMethod', 'memo']) {
      if (!(key in values)) values[key] = null;
    }
    if (!('trialEnabled' in values)) values.trialEnabled = false;
    if (!('subscriptionNotificationEnabled' in values)) values.subscriptionNotificationEnabled = true;
  }
  return { values: values as FieldValidationResult['values'], errors };
}

// 項目の間の検証（API共通仕様 B19）。表の順：billingDayMode → trialEndDate。全部を返す
// trialEnabled が false のときは trialEndDate を見ない（保存する側が null にする）
export function validateSubscriptionCrossFields(values: Pick<SubscriptionValues, 'firstBillingDate' | 'billingDayMode' | 'trialEnabled' | 'trialEndDate'>): ApiFieldError[] {
  const errors: ApiFieldError[] = [];
  if (values.billingDayMode === 'endOfMonth' && !isEndOfMonth(values.firstBillingDate)) {
    errors.push({ field: 'billingDayMode', code: 'VALIDATION_ERROR', message: FIELD_MESSAGES.endOfMonth });
  }
  if (values.trialEnabled) {
    if (values.trialEndDate === null) {
      errors.push({ field: 'trialEndDate', code: 'VALIDATION_ERROR', message: FIELD_MESSAGES.trialEndRequired });
    } else if (values.trialEndDate >= values.firstBillingDate) {
      errors.push({ field: 'trialEndDate', code: 'VALIDATION_ERROR', message: FIELD_MESSAGES.trialEndBefore });
    }
  }
  return errors;
}
