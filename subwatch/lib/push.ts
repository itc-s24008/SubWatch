// Web Push（サーバー）。04-12：購読の検証・保存・解除（POST・DELETE /api/push/subscribe）。送信は 04-15 が足す
// 機能設計書 API一覧 No.12・13、API共通仕様 B23・B91、詳細_F-12 の手順6、DB設計書 テーブルNo.4・3.補足設計 B16・B17
import { createHash } from 'node:crypto';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { ERROR_MESSAGES, HttpError } from '@/lib/errors';
import { adminDb } from '@/lib/firebase-admin';
import type { ApiFieldError, PushSubscribeRequest, PushUnsubscribeRequest } from '@/lib/types';

// users/{uid}/webPushSubscriptions/{webPushId}（DB設計書 テーブルNo.4 の物理名）
export interface WebPushSubscriptionDoc {
  webPushId: string; // sha256(endpoint)。小文字16進64文字
  uid: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  createdAt: Timestamp;
  lastSeenAt: Timestamp | null;
}

export const PUSH_SUBSCRIBE_KEYS = ['endpoint', 'keys', 'userAgent'] as const;
export const PUSH_SUBSCRIBE_KEYS_KEYS = ['p256dh', 'auth'] as const; // keys の中で受け付けるキー
export const PUSH_UNSUBSCRIBE_KEYS = ['endpoint'] as const;
export const PUSH_LIMITS = {
  maxDevices: 10, // 1人あたりの端末の上限
  endpointMaxBytes: 1499, // UTF-8 のバイト数（Firestore が検索の値に使える文字列の上限は1500バイト未満）
  keyMaxLength: 512, // p256dh・auth は1〜512文字
  userAgentMaxLength: 512, // 512文字以内
} as const;

// webPushId＝endpoint の文字列を加工せずに SHA-256 にかけた値（小文字16進。DB設計書 テーブルNo.4 の webPushId）
export function webPushIdOf(endpoint: string): string {
  return createHash('sha256').update(endpoint, 'utf8').digest('hex');
}

// 文字数はコードポイントで数える（04-07 の文字数と同じ数え方）
function lengthOf(value: string): number {
  return Array.from(value).length;
}

// 内部のホストとみなす名前の終わり（API共通仕様 B91）
const INTERNAL_SUFFIXES = ['.local', '.internal', '.intranet', '.lan', '.home', '.corp', '.localdomain'];

// endpoint を受け付けるか（API共通仕様 B23・B91）：https のみ。IPアドレス（IPv4・IPv6・数字だけのホスト）、localhost・*.localhost、
// ドットを含まないホスト名、*.local など内部の名前、URL 内の認証情報、UTF-8 で1499バイト超は受け付けない
export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length === 0) return false;
  if (Buffer.byteLength(endpoint, 'utf8') > PUSH_LIMITS.endpointMaxBytes) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '') return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, ''); // 末尾のドット（example.com.）は除いて調べる
  if (host === '') return false;
  if (host.startsWith('[') || host.includes(':')) return false; // IPv6
  if (/^[0-9.]+$/.test(host)) return false; // IPv4・数字だけのホスト（URL が 0x7f.1 などを 127.0.0.1 に直した後も含む）
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (!host.includes('.')) return false;
  if (INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// 未知のキー（API共通仕様 B91）：本文の上のキーと keys の中のキーをまとめて details に入れる（field は「keys.名前」）。
// 順は本文の順（keys の中のものは keys の位置）
export function rejectUnknownPushKeys(body: Record<string, unknown>): void {
  const allowed = new Set<string>(PUSH_SUBSCRIBE_KEYS);
  const allowedKeys = new Set<string>(PUSH_SUBSCRIBE_KEYS_KEYS);
  const unknown: string[] = [];
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) unknown.push(key);
    else if (key === 'keys' && isPlainObject(body.keys)) {
      for (const inner of Object.keys(body.keys)) if (!allowedKeys.has(inner)) unknown.push(`keys.${inner}`);
    }
  }
  if (unknown.length === 0) return;
  const details: ApiFieldError[] = unknown.map((field) => ({ field, code: 'UNKNOWN_FIELD', message: ERROR_MESSAGES.UNKNOWN_FIELD }));
  throw new HttpError(400, 'UNKNOWN_FIELD', undefined, { field: details[0].field, details });
}

// POST /api/push/subscribe の項目の検証（API共通仕様 B91）。誤りは 400 VALIDATION_ERROR、details は
// endpoint → keys（オブジェクトでないとき）→ keys.p256dh → keys.auth → userAgent の順、message は「入力内容を確認してください」
// userAgent の null・空文字・省略は null にする
export function validatePushSubscribeBody(body: Record<string, unknown>): PushSubscribeRequest & { userAgent: string | null } {
  const message = ERROR_MESSAGES.VALIDATION_ERROR;
  const details: ApiFieldError[] = [];
  const add = (field: string) => details.push({ field, code: 'VALIDATION_ERROR', message });

  const endpoint = body.endpoint;
  if (typeof endpoint !== 'string' || !isAllowedPushEndpoint(endpoint)) add('endpoint');

  const keys = body.keys;
  let p256dh: unknown;
  let auth: unknown;
  if (!isPlainObject(keys)) {
    add('keys');
  } else {
    p256dh = keys.p256dh;
    auth = keys.auth;
    const okKey = (v: unknown) => typeof v === 'string' && lengthOf(v) >= 1 && lengthOf(v) <= PUSH_LIMITS.keyMaxLength;
    if (!okKey(p256dh)) add('keys.p256dh');
    if (!okKey(auth)) add('keys.auth');
  }

  const rawUserAgent = body.userAgent;
  let userAgent: string | null = null;
  if (rawUserAgent === undefined || rawUserAgent === null || rawUserAgent === '') {
    userAgent = null;
  } else if (typeof rawUserAgent === 'string' && lengthOf(rawUserAgent) <= PUSH_LIMITS.userAgentMaxLength) {
    userAgent = rawUserAgent;
  } else {
    add('userAgent');
  }

  if (details.length > 0) throw new HttpError(400, 'VALIDATION_ERROR', message, { field: details[0].field, details });
  return { endpoint: endpoint as string, keys: { p256dh: p256dh as string, auth: auth as string }, userAgent };
}

