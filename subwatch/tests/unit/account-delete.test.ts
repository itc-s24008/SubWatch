// アカウント削除の判定と処理の順番（04-17。詳細_F-07、API共通仕様 B101〜B104、決まりの一覧 C-6・C-14）
// テスト一覧の No.37（5分を過ぎた。判定の関数に auth_time と now を渡す。Emulator では作らない。Date の差し替えも使わない）と、
// 番号なしの：auth_time の境目・本文の confirmation・削除の順番と後片づけの3回・画面の判定（lib/account-delete-flow.ts）・入口の形
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), back: vi.fn(), push: vi.fn() }) }));

import { DeleteAccount } from '@/components/DeleteAccount';
import {
  CLEANUP_ATTEMPTS,
  DELETE_ACCOUNT_KEYS,
  deleteAccount,
  isRecentAuth,
  requireRecentAuth,
  validateDeleteConfirmation,
} from '@/lib/account-delete';
import {
  DELETE_CONFIRMATION,
  DELETE_MESSAGES,
  DELETE_TIMEOUT_MS,
  deleteFailureOf,
  deleteResultOf,
  isDeleteConfirmationInput,
  reauthFailureOf,
} from '@/lib/account-delete-flow';
import { ApiClientError } from '@/lib/api-client';
import { HttpError } from '@/lib/errors';

const NOW = Date.UTC(2026, 10, 25, 3, 0, 0); // ミリ秒
const NOW_SEC = NOW / 1000;

describe('No.37 再認証から5分より後なら 401 REAUTH_REQUIRED（判定の関数に auth_time と now を渡す）', () => {
  it('No.37 auth_time が 5分1秒前なら通さず、requireRecentAuth は 401 REAUTH_REQUIRED「もう一度パスワードを入力してください」', () => {
    expect(isRecentAuth(NOW_SEC - 301, NOW)).toBe(false);
    let thrown: unknown;
    try {
      requireRecentAuth(NOW_SEC - 301, NOW);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HttpError);
    expect(thrown).toMatchObject({ status: 401, code: 'REAUTH_REQUIRED', message: 'もう一度パスワードを入力してください' });
  });

  it('No.37 1時間前でも 401 REAUTH_REQUIRED', () => {
    expect(() => requireRecentAuth(NOW_SEC - 3600, NOW)).toThrow(HttpError);
  });
});

describe('auth_time の境目（API共通仕様 B102。auth_time は秒、now はミリ秒）', () => {
  it('ちょうど300秒は通す。299秒も通す。300.001秒は通さない', () => {
    expect(isRecentAuth(NOW_SEC - 300, NOW)).toBe(true);
    expect(isRecentAuth(NOW_SEC - 299, NOW)).toBe(true);
    expect(isRecentAuth(NOW_SEC - 300, NOW + 1)).toBe(false);
    expect(() => requireRecentAuth(NOW_SEC - 300, NOW)).not.toThrow();
  });

  it('auth_time が now より未来でも通す', () => {
    expect(isRecentAuth(NOW_SEC + 120, NOW)).toBe(true);
  });

  it('auth_time が無い・数でないときは通さない', () => {
    for (const value of [undefined, null, '1700000000', Number.NaN, Number.POSITIVE_INFINITY, {}]) {
      expect(isRecentAuth(value, NOW)).toBe(false);
      expect(() => requireRecentAuth(value, NOW)).toThrow(HttpError);
    }
  });
});

describe('本文の confirmation（API共通仕様 B101）', () => {
  it("受け付けるキーは confirmation だけ。'DELETE' なら通す", () => {
    expect([...DELETE_ACCOUNT_KEYS]).toEqual(['confirmation']);
    expect(() => validateDeleteConfirmation({ confirmation: 'DELETE' })).not.toThrow();
  });

  it.each([['delete'], [' DELETE'], ['DELETE '], ['DELETE　'], [''], [1], [true], [null], [undefined]])(
    'confirmation が %j なら 400 VALIDATION_ERROR（field=confirmation、「入力内容を確認してください」）',
    (value) => {
      const body: Record<string, unknown> = value === undefined ? {} : { confirmation: value };
      expect(() => validateDeleteConfirmation(body)).toThrow(HttpError);
      try {
        validateDeleteConfirmation(body);
      } catch (error) {
        expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', message: '入力内容を確認してください', extras: { field: 'confirmation' } });
      }
    },
  );
});

