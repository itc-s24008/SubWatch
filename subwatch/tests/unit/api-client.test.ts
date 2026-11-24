import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase-client', () => ({ getFirebaseAuth: () => ({ currentUser: null }) }));

import { ApiClientError, api, isGateError, onApiGate } from '@/lib/api-client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function errorBody(code: string) {
  return { data: null, error: { code, message: 'x' }, requestId: 'r' };
}

describe('isGateError（ゲートが反応するエラーは3つだけ）', () => {
  it.each([
    [401, 'UNAUTHENTICATED', true],
    [409, 'TERMS_RECONSENT_REQUIRED', true],
    [409, 'ACCOUNT_NOT_INITIALIZED', true],
    [401, 'REAUTH_REQUIRED', false],
    [503, 'TEMPORARILY_UNAVAILABLE', false],
    [409, 'CONFLICT', false],
    [409, 'DUPLICATE_CANDIDATE', false],
    [500, 'RESOURCE_EXHAUSTED', false],
    [0, 'OFFLINE', false],
  ])('%i %s → %s', (status, code, expected) => {
    expect(isGateError(new ApiClientError(status, code, 'x'))).toBe(expected);
  });
  it('ApiClientError でないものは false', () => {
    expect(isGateError(new Error('x'))).toBe(false);
    expect(isGateError(null)).toBe(false);
  });
});

describe('api() と onApiGate', () => {
  const gate = vi.fn();
  let off: () => void;
  beforeEach(() => {
    gate.mockClear();
    off = onApiGate(gate);
  });
  afterEach(() => {
    off();
    vi.unstubAllGlobals();
  });

  it('成功は data を返す。204 は undefined', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { data: { ok: true }, error: null, requestId: 'r' })));
    await expect(api('/api/x')).resolves.toEqual({ ok: true });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    await expect(api('/api/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('401 UNAUTHENTICATED では onApiGate を呼び、ApiClientError を投げる', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, errorBody('UNAUTHENTICATED'))));
    await expect(api('/api/x')).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(gate).toHaveBeenCalledWith({ status: 401, code: 'UNAUTHENTICATED', method: 'GET', path: '/api/x' });
  });

  it.each([
    [503, 'TEMPORARILY_UNAVAILABLE'],
    [401, 'REAUTH_REQUIRED'],
    [409, 'CONFLICT'],
  ])('%i %s では onApiGate を呼ばない（ブラウザはサインアウトしない）', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(status, errorBody(code))));
    await expect(api('/api/x')).rejects.toMatchObject({ status, code });
    expect(gate).not.toHaveBeenCalled();
  });

  it('bootstrap の 409 では onApiGate を呼ばない（401 は呼ぶ）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(409, errorBody('TERMS_RECONSENT_REQUIRED'))));
    await expect(api('/api/account/bootstrap', { method: 'POST', body: {} })).rejects.toBeInstanceOf(ApiClientError);
    expect(gate).not.toHaveBeenCalled();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, errorBody('UNAUTHENTICATED'))));
    await expect(api('/api/account/bootstrap', { method: 'POST', body: {} })).rejects.toBeInstanceOf(ApiClientError);
    expect(gate).toHaveBeenCalledTimes(1);
  });

  it('skipGate: true のときは onApiGate を呼ばない', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(409, errorBody('ACCOUNT_NOT_INITIALIZED'))));
    await expect(api('/api/push/subscribe', { method: 'DELETE', body: {}, skipGate: true })).rejects.toBeInstanceOf(ApiClientError);
    expect(gate).not.toHaveBeenCalled();
  });

  it('JSON でない応答は INTERNAL_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 502 })));
    await expect(api('/api/x')).rejects.toMatchObject({ status: 502, code: 'INTERNAL_ERROR' });
  });

  it('通信の失敗は status 0（NETWORK_ERROR）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('failed'))));
    await expect(api('/api/x')).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });

  it('timeoutMs の時間内に応答が無ければ status 0（TIMEOUT）', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      ),
    );
    const result = api('/api/account', { method: 'DELETE', body: { confirmation: 'DELETE' }, timeoutMs: 30_000 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(result).resolves.toMatchObject({ status: 0, code: 'TIMEOUT' });
    vi.useRealTimers();
  });
});
