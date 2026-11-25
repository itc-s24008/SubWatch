// Google ログイン（決まりの一覧 C-19。メールとパスワードの登録・ログイン・再設定は廃止した）。ブラウザから使う
//   signInWithGoogle()：Google のポップアップでログインする（S-01 の登録・S-02 のログイン）
//   reauthenticateWithGoogle(user)：同じ Google アカウントでもう一度ログインする（アカウント削除の前の本人確認。auth_time が新しくなる）
//   googleFailureOf(error)：ポップアップの失敗の分け方（画面は、この結果で文を決める）
// Google のアカウントなら、@gmail.com でなくても（学校などの Google アカウントでも）入れる
// ポップアップは、ボタンを押した処理の中で（ほかの await より先に）開く（後で開くとブラウザに止められるため）
import { GoogleAuthProvider, reauthenticateWithPopup, signInWithPopup, type User, type UserCredential } from 'firebase/auth';
import { getFirebaseAuth } from '@/lib/firebase-client';

export const GOOGLE_PROVIDER_ID = 'google.com';

function googleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' }); // 毎回アカウントを選ばせる（端末に複数の Google アカウントがあるとき）
  return provider;
}

export function signInWithGoogle(): Promise<UserCredential> {
  return signInWithPopup(getFirebaseAuth(), googleProvider());
}

export function reauthenticateWithGoogle(user: User): Promise<UserCredential> {
  return reauthenticateWithPopup(user, googleProvider());
}

// Firebase のエラーの code（'auth/…'）を取り出す
function codeOf(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return '';
}

//   cancelled：ポップアップを閉じた・選ばなかった（文を出さず、もう一度押せるようにする）
//   popupBlocked：ブラウザがポップアップを止めた
//   otherMethod：同じメールアドレスの、以前のメールとパスワードのアカウントが残っている（人が Firebase のコンソールで消す）
//   userMismatch：本人確認で、ログイン中と違う Google アカウントを選んだ
//   disabled：Firebase で無効にされたアカウント
//   failed：通信の失敗など、そのほか
export type GoogleFailure = 'cancelled' | 'popupBlocked' | 'otherMethod' | 'userMismatch' | 'disabled' | 'failed';

const CANCELLED_CODES = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled']);

export function googleFailureOf(error: unknown): GoogleFailure {
  const code = codeOf(error);
  if (CANCELLED_CODES.has(code)) return 'cancelled';
  if (code === 'auth/popup-blocked') return 'popupBlocked';
  if (code === 'auth/account-exists-with-different-credential') return 'otherMethod';
  if (code === 'auth/user-mismatch') return 'userMismatch';
  if (code === 'auth/user-disabled') return 'disabled';
  return 'failed';
}

export const GOOGLE_MESSAGES = {
  loginButton: 'Googleでログイン',
  registerButton: 'Googleで登録',
  popupBlocked: 'ポップアップがブロックされました。ブラウザで許可してから、もう一度お試しください',
  otherMethod: 'このメールアドレスは、以前のメールとパスワードの登録が残っています。管理者に削除を依頼してから、もう一度お試しください',
  userMismatch: 'ログイン中と同じ Google アカウントを選んでください',
  disabled: 'このアカウントは利用できません',
} as const;

// S-01・S-02 の失敗の文（null は文を出さない）。failed のときは画面ごとの文（fallback）
export function googleSignInMessage(error: unknown, fallback: string): string | null {
  switch (googleFailureOf(error)) {
    case 'cancelled':
      return null;
    case 'popupBlocked':
      return GOOGLE_MESSAGES.popupBlocked;
    case 'otherMethod':
      return GOOGLE_MESSAGES.otherMethod;
    case 'disabled':
      return GOOGLE_MESSAGES.disabled;
    default:
      return fallback;
  }
}
