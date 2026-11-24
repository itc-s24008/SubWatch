// GET・PATCH・DELETE /api/subscriptions/:id。API一覧 No.6・No.8・No.9（04-07）
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { requireInitialized } from '@/lib/account';
import { requireAuth } from '@/lib/auth';
import { todayJST } from '@/lib/clock';
import { HttpError } from '@/lib/errors';
import { noContent, ok, readJsonBody, rejectUnknownKeys, withApi } from '@/lib/http';
import { deleteSubscription, findSubscription, toSubscriptionDto, updateSubscription } from '@/lib/subscriptions';
import type { SubscriptionResponse } from '@/lib/types';
import { UPDATE_KEYS, validateSubscriptionFields } from '@/lib/validation';

// 他人の ID・存在しない ID・形の違う ID は 404
export const GET = withApi<{ id: string }>(async (req, { params }) => {
  const user = await requireAuth(req);
  await requireInitialized(user.uid);
  const { id } = await params;
  const doc = await findSubscription(user.uid, id);
  const data: SubscriptionResponse = { subscription: toSubscriptionDto(doc) };
  return ok(data);
});

// 送られた項目だけを変える（confirmDuplicate は受け付けない。空のオブジェクトは 400）。nextBillingDate は計算し直す
export const PATCH = withApi<{ id: string }>(async (req, { params }) => {
  const user = await requireAuth(req); // 1
  await requireInitialized(user.uid); // 2・2b
  const { id } = await params;
  await findSubscription(user.uid, id); // 3. :id の形式と存在（transaction の中でもう一度読む）
  const body = await readJsonBody(req); // 4
  if (Object.keys(body).length === 0) throw new HttpError(400, 'VALIDATION_ERROR');
  rejectUnknownKeys(body, UPDATE_KEYS); // 5
  const { values, errors } = validateSubscriptionFields(body, 'update'); // 6
  if (errors.length > 0) throw new HttpError(400, errors[0].code, errors[0].message, { field: errors[0].field, details: errors });
  const today = todayJST();
  const doc = await updateSubscription(user.uid, id, values, { today }); // 7（項目の間の検証は transaction の中の最新の値で）と書き込み
  const data: SubscriptionResponse = { subscription: toSubscriptionDto(doc, today) };
  return ok(data);
});

// 204。2回目は 404。通知履歴は残す
export const DELETE = withApi<{ id: string }>(async (req, { params }) => {
  const user = await requireAuth(req);
  await requireInitialized(user.uid);
  const { id } = await params;
  await findSubscription(user.uid, id);
  await deleteSubscription(user.uid, id);
  return noContent();
});
