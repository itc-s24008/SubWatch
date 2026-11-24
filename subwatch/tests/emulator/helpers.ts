// API のテストの道具（Auth と Firestore の Emulator。project は demo-subwatch）
// みんなが足すファイル：自分の見出し（// ===== 04-xx：… =====）の下に足す。ほかの人の行と、先頭の import は変えない
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import type { RouteContext } from '@/lib/http';

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'demo-subwatch';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

let counter = 0;

// Auth Emulator にユーザーを作る。→ { uid, email, password, token }（token は ID token）
export async function signUpUser(): Promise<{ uid: string; email: string; password: string; token: string }> {
  counter += 1;
  const email = `user${Date.now()}${counter}@example.com`;
  const password = 'password1234';
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!res.ok) throw new Error(`Auth Emulator の signUp に失敗しました（${res.status}）`);
  const json = (await res.json()) as { localId: string; idToken: string };
  return { uid: json.localId, email, password, token: json.idToken };
}

// ユーザーを作り、ID token だけを返す
export async function signUp(): Promise<string> {
  return (await signUpUser()).token;
}

// ID token から uid を取り出す（署名は確かめない。テスト用）
export function uidOf(token: string): string {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { user_id?: string; sub?: string };
  const uid = payload.user_id ?? payload.sub;
  if (!uid) throw new Error('token に uid がありません');
  return uid;
}

export interface CallRouteOptions {
  method?: string; // 既定 'GET'
  token?: string; // あれば Authorization: Bearer <token>
  body?: unknown; // JSON にして送る（Content-Type: application/json を付ける）
  rawBody?: string; // そのまま送る（JSON でない本文のテスト用。Content-Type は headers で決める）
  params?: Record<string, string>; // :id など（route の第2引数の params）
  path?: string; // 既定 '/api/test'（クエリを付けてよい）
  headers?: Record<string, string>; // 足すヘッダー（同じ名前は上書き）
}

type AnyRoute = (req: Request, ctx: RouteContext<any>) => Promise<Response>; // eslint-disable-line @typescript-eslint/no-explicit-any

// route handler を直接呼ぶ。→ { status, body }（body は { data, error, requestId }。値は body.data。204 のときは null）
export async function callRoute(
  handler: AnyRoute,
  options: CallRouteOptions = {},
): Promise<{ status: number; body: { data: any; error: any; requestId: string } | null }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  Object.assign(headers, options.headers ?? {});
  const method = options.method ?? 'GET';
  const body = options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined);
  const req = new Request(`http://localhost${options.path ?? '/api/test'}`, { method, headers, body });
  const res = await handler(req, { params: Promise.resolve(options.params ?? {}) });
  const text = res.status === 204 ? '' : await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// users/{uid} を作る（bootstrap を通さない）。fields で項目を上書きできる。規約の版の既定は環境変数の現行の版
export async function seedUser(uid: string, fields: Record<string, unknown> = {}): Promise<void> {
  const now = Timestamp.now();
  const termsVersion = process.env.NEXT_PUBLIC_TERMS_VERSION ?? '';
  const privacyVersion = process.env.NEXT_PUBLIC_PRIVACY_VERSION ?? '';
  await adminDb()
    .collection('users')
    .doc(uid)
    .set({
      uid,
      email: `${uid}@example.com`,
      subscriptionCount: 0,
      accountNotificationEnabled: true,
      termsAcceptedAt: now,
      termsVersion,
      privacyVersion,
      consentHistory: [{ termsVersion, privacyVersion, acceptedAt: now, kind: 'create' }],
      createdAt: now,
      updatedAt: now,
      ...fields,
    });
}

// Emulator のデータを全部消す（Firestore のドキュメントと Auth のユーザー）
export async function resetEmulators(): Promise<void> {
  const firestore = await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' });
  if (!firestore.ok) throw new Error(`Firestore Emulator のリセットに失敗しました（${firestore.status}）`);
  const auth = await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE' });
  if (!auth.ok) throw new Error(`Auth Emulator のリセットに失敗しました（${auth.status}）`);
}

// ===== 04-07：seedSubscriptions・TEST_DATA_SUBSCRIPTIONS ここに足す =====
import type { SubscriptionDoc } from '@/lib/types';

// テストデータの5件（機能設計書「テストデータ」。基準日 2026-11-04。登録の順は配列の順で、いちばん上がいちばん古い）
// カテゴリーは画面設計書「サンプルデータ」のとおり。nextBillingDate は基準日 2026-11-04 の値
export const TEST_DATA_SUBSCRIPTIONS: Partial<SubscriptionDoc>[] = [
  { serviceName: 'Netflix', price: 1590, billingCycle: 'monthly', firstBillingDate: '2026-10-08', billingDayMode: 'fixedDay', category: 'video', nextBillingDate: '2026-11-08', websiteUrl: 'https://www.netflix.com' },
  { serviceName: 'Spotify', price: 980, billingCycle: 'monthly', firstBillingDate: '2026-09-05', billingDayMode: 'fixedDay', category: 'music', nextBillingDate: '2026-11-05' },
  { serviceName: 'Adobe Creative Cloud', price: 6480, billingCycle: 'monthly', firstBillingDate: '2026-10-11', billingDayMode: 'fixedDay', category: 'cloud', nextBillingDate: '2026-11-11' },
  { serviceName: 'iCloud+', price: 12000, billingCycle: 'yearly', firstBillingDate: '2025-12-01', billingDayMode: 'fixedDay', category: 'cloud', nextBillingDate: '2026-12-01' },
  { serviceName: 'ChatGPT', price: 3000, billingCycle: 'monthly', firstBillingDate: '2026-11-30', billingDayMode: 'endOfMonth', category: 'ai', nextBillingDate: '2026-11-30', trialEnabled: true, trialEndDate: '2026-11-10' },
];

