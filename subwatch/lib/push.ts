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
// 詳細_F-06 の手順8〜9、API共通仕様 B26・B90・B96・B106、DB設計書 テーブルNo.3・3.補足設計 B16
//   pushSender：Cron（04-14）に渡す PushSender（11/25 の統合で、Cron の route がこれを使う）
//   createPushSender({ send?, store?, sleep?, now?, timeoutMs? })：送信関数・保存先・待ち・時刻・1端末の時間切れを差し替えた PushSender を作る
// PushSender が行うこと：その利用者の購読を読む → webPushDeliveredIds に無い端末へ送る（同時に最大10。1端末10秒で打ち切り。
//   5xx・429・時間切れ・通信エラーは1秒後に1回だけ再試行）→ 成功した端末はすぐ webPushDeliveredIds に足して保存 →
//   404/410 の購読を削除（401/403 は残してログ）→ 最後に webPushStatus・webPushSentAt・webPushLastErrorCode を保存 → PushResult を返す
// 送信の失敗では例外を投げない（PushResult で返す）。Firestore の保存の失敗は例外のまま（Cron が実行を failed にする）。
// ただし、保存のときに通知イベントが無い（NOT_FOUND。送信の間にアカウントが削除された）ときは、作り直さずに無視する
import webpush from 'web-push';
import { FieldValue } from 'firebase-admin/firestore';
import { isFirestoreNotFound } from '@/lib/errors';
import type { NotificationEvent, PushResult, PushSender, WebPushStatus } from '@/lib/types';

export const PUSH_SEND = {
  ttlSeconds: 86_400, // TTL（詳細_F-06 の 8-5）
  urgency: 'normal' as const,
  timeoutMs: 10_000, // 1端末あたり。送信を始めてから10秒で打ち切る（自分のタイマーで計る）
  retryDelayMs: 1_000, // 再試行は1秒後に1回だけ
  concurrency: 10, // 同時送信は最大10
} as const;

// Push の中身（詳細_F-06 の 8-5、要件定義書「共通ルール」の通知の文面）。title の先頭にサービス名を付ける
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  notificationId: string;
}
export function pushPayloadOf(event: Pick<NotificationEvent, 'serviceNameAtNotification' | 'title' | 'body' | 'subscriptionId' | 'notificationId'>): PushPayload {
  return {
    title: `${event.serviceNameAtNotification}：${event.title}`,
    body: event.body,
    url: `/subscriptions/${event.subscriptionId}`,
    notificationId: event.notificationId,
  };
}

// 送り先（webPushSubscriptions の1件のうち、送信に要る項目）
export interface PushTarget {
  webPushId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

// 送信関数：成功なら戻る。失敗は例外（HTTP の応答があれば statusCode を持つ。VAPID 鍵が無いときは VapidNotConfiguredError）
export type WebPushSend = (target: PushTarget, payload: string) => Promise<void>;

export class VapidNotConfiguredError extends Error {
  constructor() {
    super('VAPID の鍵が設定されていません');
    this.name = 'VapidNotConfiguredError';
  }
}

// 既定の送信関数（web-push）。VAPID の鍵と subject は環境変数から読む（無ければ送らずに VapidNotConfiguredError）
export const webPushSend: WebPushSend = async (target, payload) => {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? '';
  const subject = process.env.VAPID_SUBJECT ?? '';
  if (!publicKey || !privateKey || !subject) throw new VapidNotConfiguredError();
  await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, payload, {
    TTL: PUSH_SEND.ttlSeconds,
    urgency: PUSH_SEND.urgency,
    vapidDetails: { subject, publicKey, privateKey },
    timeout: PUSH_SEND.timeoutMs, // 通信が無い時間の上限（打ち切りは attempt のタイマーで行う）
  });
};

export interface PushSaveResult {
  status: Exclude<WebPushStatus, 'pending'>;
  deliveredIds: string[];
  sentAt: Date | null; // sent・partially_sent・failed は送信を終えた時刻、skipped は null
  lastErrorCode: string | null;
}

