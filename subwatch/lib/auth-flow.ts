// 登録（S-01）・ログイン（S-02）の画面の文と判定（04-05）。ブラウザから読む（firebase-admin を import しない）
// 文は画面設計書 S-01・S-02・S-09・状態・ダイアログ一覧、決まりの一覧 C-4 のとおり
import { ApiClientError } from '@/lib/api-client';

export const AUTH_MESSAGES = {
  // S-01
  emailInvalid: 'メールアドレスの形式が正しくありません',
  passwordTooShort: 'パスワードは8文字以上で入力してください',
  passwordMismatch: 'パスワードが一致しません',
  emailInUse: 'このメールアドレスはすでに登録されています',
  continueWithLogin: 'ログインして続けてください',
  registerFailed: '登録できませんでした。もう一度お試しください',
  retryDescription: '初期設定が完了していません。同意して、やり直してください',
  accountLoadFailed: '読み込めませんでした。ページを再読み込みしてください',
  // S-02
  loginInvalid: 'メールアドレスまたはパスワードが正しくありません',
  loginFailed: 'ログインできませんでした。もう一度お試しください',
  resetEmailRequired: 'メールアドレスを入力してください',
  resetSent: '再設定用のメールを送りました。届かない場合は迷惑メールフォルダを確認してください',
  resetFailed: '送信できませんでした。もう一度お試しください',
  // S-09 ⑧
  resetSentShort: '再設定用のメールを送りました',
  // S-02 のお知らせ（ほかの画面から移ってきたとき。setFlash で置く）
  flashExpired: 'ログインの有効期限が切れました。もう一度ログインしてください',
  flashTermsUpdated: '利用規約が更新されました。もう一度同意してください',
  flashBootstrapFailed: '登録は完了しましたが初期設定に失敗しました。もう一度ログインしてください',
  // 共通の文（components/ui.tsx の commonErrorMessage と同じ文）
  offline: 'オフラインです。接続を確認してください',
  temporarilyUnavailable: '一時的に利用できません。時間をおいて再試行してください',
} as const;

export const MIN_PASSWORD_LENGTH = 8; // 決まりの一覧 C-16

// 文字数はコードポイントで数える（絵文字1つ＝1文字）
function lengthOf(text: string): number {
  return [...text].length;
}

// ---- S-01 の入力の検証（①〜③） ----
// emailValid は入力欄（type="email"）の判定（input.validity.valid）。独自の正規表現は作らない
export interface RegisterInput {
  email: string;
  emailValid: boolean;
  password: string;
  passwordConfirm: string;
}

export interface RegisterErrors {
  email?: string;
  password?: string;
  passwordConfirm?: string;
}

export function validateRegisterInput(input: RegisterInput): RegisterErrors {
  const errors: RegisterErrors = {};
  if (input.email.trim() === '' || !input.emailValid) errors.email = AUTH_MESSAGES.emailInvalid;
  if (lengthOf(input.password) < MIN_PASSWORD_LENGTH) errors.password = AUTH_MESSAGES.passwordTooShort;
  if (input.password !== input.passwordConfirm) errors.passwordConfirm = AUTH_MESSAGES.passwordMismatch;
  return errors;
}

export function hasErrors(errors: RegisterErrors): boolean {
  return Object.values(errors).some(Boolean);
}

// Firebase のエラーの code（'auth/…'）を取り出す
export function firebaseErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return '';
}

// ---- S-01：ユーザーの作成（createUserWithEmailAndPassword）の失敗 ----
// field：その文を出す入力欄（無ければ［アカウントを作成］のすぐ上）。emailInUse のときは、文の下に S-02 へのリンクを出す
export interface SignUpFailure {
  field?: 'email' | 'password';
  message: string;
  emailInUse?: boolean;
}

export function signUpFailure(error: unknown): SignUpFailure {
  switch (firebaseErrorCode(error)) {
    case 'auth/email-already-in-use':
      return { field: 'email', message: AUTH_MESSAGES.emailInUse, emailInUse: true };
    case 'auth/invalid-email':
    case 'auth/missing-email':
      return { field: 'email', message: AUTH_MESSAGES.emailInvalid };
    case 'auth/weak-password':
    case 'auth/missing-password':
    case 'auth/password-does-not-meet-requirements':
      return { field: 'password', message: AUTH_MESSAGES.passwordTooShort };
    default:
      return { message: AUTH_MESSAGES.registerFailed };
  }
}

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

// ---- S-02：ログイン（signInWithEmailAndPassword）の失敗 ----
// メール列挙保護のため、ふつうは auth/invalid-credential。どちらが違うかは示さない
const INVALID_LOGIN_CODES = new Set([
  'auth/invalid-credential',
  'auth/invalid-login-credentials',
  'auth/wrong-password',
  'auth/user-not-found',
  'auth/invalid-email',
  'auth/missing-email',
  'auth/missing-password',
  'auth/user-disabled',
]);

export function loginFailureMessage(error: unknown): string {
  return INVALID_LOGIN_CODES.has(firebaseErrorCode(error)) ? AUTH_MESSAGES.loginInvalid : AUTH_MESSAGES.loginFailed;
}

// ---- S-02 ③・S-09 ⑧：再設定メール（sendPasswordResetEmail）の結果 ----
//   sent：送った（auth/user-not-found も同じ。登録の有無を知らせない）
//   invalidEmail：①の形式が違う（①の下に「メールアドレスを入力してください」）
//   failed：通信の失敗など
export type ResetResult = 'sent' | 'invalidEmail' | 'failed';

export function resetResultOf(error: unknown): ResetResult {
  if (error === null || error === undefined) return 'sent';
  const code = firebaseErrorCode(error);
  if (code === 'auth/user-not-found') return 'sent';
  if (code === 'auth/invalid-email' || code === 'auth/missing-email') return 'invalidEmail';
  return 'failed';
}
