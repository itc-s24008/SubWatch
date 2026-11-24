// lib/auth-flow.ts（S-01・S-02 の文と判定。04-05）の単体テスト
import { describe, expect, it } from 'vitest';
import { ApiClientError } from '@/lib/api-client';
import {
  AUTH_MESSAGES,
  classifyBootstrapFailure,
  hasErrors,
  loginFailureMessage,
  resetResultOf,
  signUpFailure,
  validateRegisterInput,
} from '@/lib/auth-flow';

function apiError(status: number, code: string): ApiClientError {
  return new ApiClientError(status, code, 'x');
}

describe('validateRegisterInput（S-01 ①〜③）', () => {
  it('正しい入力なら誤りなし', () => {
    const errors = validateRegisterInput({ email: 'a@example.com', emailValid: true, password: 'password', passwordConfirm: 'password' });
    expect(hasErrors(errors)).toBe(false);
  });

  it('No.16 パスワード7文字は「パスワードは8文字以上で入力してください」（8文字は通る。C-16）', () => {
    expect(validateRegisterInput({ email: 'a@example.com', emailValid: true, password: '1234567', passwordConfirm: '1234567' }).password).toBe(
      AUTH_MESSAGES.passwordTooShort,
    );
    expect(validateRegisterInput({ email: 'a@example.com', emailValid: true, password: '12345678', passwordConfirm: '12345678' }).password).toBeUndefined();
  });

  it('空・入力欄が形式違いと判定したメールは「メールアドレスの形式が正しくありません」。不一致は「パスワードが一致しません」', () => {
    const errors = validateRegisterInput({ email: '', emailValid: true, password: 'password', passwordConfirm: 'passwordX' });
    expect(errors).toEqual({ email: AUTH_MESSAGES.emailInvalid, passwordConfirm: AUTH_MESSAGES.passwordMismatch });
    expect(validateRegisterInput({ email: 'abc', emailValid: false, password: 'password', passwordConfirm: 'password' }).email).toBe(
      AUTH_MESSAGES.emailInvalid,
    );
  });
});

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

describe('Firebase のエラーの文', () => {
  it('ログインの失敗：認証の誤りは1つの文（どちらが違うかは示さない）、通信の失敗は別の文', () => {
    for (const code of ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email']) {
      expect(loginFailureMessage({ code })).toBe('メールアドレスまたはパスワードが正しくありません');
    }
    expect(loginFailureMessage({ code: 'auth/network-request-failed' })).toBe('ログインできませんでした。もう一度お試しください');
  });

  it('ユーザーの作成の失敗：登録済み・形式違い・通信の失敗', () => {
    expect(signUpFailure({ code: 'auth/email-already-in-use' })).toEqual({
      field: 'email',
      message: 'このメールアドレスはすでに登録されています',
      emailInUse: true,
    });
    expect(signUpFailure({ code: 'auth/invalid-email' })).toEqual({ field: 'email', message: 'メールアドレスの形式が正しくありません' });
    expect(signUpFailure({ code: 'auth/network-request-failed' })).toEqual({ message: '登録できませんでした。もう一度お試しください' });
  });

  it('No.69 再設定：Auth に無いメール（auth/user-not-found）でも「送った」と同じ扱い', () => {
    expect(resetResultOf(null)).toBe('sent');
    expect(resetResultOf({ code: 'auth/user-not-found' })).toBe('sent');
    expect(resetResultOf({ code: 'auth/invalid-email' })).toBe('invalidEmail');
    expect(resetResultOf({ code: 'auth/network-request-failed' })).toBe('failed');
  });
});
