// 土台の確認：テスト用の route を共通部品（withApi・requireAuth・requireInitialized・readJsonBody・rejectUnknownKeys）で作り、
// 200・401・409・未知のキーの 400 になることを確かめる（共通部品が壊れていたら落ちる）
import { beforeEach, describe, expect, it } from 'vitest';
import { requireInitialized } from '@/lib/account';
import { requireAuth } from '@/lib/auth';
import { HttpError } from '@/lib/errors';
import { ok, readJsonBody, rejectUnknownKeys, withApi } from '@/lib/http';
import { callRoute, resetEmulators, seedUser, signUp, signUpUser, uidOf } from './helpers';

const POST = withApi(async (req) => {
  const user = await requireAuth(req);
  const account = await requireInitialized(user.uid);
  const body = await readJsonBody(req);
  rejectUnknownKeys(body, ['name']);
  return ok({ uid: user.uid, email: account.email, name: body.name }, 201);
});

const GET_THROWS = withApi(async () => {
  throw Object.assign(new Error('aborted'), { code: 10 });
});

beforeEach(async () => {
  await resetEmulators();
});

describe('土台の確認（共通部品）', () => {
  it('ログインして users があれば 200 台の応答で、data・error・requestId の形', async () => {
    const user = await signUpUser();
    await seedUser(user.uid, { email: user.email });
    const res = await callRoute(POST, { method: 'POST', token: user.token, body: { name: 'a' } });
    expect(res.status).toBe(201);
    expect(res.body?.data).toEqual({ uid: user.uid, email: user.email, name: 'a' });
    expect(res.body?.error).toBeNull();
    expect(res.body?.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('token が無ければ 401 UNAUTHENTICATED', async () => {
    const res = await callRoute(POST, { method: 'POST', body: { name: 'a' } });
    expect(res.status).toBe(401);
    expect(res.body?.error).toMatchObject({ code: 'UNAUTHENTICATED', message: 'ログインしてください' });
    expect(res.body?.data).toBeNull();
  });

  it('形の違う token は 401 UNAUTHENTICATED', async () => {
    const res = await callRoute(POST, { method: 'POST', token: 'not-a-token', body: { name: 'a' } });
    expect(res.status).toBe(401);
    expect(res.body?.error.code).toBe('UNAUTHENTICATED');
  });

  it('users が無ければ 409 ACCOUNT_NOT_INITIALIZED', async () => {
    const token = await signUp();
    const res = await callRoute(POST, { method: 'POST', token, body: { name: 'a' } });
    expect(res.status).toBe(409);
    expect(res.body?.error.code).toBe('ACCOUNT_NOT_INITIALIZED');
  });

  it('保存された規約の版が現行と違えば 409 TERMS_RECONSENT_REQUIRED', async () => {
    const token = await signUp();
    await seedUser(uidOf(token), { termsVersion: '2000-01-01' });
    const res = await callRoute(POST, { method: 'POST', token, body: { name: 'a' } });
    expect(res.status).toBe(409);
    expect(res.body?.error.code).toBe('TERMS_RECONSENT_REQUIRED');
  });

  it('未知のキーは 400 UNKNOWN_FIELD（すべて details に入れ、field は本文の順で最初のキー）', async () => {
    const token = await signUp();
    await seedUser(uidOf(token));
    const res = await callRoute(POST, { method: 'POST', token, body: { name: 'a', zzz: 1, nextBillingDate: '2026-11-04' } });
    expect(res.status).toBe(400);
    expect(res.body?.error).toMatchObject({ code: 'UNKNOWN_FIELD', field: 'zzz' });
    expect(res.body?.error.details.map((d: { field: string }) => d.field)).toEqual(['zzz', 'nextBillingDate']);
  });

  it('Content-Type が JSON でない・JSON でない・空・配列は 400 VALIDATION_ERROR', async () => {
    const token = await signUp();
    await seedUser(uidOf(token));
    const cases: { rawBody: string; headers: Record<string, string> }[] = [
      { rawBody: '{"name":"a"}', headers: { 'Content-Type': 'text/plain' } },
      { rawBody: '{name', headers: { 'Content-Type': 'application/json' } },
      { rawBody: '', headers: { 'Content-Type': 'application/json' } },
      { rawBody: '[1]', headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    ];
    for (const c of cases) {
      const res = await callRoute(POST, { method: 'POST', token, ...c });
      expect(res.status).toBe(400);
      expect(res.body?.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('100KB を超える本文は 400「入力内容が大きすぎます」', async () => {
    const token = await signUp();
    await seedUser(uidOf(token));
    const res = await callRoute(POST, { method: 'POST', token, body: { name: 'a'.repeat(100 * 1024) } });
    expect(res.status).toBe(400);
    expect(res.body?.error).toMatchObject({ code: 'VALIDATION_ERROR', message: '入力内容が大きすぎます' });
  });

  it('Firestore のエラー（ABORTED）は withApi が 409 CONFLICT に変える。HttpError はそのまま', async () => {
    const res = await callRoute(GET_THROWS);
    expect(res.status).toBe(409);
    expect(res.body?.error.code).toBe('CONFLICT');
    const THROWS_HTTP = withApi(async () => {
      throw new HttpError(404, 'NOT_FOUND', 'サブスクが見つかりません');
    });
    const notFound = await callRoute(THROWS_HTTP);
    expect(notFound).toMatchObject({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'サブスクが見つかりません' } } });
  });
});