// 保存先（テストで差し替えられる）。既定は Firestore（adminDb）
export interface PushStore {
  listTargets(uid: string): Promise<PushTarget[]>;
  addDelivered(uid: string, notificationId: string, webPushId: string, at: Date): Promise<void>; // 成功した端末をすぐ足す
  deleteSubscription(uid: string, webPushId: string): Promise<void>; // 404/410
  // 最後の結果。保存するのは webPushStatus・webPushDeliveredIds・webPushSentAt・webPushLastErrorCode と updatedAt だけ（update）
  saveResult(uid: string, notificationId: string, result: PushSaveResult): Promise<void>;
}

// 通知イベントの update。無ければ（NOT_FOUND）作り直さずに無視する
async function updateEventIgnoringMissing(ref: FirebaseFirestore.DocumentReference, fields: Record<string, unknown>): Promise<void> {
  try {
    await ref.update(fields);
  } catch (error) {
    if (isFirestoreNotFound(error)) return;
    throw error;
  }
}

export function firestorePushStore(db: Firestore = adminDb()): PushStore {
  const userRef = (uid: string) => db.collection('users').doc(uid);
  return {
    async listTargets(uid) {
      const snapshot = await userRef(uid).collection('webPushSubscriptions').get();
      return snapshot.docs.map((doc) => ({
        webPushId: doc.id,
        endpoint: String(doc.get('endpoint') ?? ''),
        p256dh: String(doc.get('p256dh') ?? ''),
        auth: String(doc.get('auth') ?? ''),
      }));
    },
    async addDelivered(uid, notificationId, webPushId, at) {
      await updateEventIgnoringMissing(userRef(uid).collection('notificationEvents').doc(notificationId), {
        webPushDeliveredIds: FieldValue.arrayUnion(webPushId),
        updatedAt: Timestamp.fromDate(at),
      });
    },
    async deleteSubscription(uid, webPushId) {
      await userRef(uid).collection('webPushSubscriptions').doc(webPushId).delete();
    },
    async saveResult(uid, notificationId, result) {
      await updateEventIgnoringMissing(userRef(uid).collection('notificationEvents').doc(notificationId), {
        webPushStatus: result.status,
        webPushDeliveredIds: result.deliveredIds,
        webPushSentAt: result.sentAt ? Timestamp.fromDate(result.sentAt) : null,
        webPushLastErrorCode: result.lastErrorCode,
        updatedAt: Timestamp.fromDate(result.sentAt ?? new Date()),
      });
    },
  };
}

export interface CreatePushSenderOptions {
  send?: WebPushSend; // 送信関数（既定は web-push）
  store?: PushStore; // 保存先（既定は Firestore）
  sleep?: (ms: number) => Promise<void>; // 再試行の前の1秒（テストではすぐ戻す）
  now?: () => Date; // webPushSentAt の時刻
  timeoutMs?: number; // 1端末あたりの時間切れ（既定10秒）
}

type Attempt = { ok: true } | { ok: false; code: string; statusCode: number | null; retryable: boolean };

function statusCodeOf(error: unknown): number | null {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const code = (error as { statusCode: unknown }).statusCode;
    if (typeof code === 'number' && Number.isFinite(code)) return code;
  }
  return null;
}

// 失敗の分け方（詳細_F-06 の 8-3・8-4、DB設計書 テーブルNo.3 の webPushLastErrorCode）
//   HTTP の応答あり：その番号の文字列。5xx・429 は再試行する。401/403・404/410・そのほかの4xx は再試行しない
//   時間切れ：'timeout'（再試行する）。statusCode の無い通信エラー：'network_error'（再試行する）。VAPID 鍵の未設定：'vapid_not_configured'（再試行しない）
export function classifySendError(error: unknown): Exclude<Attempt, { ok: true }> {
  if (error instanceof VapidNotConfiguredError) return { ok: false, code: 'vapid_not_configured', statusCode: null, retryable: false };
  const statusCode = statusCodeOf(error);
  if (statusCode === null) return { ok: false, code: 'network_error', statusCode: null, retryable: true };
  return { ok: false, code: String(statusCode), statusCode, retryable: statusCode >= 500 || statusCode === 429 };
}

