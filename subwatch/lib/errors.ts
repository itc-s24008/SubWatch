// エラーの形（機能設計書「API共通仕様」）。route では throw new HttpError(...) するだけでよい（withApi が応答の形にする）
import type { ApiFieldError } from '@/lib/types';

// API が返す message（API共通仕様 B34〜B51。画面の文言と同じ）
export const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'ログインしてください',
  REAUTH_REQUIRED: 'もう一度パスワードを入力してください',
  INVALID_CRON_SECRET: '認証に失敗しました',
  NOT_FOUND: '見つかりません',
  ACCOUNT_NOT_INITIALIZED: 'アカウントの初期設定が完了していません',
  VALIDATION_ERROR: '入力内容を確認してください',
  UNKNOWN_FIELD: '不明な項目が含まれています',
  INVALID_DATE: '正しい日付を選んでください',
  CARD_LIKE_VALUE: 'カード番号は入力できません',
  SUBSCRIPTION_LIMIT_REACHED: '登録できるサブスクは200件までです',
  TERMS_RECONSENT_REQUIRED: '利用規約が更新されました。もう一度同意してください',
  CONFLICT: '競合しました。もう一度お試しください',
  CRON_ALREADY_RUNNING: 'すでに実行中です',
  DELETE_FAILED: '削除できませんでした。もう一度お試しください',
  INTERNAL_ERROR: '処理に失敗しました。もう一度お試しください',
  RESOURCE_EXHAUSTED: '一時的に利用できません。時間をおいて再試行してください',
  TEMPORARILY_UNAVAILABLE: '一時的に利用できません。時間をおいて再試行してください',
};

export interface ErrorExtras {
  field?: string; // 最初の誤りの項目
  details?: ApiFieldError[]; // 誤りのある項目すべて（1項目1件）
  candidates?: { subscriptionId: string; serviceName: string }[]; // DUPLICATE_CANDIDATE（409）のときだけ
}

// new HttpError(status, code, message?, extras?)。message を省くと ERROR_MESSAGES の文
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extras: ErrorExtras;

  constructor(status: number, code: string, message?: string, extras: ErrorExtras = {}) {
    super(message ?? ERROR_MESSAGES[code] ?? ERROR_MESSAGES.INTERNAL_ERROR);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.extras = extras;
  }
}

// Firestore（gRPC）のエラーの番号。firebase-admin は数値、ほかの経路では文字列のことがある
function grpcCode(error: unknown): number | string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'number' || typeof code === 'string') return code;
  }
  return undefined;
}

// Firestore のエラーを HttpError に変える（API共通仕様 B21）。withApi が自動でかけるので、route では呼ばなくてよい
// 10 ABORTED・6 ALREADY_EXISTS → 409 CONFLICT／8 RESOURCE_EXHAUSTED → 500 RESOURCE_EXHAUSTED／14 UNAVAILABLE → 503 TEMPORARILY_UNAVAILABLE／その他 → 500 INTERNAL_ERROR
export function fromFirestoreError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  const code = grpcCode(error);
  if (code === 10 || code === 'aborted' || code === 6 || code === 'already-exists') {
    return new HttpError(409, 'CONFLICT');
  }
  if (code === 8 || code === 'resource-exhausted') return new HttpError(500, 'RESOURCE_EXHAUSTED');
  if (code === 14 || code === 'unavailable') return new HttpError(503, 'TEMPORARILY_UNAVAILABLE');
  return new HttpError(500, 'INTERNAL_ERROR');
}

// Firestore の NOT_FOUND（5）か。update で、対象のドキュメントが無いときに使う
export function isFirestoreNotFound(error: unknown): boolean {
  const code = grpcCode(error);
  return code === 5 || code === 'not-found';
}