// 削除の順番：データ → Auth → 後片づけ（差し替え口で、Firestore と Auth を使わずに確かめる）
function recorder() {
  const calls: string[] = [];
  const ok = (name: string) =>
    vi.fn(async () => {
      calls.push(name);
    });
  const fail = (name: string) =>
    vi.fn(async () => {
      calls.push(name);
      throw new Error(`${name} failed uid-should-not-leak`);
    });
  return { calls, ok, fail };
}

describe('deleteAccount の順番と失敗の扱い（詳細_F-07 の手順5〜7、API共通仕様 B103・B104）', () => {
  it('データ → Auth → 後片づけの順に1回ずつ呼び、{status:"deleted"} を返す', async () => {
    const r = recorder();
    const log = vi.fn();
    const result = await deleteAccount('uid-1', {
      deleteUserTree: r.ok('tree'),
      deleteAuthUser: r.ok('auth'),
      cleanupUserTree: r.ok('cleanup'),
      log,
    });
    expect(result).toEqual({ status: 'deleted' });
    expect(r.calls).toEqual(['tree', 'auth', 'cleanup']);
    expect(log).not.toHaveBeenCalled();
  });

  it('データの削除が失敗したら 500 DELETE_FAILED で、Auth を消さない（後片づけもしない）', async () => {
    const r = recorder();
    await expect(
      deleteAccount('uid-1', { deleteUserTree: r.fail('tree'), deleteAuthUser: r.ok('auth'), cleanupUserTree: r.ok('cleanup'), log: vi.fn() }),
    ).rejects.toMatchObject({ status: 500, code: 'DELETE_FAILED', message: '削除できませんでした。もう一度お試しください' });
    expect(r.calls).toEqual(['tree']);
  });

  it('Auth の削除が失敗したら 500 DELETE_FAILED（後片づけはしない）', async () => {
    const r = recorder();
    await expect(
      deleteAccount('uid-1', { deleteUserTree: r.ok('tree'), deleteAuthUser: r.fail('auth'), cleanupUserTree: r.ok('cleanup'), log: vi.fn() }),
    ).rejects.toMatchObject({ status: 500, code: 'DELETE_FAILED' });
    expect(r.calls).toEqual(['tree', 'auth']);
  });

  it('後片づけは3回まで行い、3回とも失敗しても成功を返す。ログは code DELETE_CLEANUP_FAILED だけ（uid は出さない）', async () => {
    const r = recorder();
    const log = vi.fn();
    const result = await deleteAccount('secret-uid-123', {
      deleteUserTree: r.ok('tree'),
      deleteAuthUser: r.ok('auth'),
      cleanupUserTree: r.fail('cleanup'),
      log,
    });
    expect(result).toEqual({ status: 'deleted' });
    expect(CLEANUP_ATTEMPTS).toBe(3);
    expect(r.calls).toEqual(['tree', 'auth', 'cleanup', 'cleanup', 'cleanup']);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toBe('{"code":"DELETE_CLEANUP_FAILED"}');
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-uid-123');
  });

  it('後片づけが2回失敗して3回目で成功したら、ログを出さない', async () => {
    let count = 0;
    const log = vi.fn();
    const cleanup = vi.fn(async () => {
      count += 1;
      if (count < 3) throw new Error('fail');
    });
    const result = await deleteAccount('uid-1', { deleteUserTree: vi.fn(async () => {}), deleteAuthUser: vi.fn(async () => {}), cleanupUserTree: cleanup, log });
    expect(result).toEqual({ status: 'deleted' });
    expect(cleanup).toHaveBeenCalledTimes(3);
    expect(log).not.toHaveBeenCalled();
  });

  it('後片づけが3回とも失敗したとき、既定のログ（console.error）にも code だけを出す', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await deleteAccount('secret-uid-456', {
        deleteUserTree: vi.fn(async () => {}),
        deleteAuthUser: vi.fn(async () => {}),
        cleanupUserTree: vi.fn(async () => {
          throw new Error('secret-uid-456');
        }),
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]).toEqual(['{"code":"DELETE_CLEANUP_FAILED"}']);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('画面の判定（lib/account-delete-flow.ts）', () => {
  it('①の入力は、前後の空白を除いて大文字の DELETE と完全一致したときだけ［次へ］を押せる', () => {
    for (const text of ['DELETE', ' DELETE ', '  DELETE', 'DELETE\n', '　DELETE　']) {
      expect(isDeleteConfirmationInput(text)).toBe(true);
    }
    for (const text of ['', 'delete', 'Delete', 'DELET', 'DELETE!', 'DE LETE', 'ＤＥＬＥＴＥ']) {
      expect(isDeleteConfirmationInput(text)).toBe(false);
    }
  });

  it("API に送るのは決まった文字列 'DELETE'。時間切れは30秒", () => {
    expect(DELETE_CONFIRMATION).toBe('DELETE');
    expect(DELETE_TIMEOUT_MS).toBe(30_000);
  });

  it('パスワード違いとして扱う Firebase の code（それ以外の再認証の失敗は削除の失敗と同じ表示）', () => {
    for (const code of ['auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/missing-password']) {
      expect(reauthFailureOf({ code })).toBe('wrongPassword');
    }
    for (const error of [{ code: 'auth/too-many-requests' }, { code: 'auth/network-request-failed' }, new Error('x'), null]) {
      expect(reauthFailureOf(error)).toBe('failed');
    }
  });

  it('送った後の status 0 は、OFFLINE・NETWORK_ERROR・TIMEOUT のどれでも「応答が届かない」', () => {
    for (const code of ['OFFLINE', 'NETWORK_ERROR', 'TIMEOUT']) {
      expect(deleteFailureOf(new ApiClientError(0, code, 'x'))).toBe('noResponse');
    }
  });

  it('401 REAUTH_REQUIRED はパスワードの再入力、401 UNAUTHENTICATED はゲート、そのほかの応答が届いた失敗（500・503 など）は「削除できませんでした…」', () => {
    expect(deleteFailureOf(new ApiClientError(401, 'REAUTH_REQUIRED', 'x'))).toBe('reauthRequired');
    expect(deleteFailureOf(new ApiClientError(401, 'UNAUTHENTICATED', 'x'))).toBe('gate');
    expect(deleteFailureOf(new ApiClientError(500, 'DELETE_FAILED', 'x'))).toBe('failed');
    expect(deleteFailureOf(new ApiClientError(503, 'TEMPORARILY_UNAVAILABLE', 'x'))).toBe('failed');
    expect(deleteFailureOf(new ApiClientError(500, 'RESOURCE_EXHAUSTED', 'x'))).toBe('failed');
    expect(deleteFailureOf(new ApiClientError(400, 'VALIDATION_ERROR', 'x'))).toBe('failed');
    expect(deleteFailureOf(new Error('x'))).toBe('failed');
  });

  it("200 でも {status:'deleted'} でない応答は失敗", () => {
    expect(deleteResultOf({ status: 'deleted' })).toBe('deleted');
    expect(deleteResultOf({ status: 'other' })).toBe('failed');
    expect(deleteResultOf(undefined)).toBe('failed');
    expect(deleteResultOf(null)).toBe('failed');
  });

  it('文は設計書のとおり', () => {
    expect(DELETE_MESSAGES.done).toBe('アカウントを削除しました。ご利用ありがとうございました');
    expect(DELETE_MESSAGES.failed).toBe('削除できませんでした。もう一度お試しください');
    expect(DELETE_MESSAGES.noResponse).toBe(
      '削除が完了したか確認できませんでした。もう一度ログインしてください（パスワードを確かめてもログインできなければ、削除は完了しています）',
    );
    expect(DELETE_MESSAGES.offline).toBe('オフラインです。接続を確認してください');
  });
});

describe('DeleteAccount の入口（props trigger・disabled）', () => {
  it("trigger を省略すると S-09 のボタン［アカウントを削除］", () => {
    const html = renderToStaticMarkup(createElement(DeleteAccount));
    expect(html).toMatch(/<button[^>]*>アカウントを削除<\/button>/);
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('<a ');
  });

  it("trigger='link' は、見た目がリンクの <button>「アカウントを削除する」（<a> にしない）", () => {
    const html = renderToStaticMarkup(createElement(DeleteAccount, { trigger: 'link' }));
    expect(html).toMatch(/<button type="button"[^>]*underline[^>]*>アカウントを削除する<\/button>/);
    expect(html).not.toContain('<a ');
  });

  it('disabled のときは入口を押せない', () => {
    expect(renderToStaticMarkup(createElement(DeleteAccount, { trigger: 'link', disabled: true }))).toMatch(/<button[^>]*disabled=""[^>]*>アカウントを削除する<\/button>/);
    expect(renderToStaticMarkup(createElement(DeleteAccount, { disabled: true }))).toMatch(/<button[^>]*disabled=""[^>]*>アカウントを削除<\/button>/);
  });
});