// サブスクを Firestore に直接置く（API を通さない。users は作らない）。書かなかった項目は既定の値
// （料金 1000・毎月・請求日 2026-11-04・fixedDay・その他・任意の項目は null・trialEnabled false・通知 true）。
// 作成日時は渡した順に1ミリ秒ずつ進め、並びを決める。置いたドキュメント（保存の形）を、渡した順で返す
export async function seedSubscriptions(uid: string, items: Partial<SubscriptionDoc>[]): Promise<SubscriptionDoc[]> {
  const collection = adminDb().collection('users').doc(uid).collection('subscriptions');
  const base = Date.now();
  const docs: SubscriptionDoc[] = [];
  const batch = adminDb().batch();
  items.forEach((item, index) => {
    const ref = item.subscriptionId ? collection.doc(item.subscriptionId) : collection.doc();
    const createdAt = Timestamp.fromMillis(base + index);
    const doc: SubscriptionDoc = {
      subscriptionId: ref.id,
      uid,
      serviceName: 'テストのサブスク',
      planName: null,
      price: 1000,
      billingCycle: 'monthly',
      firstBillingDate: '2026-11-04',
      nextBillingDate: item.firstBillingDate ?? '2026-11-04',
      billingDayMode: 'fixedDay',
      category: 'other',
      trialEnabled: false,
      trialEndDate: null,
      websiteUrl: null,
      cancelUrl: null,
      paymentMethod: null,
      memo: null,
      subscriptionNotificationEnabled: true,
      createdAt,
      updatedAt: createdAt,
      ...item,
    } as SubscriptionDoc;
    doc.subscriptionId = ref.id;
    batch.set(ref, doc);
    docs.push(doc);
  });
  await batch.commit();
  return docs;
}

// ===== 04-12：seedPushSubscription ここに足す =====

// ===== 04-14：seedNotificationEvents・cronAuthHeaders ここに足す =====
import type { NotificationEventDoc } from '@/lib/types';
import { notificationId } from '@/lib/notifications';

// 通知イベントを Firestore に直接置く（Cron を通さない。users は作らない）。書かなかった項目は既定の値
// （subscriptionId は 'a' を20個・billing・1日前・targetDate 2026-11-04・title／body はその文面・料金 980・未読・pending・送信済みの端末なし）。
// notificationId を書かなければ、決定的ID（lib/notifications.ts）にする。createdAt は今から渡した順に1ミリ秒ずつ進め、
// expireAt は createdAt の90日後、updatedAt は createdAt と同じ（どれも渡せば上書き）。置いたドキュメントを、渡した順で返す
export async function seedNotificationEvents(uid: string, items: Partial<NotificationEventDoc>[]): Promise<NotificationEventDoc[]> {
  const collection = adminDb().collection('users').doc(uid).collection('notificationEvents');
  const base = Date.now();
  const docs: NotificationEventDoc[] = [];
  const batch = adminDb().batch();
  items.forEach((item, index) => {
    const createdAt = item.createdAt ?? Timestamp.fromMillis(base + index);
    const fields = {
      subscriptionId: 'a'.repeat(20),
      notificationType: 'billing' as const,
      daysBefore: 1 as const,
      targetDate: '2026-11-04',
      ...item,
    };
    const id = item.notificationId ?? notificationId(uid, fields.subscriptionId, fields.notificationType, fields.daysBefore, fields.targetDate);
    const doc: NotificationEventDoc = {
      notificationId: id,
      uid,
      serviceNameAtNotification: 'テストのサブスク',
      title: '請求日まであと1日',
      body: '11/05・¥980 の請求予定',
      priceAtNotification: 980,
      webPushStatus: 'pending',
      webPushDeliveredIds: [],
      viewedAt: null,
      webPushSentAt: null,
      webPushLastErrorCode: null,
      expireAt: Timestamp.fromMillis(createdAt.toMillis() + 90 * 24 * 60 * 60 * 1000),
      updatedAt: createdAt,
      ...fields,
      createdAt,
    };
    doc.notificationId = id;
    batch.set(collection.doc(id), doc);
    docs.push(doc);
  });
  await batch.commit();
  return docs;
}

// Cron（GET /api/cron/daily）を呼ぶときのヘッダー（.env.development.local のダミーの CRON_SECRET）
export function cronAuthHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` };
}
