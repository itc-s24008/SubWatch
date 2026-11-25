import { describe, expect, it, vi } from 'vitest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { HttpError } from '@/lib/errors';
import { requireAuth, type VerifyIdToken } from '@/lib/auth';

function request(authorization?: string): Request {
  return new Request('http://localhost/api/x', { headers: authorization ? { Authorization: authorization } : {} });
}
function failing(code: string): VerifyIdToken {
  return vi.fn(async () => {
    throw Object.assign(new Error(code), { code });
  });
}

describe('No.63 requireAuth の 401 と 503 の分け方（サーバーの部分）', () => {
  it('token が無い・Bearer でないときは、verifyIdToken を呼ばずに 401 UNAUTHENTICATED', async () => {
    const verify = vi.fn() as unknown as VerifyIdToken;
    for (const header of [undefined, 'Basic abc', 'Bearer ', 'bearer abc']) {
      await expect(requireAuth(request(header), { verifyIdToken: verify })).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    }
    expect(verify).not.toHaveBeenCalled();
  });

  it.each(['auth/argument-error', 'auth/id-token-expired', 'auth/id-token-revoked', 'auth/user-not-found', 'auth/user-disabled'])(
    '%s は 401 UNAUTHENTICATED',
    async (code) => {
      await expect(requireAuth(request('Bearer t'), { verifyIdToken: failing(code) })).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    },
  );

  it.each(['auth/internal-error', 'auth/network-request-failed', 'app/network-error'])('%s（Auth の障害）は 503 TEMPORARILY_UNAVAILABLE', async (code) => {
    await expect(requireAuth(request('Bearer t'), { verifyIdToken: failing(code) })).rejects.toMatchObject({
      status: 503,
      code: 'TEMPORARILY_UNAVAILABLE',
    });
  });

  it('code の無い失敗（通信の失敗など）も 503', async () => {
    const verify: VerifyIdToken = async () => {
      throw new TypeError('fetch failed');
    };
    const error = await requireAuth(request('Bearer t'), { verifyIdToken: verify }).catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 503, code: 'TEMPORARILY_UNAVAILABLE' });
  });

  it('成功したら uid・email・authTime を返し、checkRevoked を渡す', async () => {
    const verify = vi.fn(async () => ({ uid: 'u1', email: 'a@example.com', auth_time: 1700000000, firebase: { sign_in_provider: 'google.com' } }) as unknown as DecodedIdToken);
    await expect(requireAuth(request('Bearer t'), { checkRevoked: true, verifyIdToken: verify })).resolves.toEqual({
      uid: 'u1',
      email: 'a@example.com',
      authTime: 1700000000,
    });
    expect(verify).toHaveBeenCalledWith('t', true);
  });

  it('email クレームが無ければ空文字', async () => {
    const verify: VerifyIdToken = async () => ({ uid: 'u1', auth_time: 1, firebase: { sign_in_provider: 'google.com' } }) as unknown as DecodedIdToken;
    await expect(requireAuth(request('Bearer t'), { verifyIdToken: verify })).resolves.toMatchObject({ email: '' });
  });

  it.each(['password', 'anonymous', 'custom', undefined])('Google 以外でログインした token（sign_in_provider が %s）は 401 UNAUTHENTICATED（C-19）', async (provider) => {
    const verify: VerifyIdToken = async () =>
      ({ uid: 'u1', email: 'a@example.com', auth_time: 1, firebase: provider === undefined ? undefined : { sign_in_provider: provider } }) as unknown as DecodedIdToken;
    await expect(requireAuth(request('Bearer t'), { verifyIdToken: verify })).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  });
});