// DELETE /api/push/subscribe の本文の検証（API共通仕様 B23）：endpoint が無い・文字列でない・空文字は 400 VALIDATION_ERROR（field=endpoint）。
// https かどうかなどは調べない
export function validatePushUnsubscribeBody(body: Record<string, unknown>): PushUnsubscribeRequest {
  const endpoint = body.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length === 0) {
    const message = ERROR_MESSAGES.VALIDATION_ERROR;
    throw new HttpError(400, 'VALIDATION_ERROR', message, {
      field: 'endpoint',
      details: [{ field: 'endpoint', code: 'VALIDATION_ERROR', message }],
    });
  }
  return { endpoint };
}

export interface PushStoreOptions {
  db?: Firestore; // テスト用の差し替え口
  now?: () => Timestamp; // テスト用の差し替え口（createdAt・lastSeenAt の時刻）
}

function millisOf(value: unknown): number {
  return value instanceof Timestamp ? value.toMillis() : Number.NEGATIVE_INFINITY; // lastSeenAt が無いものは最も古い扱い
}

// 購読を保存する（API共通仕様 B23、詳細_F-12 の手順6-4）。1つの transaction の中で：
//   users/{uid} を読む（無ければ 409 ACCOUNT_NOT_INITIALIZED。保存しない）→ ほかの uid の同じ endpoint を探して消す →
//   同じ endpoint（同じ webPushId）があれば上書き（createdAt は変えず、p256dh・auth・userAgent・lastSeenAt を新しくする。件数の掃除はしない）→
//   無ければ、件数が10件以上のとき9件になるまで lastSeenAt の古い順（無いものが先、同じときは webPushId の昇順）に消してから作る
export async function savePushSubscription(
  uid: string,
  input: { endpoint: string; keys: { p256dh: string; auth: string }; userAgent: string | null },
  options: PushStoreOptions = {},
): Promise<{ webPushId: string }> {
  const db = options.db ?? adminDb();
  const now = options.now ? options.now() : Timestamp.now();
  const webPushId = webPushIdOf(input.endpoint);
  const userRef = db.collection('users').doc(uid);
  const mine = userRef.collection('webPushSubscriptions');
  const ref = mine.doc(webPushId);

  await db.runTransaction(async (tx) => {
    // 読み取り（transaction の読み取りは書き込みより先）
    const userSnapshot = await tx.get(userRef);
    const sameEndpoint = await tx.get(db.collectionGroup('webPushSubscriptions').where('endpoint', '==', input.endpoint));
    const ownSnapshot = await tx.get(mine);
    if (!userSnapshot.exists) throw new HttpError(409, 'ACCOUNT_NOT_INITIALIZED');

    // ほかの uid に同じ endpoint があれば消す（No.48）
    for (const doc of sameEndpoint.docs) {
      if (doc.ref.parent.parent?.id !== uid) tx.delete(doc.ref);
    }

    const existing = ownSnapshot.docs.find((doc) => doc.id === webPushId);
    if (existing) {
      tx.update(ref, { p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: input.userAgent, lastSeenAt: now });
      return;
    }

    // 新しい端末：10件以上なら9件になるまで古い順に消す（ふつうは11台目の登録で最も古い1件。No.74）
    const keep = PUSH_LIMITS.maxDevices - 1;
    if (ownSnapshot.size > keep) {
      const ordered = [...ownSnapshot.docs].sort((a, b) => {
        const diff = millisOf(a.get('lastSeenAt')) - millisOf(b.get('lastSeenAt'));
        if (diff !== 0) return diff;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
      for (const doc of ordered.slice(0, ownSnapshot.size - keep)) tx.delete(doc.ref);
    }
    const doc: WebPushSubscriptionDoc = {
      webPushId,
      uid,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: input.userAgent,
      createdAt: now,
      lastSeenAt: now,
    };
    tx.set(ref, doc);
  });
  return { webPushId };
}

// この端末の購読だけを消す（API一覧 No.13）。対象が無くても成功（users の確認は route が requireInitialized で行う）
export async function deletePushSubscription(uid: string, endpoint: string, options: { db?: Firestore } = {}): Promise<void> {
  const db = options.db ?? adminDb();
  await db.collection('users').doc(uid).collection('webPushSubscriptions').doc(webPushIdOf(endpoint)).delete();
}

// ===== 04-15：Push の送信（PushSender）ここに足す =====
