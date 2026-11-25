// lib/auth-flow.ts（S-01・S-02 の文と判定。04-05）と lib/google-auth.ts（Google ログインの失敗の分け方。C-19）の単体テスト
import { describe, expect, it } from 'vitest';
import { ApiClientError } from '@/lib/api-client';
import { classifyBootstrapFailure } from '@/lib/auth-flow';
import { GOOGLE_MESSAGES, googleFailureOf, googleSignInMessage } from '@/lib/google-auth';

function apiError(status: number, code: string): ApiClientError {
  return new ApiClientError(status, code, 'x');
}

describe('classifyBootstrapFailure（決まりの一覧 C-4）', () => {
  it('401 UNAUTHENTICATED は onApiGate に任せる', () => {
    expect(classifyBootstrapFailure(apiError(401, 'UNAUTHENTICATED'))).toEqual({ kind: 'gate' });
  });

  it('409 TERMS_RECONSENT_REQUIRED は版違い', () => {
    expect(classifyBootstrapFailure(apiError(409, 'TERMS_RECONSENT_REQUIRED'))).toEqual({ kind: 'termsMismatch' });
  });

  it('やり直せる失敗と、その文', () => {
    expect(classifyBootstrapFailure(apiError(503, 'TEMPORARILY_UNAVAILABLE'))).toEqual({
      kind: 'retryable',
      message: '一時的に利用できません。時間をおいて再試行してください',
    });
    expect(classifyBootstrapFailure(apiError(500, 'RESOURCE_EXHAUSTED'))).toEqual({
      kind: 'retryable',
      message: '一時的に利用できません。時間をおいて再試行してください',
    });
    expect(classifyBootstrapFailure(apiError(0, 'OFFLINE'))).toEqual({ kind: 'retryable', message: 'オフラインです。接続を確認してください' });
    for (const [status, code] of [
      [409, 'CONFLICT'],
      [0, 'NETWORK_ERROR'],
      [0, 'TIMEOUT'],
    ] as const) {
      expect(classifyBootstrapFailure(apiError(status, code))).toEqual({ kind: 'retryable', message: '登録できませんでした。もう一度お試しください' });
    }
  });

  it('それ以外（500 INTERNAL_ERROR・400 など）は other', () => {
    expect(classifyBootstrapFailure(apiError(500, 'INTERNAL_ERROR'))).toEqual({ kind: 'other' });
    expect(classifyBootstrapFailure(apiError(400, 'VALIDATION_ERROR'))).toEqual({ kind: 'other' });
    expect(classifyBootstrapFailure(new Error('x'))).toEqual({ kind: 'other' });
  });
});

describe('Google ログインの失敗（C-19）', () => {
  it('ポップアップを閉じた・選ばなかったときは文を出さない', () => {
    for (const code of ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled']) {
      expect(googleFailureOf({ code })).toBe('cancelled');
      expect(googleSignInMessage({ code }, 'fallback')).toBeNull();
    }
  });

  it('ポップアップが止められた・以前のメールとパスワードのアカウントが残っている・無効のアカウントは、それぞれの文', () => {
    expect(googleSignInMessage({ code: 'auth/popup-blocked' }, 'fallback')).toBe(GOOGLE_MESSAGES.popupBlocked);
    expect(googleSignInMessage({ code: 'auth/account-exists-with-different-credential' }, 'fallback')).toBe(GOOGLE_MESSAGES.otherMethod);
    expect(googleSignInMessage({ code: 'auth/user-disabled' }, 'fallback')).toBe(GOOGLE_MESSAGES.disabled);
  });

  it('通信の失敗など、そのほかは画面ごとの文（S-01「登録できませんでした…」・S-02「ログインできませんでした…」）', () => {
    for (const error of [{ code: 'auth/network-request-failed' }, { code: 'auth/internal-error' }, new Error('x'), null]) {
      expect(googleFailureOf(error)).toBe('failed');
      expect(googleSignInMessage(error, 'ログインできませんでした。もう一度お試しください')).toBe('ログインできませんでした。もう一度お試しください');
    }
  });

  it('本人確認で違うアカウントを選んだ（auth/user-mismatch）', () => {
    expect(googleFailureOf({ code: 'auth/user-mismatch' })).toBe('userMismatch');
  });
});
