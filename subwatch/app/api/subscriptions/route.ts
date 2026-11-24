// GET /api/subscriptions（一覧）・POST /api/subscriptions（保存）。API一覧 No.5・No.7（04-07）
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { requireInitialized } from '@/lib/account';
import { requireAuth } from '@/lib/auth';
import { todayJST } from '@/lib/clock';
import { HttpError } from '@/lib/errors';
import { ok, readJsonBody, rejectUnknownKeys, withApi } from '@/lib/http';
import { createSubscription, listSubscriptions, toSubscriptionDto } from '@/lib/subscriptions';
import type { SubscriptionListDto, SubscriptionResponse } from '@/lib/types';
import { CREATE_KEYS, validateSubscriptionCrossFields, validateSubscriptionFields, type SubscriptionValues } from '@/lib/validation';

// 全件（最大200件）を作成日時の昇順で返す。nextBillingDate は毎回計算した値
export const GET = withApi(async (req) => {
  const user = await requireAuth(req);
  await requireInitialized(user.uid);
  const today = todayJST();
  const items = (await listSubscriptions(user.uid)).map((doc) => toSubscriptionDto(doc, today));
  const data: SubscriptionListDto = { items, totalCount: items.length };
  return ok(data);
});

export const POST = withApi(async (req) => {
  const user = await requireAuth(req); // 1. 認証
  await requireInitialized(user.uid); // 2・2b. users と規約の版
  const body = await readJsonBody(req); // 4. 本文
  rejectUnknownKeys(body, CREATE_KEYS); // 5. 未知のキー（nextBillingDate なども 400 UNKNOWN_FIELD）

  // 6. 項目ごとの検証（誤りを全部集める）
  const { values, errors } = validateSubscriptionFields(body, 'create');
  if (errors.length > 0) throw new HttpError(400, errors[0].code, errors[0].message, { field: errors[0].field, details: errors });
  const full = values as SubscriptionValues & { confirmDuplicate?: boolean };

  // 7. 項目の間の検証（6 で誤りが無いときだけ）
  const crossErrors = validateSubscriptionCrossFields(full);
  if (crossErrors.length > 0) {
    throw new HttpError(400, crossErrors[0].code, crossErrors[0].message, { field: crossErrors[0].field, details: crossErrors });
  }

  // 8〜10. transaction の中で同名の確認・件数の確認・書き込み
  const { confirmDuplicate, ...subscription } = full;
  const today = todayJST();
  const doc = await createSubscription(user.uid, subscription, confirmDuplicate === true, { today });
  const data: SubscriptionResponse = { subscription: toSubscriptionDto(doc, today) };
  return ok(data, 201);
});
