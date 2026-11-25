// 登録（S-01）・ログイン（S-02）の画面の文と判定（04-05）。ブラウザから読む（firebase-admin を import しない）
// 文は画面設計書 S-01・S-02・S-09・状態・ダイアログ一覧、決まりの一覧 C-4 のとおり。
// ログインは Google だけ（決まりの一覧 C-19）。メールとパスワードの入力・再設定メールの文と判定は消した。Google のポップアップの失敗は lib/google-auth.ts
import { ApiClientError } from '@/lib/api-client';

export const AUTH_MESSAGES = {
  // S-01
  registerFailed: '登録できませんでした。もう一度お試しください',
  retryDescription: '初期設定が完了していません。同意して、やり直してください',
  accountLoadFailed: '読み込めませんでした。ページを再読み込みしてください',
  // S-02
  loginFailed: 'ログインできませんでした。もう一度お試しください',
  // S-02 のお知らせ（ほかの画面から移ってきたとき。setFlash で置く）
  flashExpired: 'ログインの有効期限が切れました。もう一度ログインしてください',
  flashTermsUpdated: '利用規約が更新されました。もう一度同意してください',
  flashBootstrapFailed: '登録は完了しましたが初期設定に失敗しました。もう一度ログインしてください',
  // 共通の文（components/ui.tsx の commonErrorMessage と同じ文）
  offline: 'オフラインです。接続を確認してください',
  temporarilyUnavailable: '一時的に利用できません。時間をおいて再試行してください',
} as const;

// ---- S-01・S-13：bootstrap（POST /api/account/bootstrap）の失敗の分け方（決まりの一覧 C-4） ----
//   gate：401 UNAUTHENTICATED。onApiGate（AuthProvider）が S-02 へ移すので、画面は何もしない
//   termsMismatch：409 TERMS_RECONSENT_REQUIRED（版違い）
//   retryable：やり直せる失敗（503・500 RESOURCE_EXHAUSTED・409 CONFLICT・status 0）。message をその場で出す
//   other：それ以外（500 INTERNAL_ERROR など）
export type BootstrapFailure =
  | { kind: 'gate' }
  | { kind: 'termsMismatch' }
  | { kind: 'retryable'; message: string }
  | { kind: 'other' };

export function classifyBootstrapFailure(error: unknown): BootstrapFailure {
  if (!(error instanceof ApiClientError)) return { kind: 'other' };
  if (error.status === 401 && error.code === 'UNAUTHENTICATED') return { kind: 'gate' };
  if (error.status === 409 && error.code === 'TERMS_RECONSENT_REQUIRED') return { kind: 'termsMismatch' };
  if (error.status === 503 || (error.status === 500 && error.code === 'RESOURCE_EXHAUSTED')) {
    return { kind: 'retryable', message: AUTH_MESSAGES.temporarilyUnavailable };
  }
  if (error.status === 409 && error.code === 'CONFLICT') return { kind: 'retryable', message: AUTH_MESSAGES.registerFailed };
  if (error.status === 0) {
    return { kind: 'retryable', message: error.code === 'OFFLINE' ? AUTH_MESSAGES.offline : AUTH_MESSAGES.registerFailed };
  }
  return { kind: 'other' };
}
