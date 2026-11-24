// /api/push/subscribe（04-12。API一覧 No.12・13、API共通仕様 B6・B23・B91）
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { requireInitialized } from '@/lib/account';
import { requireAuth } from '@/lib/auth';
import { noContent, ok, readJsonBody, rejectUnknownKeys, withApi } from '@/lib/http';
import {
  PUSH_UNSUBSCRIBE_KEYS,
  deletePushSubscription,
  rejectUnknownPushKeys,
  savePushSubscription,
  validatePushSubscribeBody,
  validatePushUnsubscribeBody,
} from '@/lib/push';
import type { PushSubscribeResult } from '@/lib/types';

// POST：1. 認証 → 2. users と規約の版 → 4. 本文 → 5. 未知のキー（keys の中も）→ 6. 項目の検証 → 保存（users/{uid} を読む transaction）→ 200 {enabled:true}
export const POST = withApi(async (req) => {
  const user = await requireAuth(req);
  await requireInitialized(user.uid);
  const body = await readJsonBody(req);
  rejectUnknownPushKeys(body);
  const input = validatePushSubscribeBody(body);
  await savePushSubscription(user.uid, input);
  const result: PushSubscribeResult = { enabled: true };
  return ok(result);
});

// DELETE：1. 認証 → 2. users だけ（規約の版は調べない。版が古い人もログアウトで解除できるように）→ 4. 本文 → 5. 未知のキー →
// endpoint の必須の検証 → この端末の購読だけを消す（無くても 204）
export const DELETE = withApi(async (req) => {
  const user = await requireAuth(req);
  await requireInitialized(user.uid, { checkTerms: false });
  const body = await readJsonBody(req);
  rejectUnknownKeys(body, PUSH_UNSUBSCRIBE_KEYS);
  const { endpoint } = validatePushUnsubscribeBody(body);
  await deletePushSubscription(user.uid, endpoint);
  return noContent();
});