const TIMEOUT = Symbol('timeout');

export function createPushSender(options: CreatePushSenderOptions = {}): PushSender {
  const send = options.send ?? webPushSend;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? PUSH_SEND.timeoutMs;

  // 1回送る。送信を始めてから timeoutMs で打ち切る（web-push の timeout は通信が無い時間の上限なので、自分のタイマーで計る）
  async function attempt(target: PushTarget, payload: string): Promise<Attempt> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<typeof TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), timeoutMs);
    });
    try {
      const sending = Promise.resolve().then(() => send(target, payload));
      sending.catch(() => undefined); // 打ち切った後の失敗を拾う（未処理の Promise にしない）
      const result = await Promise.race([sending.then(() => 'sent' as const), expired]);
      if (result === TIMEOUT) return { ok: false, code: 'timeout', statusCode: null, retryable: true };
      return { ok: true };
    } catch (error) {
      return classifySendError(error);
    } finally {
      clearTimeout(timer);
    }
  }

  // 1端末：失敗が再試行できるものなら、1秒後に1回だけ再試行する
  async function sendToDevice(target: PushTarget, payload: string): Promise<Attempt> {
    const first = await attempt(target, payload);
    if (first.ok || !first.retryable) return first;
    await sleep(PUSH_SEND.retryDelayMs);
    return attempt(target, payload);
  }

  return async (uid: string, event: NotificationEvent): Promise<PushResult> => {
    const store = options.store ?? firestorePushStore();
    const delivered = [...event.webPushDeliveredIds]; // 渡された値を使う（読み直さない）
    const targets = (await store.listTargets(uid)).filter((t) => !delivered.includes(t.webPushId));
    const payload = JSON.stringify(pushPayloadOf(event));
    const failureCodes: string[] = []; // 失敗が分かった順
    let failures = 0;

    // 同時に最大10端末
    const queue = [...targets];
    async function worker(): Promise<void> {
      for (let target = queue.shift(); target; target = queue.shift()) {
        const result = await sendToDevice(target, payload);
        if (result.ok) {
          delivered.push(target.webPushId);
          await store.addDelivered(uid, event.notificationId, target.webPushId, now());
          continue;
        }
        failures += 1;
        failureCodes.push(result.code);
        if (result.statusCode === 404 || result.statusCode === 410) {
          await store.deleteSubscription(uid, target.webPushId);
        } else if (result.statusCode === 401 || result.statusCode === 403) {
          // 設定の誤り（鍵など）。購読は残す。出すのは code と HTTP ステータスだけ（endpoint・鍵・webPushId は出さない）
          console.error(JSON.stringify({ code: 'PUSH_CONFIG_ERROR', status: result.statusCode }));
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(PUSH_SEND.concurrency, queue.length) }, () => worker()));

    let status: PushResult['status'];
    if (targets.length === 0 && delivered.length === 0) status = 'skipped'; // 購読も、送り終えた端末も無い
    else if (failures === 0) status = 'sent';
    else if (delivered.length > 0) status = 'partially_sent';
    else status = 'failed';
    const lastErrorCode = failureCodes.length > 0 ? failureCodes[failureCodes.length - 1] : null;
    const sentAt = status === 'skipped' ? null : now();
    await store.saveResult(uid, event.notificationId, { status, deliveredIds: delivered, sentAt, lastErrorCode });
    return { status, deliveredIds: delivered, lastErrorCode };
  };
}

export const pushSender: PushSender = createPushSender();
