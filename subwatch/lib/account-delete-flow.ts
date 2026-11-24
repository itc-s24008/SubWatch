// アカウント削除の画面の文と判定（04-17。ブラウザから読む。firebase-admin を import しない）
// 文は画面設計書 S-09 ⑩・S-13 ⑧・状態・ダイアログ一覧（S-09 の30〜33・55行）、詳細_F-07、決まりの一覧 C-6・C-14 のとおり
import { ApiClientError, isGateError } from '@/lib/api-client';

export const DELETE_MESSAGES = {
  // 入口（S-09 ⑩はボタン、S-13 ⑧はリンク）
  triggerButton: 'アカウントを削除',
  triggerLink: 'アカウントを削除する',
  // ①確認
  confirmTitle: 'アカウントを削除しますか？',
  confirmBody: '登録したサブスクと通知の履歴がすべて消えます。',
  confirmWarning: 'この操作は取り消せません。', // 赤字
  confirmPrompt: '確認のため『DELETE』と入力してください',
  confirmPlaceholder: 'DELETE と入力',
  cancel: 'キャンセル',
  next: '次へ',
  // ②パスワードの再入力
  reauthTitle: 'パスワードを再入力',
  reauthPrompt: '本人確認のため、パスワードを再入力してください',
  submit: '削除する',
  deleting: '削除中…',
  wrongPassword: 'パスワードが違います', // 空のまま押したときも同じ
  reauthRequired: 'もう一度パスワードを入力してください', // 401 REAUTH_REQUIRED（入力欄を空にする）
  offline: 'オフラインです。接続を確認してください', // 押した時点で navigator.onLine が false（共通のオフラインの文）
  // 失敗（入口のすぐ下）
  failed: '削除できませんでした。もう一度お試しください',
  // S-02 のお知らせ（setFlash。signOut の前に置く）
  done: 'アカウントを削除しました。ご利用ありがとうございました',
  noResponse:
    '削除が完了したか確認できませんでした。もう一度ログインしてください（パスワードを確かめてもログインできなければ、削除は完了しています）',
} as const;

// API に送る文字列（入力欄の値ではなく、いつもこれを送る。API共通仕様 B101）
export const DELETE_CONFIRMATION = 'DELETE' as const;

// DELETE /api/account の時間切れ（30秒。api() の timeoutMs。setTimeout と AbortController は api() の中）
export const DELETE_TIMEOUT_MS = 30_000;

// ①の入力が、前後の空白を除いて大文字の DELETE と完全一致するか（一致したときだけ［次へ］を押せる）
export function isDeleteConfirmationInput(text: string): boolean {
  return text.trim() === DELETE_CONFIRMATION;
}

// ---- ②再認証の失敗（Firebase の reauthenticateWithCredential） ----
// パスワード違いとして扱う code（詳細_F-07 の手順2。メール列挙保護のため本番は auth/invalid-credential）
export const WRONG_PASSWORD_CODES: readonly string[] = [
  'auth/wrong-password',
  'auth/invalid-credential',
  'auth/invalid-login-credentials',
  'auth/missing-password',
];

function firebaseCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return '';
}

// 'wrongPassword'：ダイアログを開いたまま「パスワードが違います」（DELETE は呼ばない）
// 'failed'：通信の失敗・auth/too-many-requests など。削除の失敗と同じ表示（ダイアログを閉じて入口の下に「削除できませんでした…」）
export function reauthFailureOf(error: unknown): 'wrongPassword' | 'failed' {
  return WRONG_PASSWORD_CODES.includes(firebaseCode(error)) ? 'wrongPassword' : 'failed';
}

// ---- ③DELETE /api/account の結果 ----
//   'deleted'：200 {status:'deleted'} → 後始末 → お知らせ（完了）→ signOut → S-02
//   'noResponse'：送った後の status 0（OFFLINE・NETWORK_ERROR・TIMEOUT のどれでも）→ 後始末 → お知らせ（確認できなかった）→ signOut → S-02
//   'reauthRequired'：401 REAUTH_REQUIRED → ダイアログの中に「もう一度パスワードを入力してください」、入力欄を空にする
//   'gate'：401 UNAUTHENTICATED（ゲート）→ 何も出さない（AuthProvider が S-02 へ移し、期限切れの文を出す）
//   'failed'：応答が届いたそのほかの失敗（500・503・200 でも {status:'deleted'} でない応答）→ 入口の下に「削除できませんでした…」
//             （共通のオフライン・一時的な障害の文は出さない。503 でもサインアウトしない。API共通仕様 B103）
export type DeleteOutcome = 'deleted' | 'noResponse' | 'reauthRequired' | 'gate' | 'failed';

export function deleteResultOf(data: unknown): DeleteOutcome {
  if (data && typeof data === 'object' && (data as { status?: unknown }).status === 'deleted') return 'deleted';
  return 'failed';
}

export function deleteFailureOf(error: unknown): DeleteOutcome {
  if (isGateError(error)) return 'gate';
  if (!(error instanceof ApiClientError)) return 'failed';
  if (error.status === 0) return 'noResponse'; // Firebase のエラーの種類では判定しない（決まりの一覧 C-6）
  if (error.status === 401 && error.code === 'REAUTH_REQUIRED') return 'reauthRequired';
  return 'failed';
}

// ［削除する］を押した時点（再認証の前）でオフラインか
export function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}
